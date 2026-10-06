import CrosstuneStore
import Foundation
import GRDB

/// The problem type the API answers a slot request with when the recording would pass the
/// account's quota.
let quotaProblem = "urn:crosstune:quota-exceeded"

/// The first backoff after a transient upload failure, doubling with each one after it.
let uploadRetryBase: Duration = .seconds(30)
/// The longest an upload waits between tries, so a long outage still retries twice an hour.
let uploadRetryMax: Duration = .seconds(30 * 60)

/// How long a file that failed to upload `attempts` times in a row waits before the next try.
func uploadBackoff(attempts: Int) -> Duration {
    // Capped before the shift so a long streak cannot overflow.
    let factor = 1 << min(attempts, 16)
    return min(uploadRetryMax, uploadRetryBase * factor)
}

/// When a file that failed to upload `attempts` times in a row may next try, counted from `now`.
func nextUploadAttempt(attempts: Int, from now: Timestamp) -> Timestamp {
    Timestamp(milliseconds: now.milliseconds + uploadBackoff(attempts: attempts).components.seconds * 1000)
}

/// A refusal of the request itself, such as a bad type or a file too large, which never succeeds
/// as it is. An auth, timeout, or rate-limit refusal might on a retry.
func refusesTheRequestItself(_ refusal: APIStatusError) -> Bool {
    (400..<500).contains(refusal.status) && ![401, 403, 408, 429].contains(refusal.status)
}

/// A stop or a refused session: nothing past it can succeed in this run, so a pass ends at once
/// rather than holding it as one file's failure.
func endsThePass(_ error: any Error) -> Bool {
    error is RunStopped || isAuthFailure(error)
}

/// What ends a download pass: as ``endsThePass(_:)``, or no connection, which every later download
/// would meet too.
func endsTheDownloadPass(_ error: any Error) -> Bool {
    endsThePass(error) || underlying(error) is URLError
}

/// The size of a file on disk, in bytes.
func fileSize(_ url: URL) throws -> Int64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))
    return (attributes[.size] as? NSNumber)?.int64Value ?? 0
}

/// The type without codec parameters, which is what the signed upload is pinned to.
func baseContentType(_ contentType: String?) -> String {
    let base = contentType?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces)
    guard let base, !base.isEmpty else { return "application/octet-stream" }
    return base.lowercased()
}

/// A value the server sent, such as an ID or a revision, refused as part of a local file name.
struct UnsafeFileNamePart: Error {
    let value: String
}

/// `value` as part of a local file name. Only letters, digits, `-` and `_` pass, so no
/// server-sent value can name a path outside the folder the file goes in.
func fileNamePart(_ value: String) throws -> String {
    guard !value.isEmpty, value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { throw UnsafeFileNamePart(value: value) }
    return value
}

/// The name a downloaded recording's file takes in the audio folder, tagged with the revision it
/// was downloaded for so a re-download after a trim writes a new file rather than overwriting one
/// a player may still hold open. The extension lets the player tell the container without
/// sniffing it.
func downloadedFileName(_ recordingID: String, rev: String, contentType: String?) throws -> String {
    let ext =
        switch baseContentType(contentType) {
        case "audio/mpeg": "mp3"
        case "audio/webm": "webm"
        case "audio/ogg": "ogg"
        case "audio/wav", "audio/x-wav": "wav"
        default: "m4a"
        }
    return "\(try fileNamePart(recordingID))-\(try fileNamePart(rev)).\(ext)"
}

/// The name a fetched waveform takes in the audio folder, tagged with the revision it was
/// fetched for. A capture-time waveform (`CaptureFiles.peaksName`, never revisioned) is never
/// this shape, so the two can never collide or be mistaken for one another.
func peaksFileName(_ recordingID: String, rev: String) throws -> String {
    "\(try fileNamePart(recordingID))-\(try fileNamePart(rev)).peaks"
}

/// A downloaded audio file whose revision no longer matches the recording's current playback
/// file, as after a trim. A file never downloaded from the server (the raw capture or an import,
/// kept as is) has no revision of its own and is never stale.
func isStale(_ recording: Recording, _ file: RecordingFile) -> Bool {
    file.blobRev != nil && file.blobRev != recording.playbackRev
}

/// Why a file waiting to upload is stuck when its audio is no longer on this device.
let missingAudio = "The audio file is missing from this device."

/// Why a transfer failed, as a recording's row shows it.
func transferMessage(_ error: any Error) -> String {
    switch underlying(error) {
    case let refusal as APIStatusError: refusal.message
    case let failure as TransferError: failure.message
    case let other: other.localizedDescription
    }
}

/// One run of the transfer loop's work: uploads every captured file whose recording has reached
/// the server, and downloads what this device keeps offline. Also the single download a play
/// asks for.
///
/// Every request is preceded by `checkStopped`, so a pass on an engine that has stopped for a
/// sign-out never sends the next user's token on the previous user's behalf.
@MainActor
struct Transfers {
    let store: CrosstuneStore
    let api: any SyncAPI
    let checkStopped: @MainActor () throws -> Void
    var downloadRetries = DownloadRetries()

    // MARK: Upload

    /// Uploads every file waiting to go. A file's own transient failure does not stop the rest;
    /// the first one is returned, nil when every file settled, so the run can still fail. A stop
    /// or an auth failure ends the pass at once.
    func uploadPass() async throws -> (any Error)? {
        // Before the quota skip below, so a blocked file whose recording was deleted elsewhere is
        // cleaned up instead of being skipped forever by the figures check.
        try await dropTombstonedFiles()

        let waiting: [LocalFileState] = [.captured, .blockedQuota, .uploading]
        let files = try await store.read { db in
            try RecordingFile.filter(waiting.contains(RecordingFile.CodingKeys.localState)).fetchAll(db)
        }
        let storage = try await store.meta(.storage, as: StorageFigures.self)
        let now = Timestamp.now
        var firstError: (any Error)?
        for file in files {
            // A pass is the only place a blocked file is reconsidered, so the figures are checked
            // rather than asking for a slot the server will refuse again.
            if file.localState == .blockedQuota, let storage,
                Int64(storage.usedBytes) + (file.bytes ?? 0) > Int64(storage.quotaBytes)
            {
                continue
            }
            if let next = file.nextAttemptAt, next > now { continue }
            do {
                try await uploadOne(file.id)
            } catch {
                if endsThePass(error) { throw error }
                firstError = firstError ?? error
            }
        }
        return firstError
    }

    private func uploadOne(_ id: String) async throws {
        let found = try await store.read { db -> (RecordingFile, String, Recording, Bool)? in
            guard let file = try RecordingFile.fetchOne(db, key: id), let fileName = file.fileName,
                let row = try Recording.fetchOne(db, key: id)
            else { return nil }
            let queued =
                try OutboxEntry.filter(
                    OutboxEntry.CodingKeys.tableName == SyncTable.recordings.rawValue
                        && OutboxEntry.CodingKeys.rowID == id
                ).fetchCount(db) > 0
            return (file, fileName, row, queued)
        }
        // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedFiles.
        guard let (file, fileName, row, queued) = found, row.deletedAt == nil else { return }
        // The server gives a slot only to a recording it has.
        if queued { return }
        guard row.state == "pending_upload" else {
            try await settleUpload(id, .uploaded)
            return
        }
        let url = store.audioFolder.appending(path: fileName)
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else {
            // Nothing to send, so retrying would only grow the try count.
            try await settleUpload(id, .failedUpload, error: missingAudio)
            return
        }
        try await setFileState(id, .uploading)
        let contentType = baseContentType(file.contentType)

        let slot: URL
        do {
            let bytes = try fileSize(url)
            try checkStopped()
            slot = try await api.requestUploadSlot(recordingID: id, bytes: bytes, contentType: contentType)
        } catch let stop as RunStopped {
            throw stop
        } catch {
            if let refusal = underlying(error) as? APIStatusError {
                if refusal.problemType == quotaProblem {
                    try await settleUpload(id, .blockedQuota, error: refusal.message)
                    return
                }
                switch refusal.status {
                case 409:
                    // Already past pending on the server, so an earlier confirmation landed.
                    try await settleUpload(id, .uploaded)
                    return
                case 404:
                    // The server has no live row for this recording; pushing it again gives the
                    // slot request one.
                    try await requeueRecording(id)
                    return
                case _ where refusesTheRequestItself(refusal):
                    try await settleUpload(id, .failedUpload, error: refusal.message)
                    return
                default: break
                }
            }
            try await scheduleRetry(id, after: error)
            throw error
        }

        do {
            try checkStopped()
            try await api.putObject(slot, file: url, contentType: contentType)
            try checkStopped()
            try await api.uploadFinished(recordingID: id)
            try await settleUpload(id, .uploaded)
        } catch let stop as RunStopped {
            throw stop
        } catch {
            switch (underlying(error) as? APIStatusError)?.status {
            case 409:
                // The slot expired or the file never landed; the next pass asks for a fresh one.
                try await scheduleRetry(id, after: error)
            case 413:
                // The server deleted the file because it did not match the size declared.
                try await settleUpload(id, .failedUpload, error: transferMessage(error))
            default:
                try await scheduleRetry(id, after: error)
                throw error
            }
        }
    }

    /// A transient failure goes back to captured for a later pass, but not before a backoff that
    /// doubles with each failure in a row, so a lasting error does not resend the same file on
    /// every pass. The file keeps the reason, so a recording that keeps waiting can say why.
    private func scheduleRetry(_ id: String, after error: any Error) async throws {
        let message = transferMessage(error)
        try await store.write { writer in
            guard var file = try RecordingFile.fetchOne(writer.db, key: id) else { return }
            let now = Timestamp.now
            file.localState = .captured
            file.error = message
            file.nextAttemptAt = nextUploadAttempt(attempts: file.uploadAttempts, from: now)
            file.uploadAttempts += 1
            file.updatedAt = now
            try file.update(writer.db)
        }
    }

    /// Leaves the retry loop, win or lose: a state outside it (uploaded, blocked, failed) starts
    /// its count fresh.
    private func settleUpload(_ id: String, _ state: LocalFileState, error: String? = nil) async throws {
        try await store.write { writer in
            guard var file = try RecordingFile.fetchOne(writer.db, key: id) else { return }
            file.localState = state
            file.error = error
            file.uploadAttempts = 0
            file.nextAttemptAt = nil
            file.updatedAt = .now
            try file.update(writer.db)
        }
    }

    /// Queues the recording row again with a fresh time and puts its file back in the upload
    /// queue.
    private func requeueRecording(_ id: String) async throws {
        try await store.write { writer in
            if let row = try Recording.fetchOne(writer.db, key: id), row.deletedAt == nil {
                try writer.put(row)
            }
            guard var file = try RecordingFile.fetchOne(writer.db, key: id) else { return }
            file.localState = .captured
            file.error = nil
            file.uploadAttempts = 0
            file.nextAttemptAt = nil
            file.updatedAt = .now
            try file.update(writer.db)
        }
    }

    /// Removes the file and file row of a recording tombstoned elsewhere, or one with no
    /// recording row at all. A capture still in progress is left alone: it has no recording row
    /// yet. A tombstoned recording whose audio never uploaded is restored unfiled instead, since
    /// the server takes a newer upsert over its tombstone and this file is the only copy. One
    /// whose audio is gone from disk has no copy to save, so its delete stands.
    func dropTombstonedFiles() async throws {
        let audioFolder = store.audioFolder
        try await store.writeDroppingFiles { writer in
            let files = try RecordingFile.filter(RecordingFile.CodingKeys.localState != LocalFileState.capturing)
                .fetchAll(writer.db)
            for file in files {
                let row = try Recording.fetchOne(writer.db, key: file.id)
                if let row, row.deletedAt == nil { continue }
                if var row, let fileName = file.fileName, file.localState.isNotUploaded,
                    FileManager.default.fileExists(
                        atPath: audioFolder.appending(path: fileName).path(percentEncoded: false))
                {
                    row.deletedAt = nil
                    row.tuneID = nil
                    try writer.put(row)
                    var restored = file
                    restored.localState = .captured
                    restored.error = nil
                    restored.updatedAt = .now
                    try restored.update(writer.db)
                    continue
                }
                try file.delete(writer.db)
            }
        }
    }

    // MARK: Download

    /// When this device keeps recordings offline, fetches the audio and waveform of every ready
    /// recording whose copy is missing or stale, as after a trim. `fetch` and `fetchPeaksFor`
    /// share one attempt per recording with a play or another caller that asks for it.
    func downloadPass(
        fetch: @MainActor (String) async throws -> URL?,
        fetchPeaksFor: @MainActor (String) async throws -> Data?
    ) async throws {
        guard try await store.meta(.keepOffline, as: Bool.self) == true else { return }
        let (rows, files) = try await store.read { db -> ([Recording], [String: RecordingFile]) in
            let rows = try Recording.filter(
                Recording.CodingKeys.deletedAt == nil && Recording.CodingKeys.state == "ready"
            ).fetchAll(db)
            let files = Dictionary(
                uniqueKeysWithValues: try RecordingFile.fetchAll(db, keys: rows.map(\.id)).map { ($0.id, $0) })
            return (rows, files)
        }
        for row in rows {
            let file = files[row.id]
            let needsAudio = file?.fileName == nil || file.map { isStale(row, $0) } == true
            if needsAudio, !downloadRetries.isWaiting(row.id) {
                do {
                    _ = try await fetch(row.id)
                    downloadRetries.succeeded(row.id)
                } catch {
                    // A stop, no connection, or a refused session ends the pass; anything else is
                    // this recording's problem alone, so it is noted and the rest still download.
                    if endsTheDownloadPass(error) { throw error }
                    downloadRetries.failed(row.id)
                    if let file {
                        try await setFileState(row.id, restingState(file.localState), error: transferMessage(error))
                    }
                }
            }

            // Re-read: the fetch above may have just stored the waveform that came with a fresh file.
            let peaksKey = "peaks:\(row.id)"
            guard let peaksRev = row.peaksRev, !downloadRetries.isWaiting(peaksKey) else { continue }
            let current = try await store.read { db in try RecordingFile.fetchOne(db, key: row.id) }
            guard current?.peaksRev != peaksRev else { continue }
            do {
                _ = try await fetchPeaksFor(row.id)
                downloadRetries.succeeded(peaksKey)
            } catch {
                // A missing waveform never fails the pass; it just waits for the next one, backed off.
                downloadRetries.failed(peaksKey)
            }
        }
    }

    /// The recording's audio on this device, fetched first when it is not here. Nil when there
    /// is nothing to fetch: the recording is gone or not ready.
    func downloadOne(_ id: String) async throws -> URL? {
        let (file, row) = try await store.read { db in
            (try RecordingFile.fetchOne(db, key: id), try Recording.fetchOne(db, key: id))
        }
        if let file, let local = store.localAudio(file), !(row.map { isStale($0, file) } ?? false) {
            return local
        }
        guard let row, row.deletedAt == nil, row.state == "ready" else { return nil }
        // Before the first write, so a stopped engine leaves the store as it found it.
        try checkStopped()
        let previousState = file.map { restingState($0.localState) }
        try await setFileState(id, .downloading)
        var destination: URL?
        do {
            try checkStopped()
            // A pull runs on its own loop and a trim can commit mid-download, so the row's own
            // playbackRev and start can already be behind this response by the time it lands.
            // What the server signed, not what this device has pulled, is what the downloaded
            // bytes are tagged and named for: a stale file keeps its own path until the row
            // switches to the new one, so a player already holding it open is never pulled out
            // from under.
            let signed = try await api.downloadURL(recordingID: id)
            try checkStopped()
            let name = try downloadedFileName(id, rev: signed.playbackRev, contentType: row.playbackMime)
            let newDestination = store.audioFolder.appending(path: name)
            destination = newDestination
            try await api.getObject(signed.url, to: newDestination)
            try CrosstuneStore.setExcludedFromBackup(newDestination, true)
            let bytes = try fileSize(newDestination)
            try await store.writeDroppingFiles { writer in
                var stored =
                    try RecordingFile.fetchOne(writer.db, key: id) ?? RecordingFile(id: id, localState: .downloaded)
                stored.localState = .downloaded
                stored.fileName = name
                stored.contentType = row.playbackMime
                stored.bytes = bytes
                stored.blobRev = signed.playbackRev
                stored.blobStartMs = signed.playbackStartMs
                stored.error = nil
                stored.updatedAt = .now
                try stored.save(writer.db)
            }
            // A waveform that fails to fetch never undoes an audio download that already succeeded.
            _ = try? await fetchPeaks(id)
            return newDestination
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            // A file with no row before downloading gets none back; setFileState passes it by.
            if let previousState { try? await setFileState(id, previousState) }
            throw error
        }
    }

    /// The recording's current waveform, fetched from the server first when this device's copy
    /// does not match its current revision. A row whose waveform has not been built yet, or that
    /// is gone or not ready, keeps whatever is already on disk: capture-time peaks, a server
    /// waveform from an earlier revision, or none.
    @discardableResult
    func fetchPeaks(_ id: String) async throws -> Data? {
        let (file, row) = try await store.read { db in
            (try RecordingFile.fetchOne(db, key: id), try Recording.fetchOne(db, key: id))
        }
        guard let row, row.deletedAt == nil, row.state == "ready", let peaksRev = row.peaksRev else {
            return store.localPeaks(file)
        }
        if let file, file.peaksRev == peaksRev { return store.localPeaks(file) }
        try checkStopped()
        // As with the audio download, tag the bytes with what the server actually signed, not
        // with this row's own peaksRev, which can already be behind it.
        let signed = try await api.peaksURL(recordingID: id)
        try checkStopped()
        let name = try peaksFileName(id, rev: signed.peaksRev)
        let destination = store.audioFolder.appending(path: name)
        try await api.getObject(signed.url, to: destination)
        try await store.writeDroppingFiles { writer in
            // A recording whose audio has never landed here still gets its waveform: there is
            // nothing local to upload, so `uploaded` is the state that lies least.
            var stored =
                try RecordingFile.fetchOne(writer.db, key: id) ?? RecordingFile(id: id, localState: .uploaded)
            stored.peaksFileName = name
            stored.peaksRev = signed.peaksRev
            stored.updatedAt = .now
            try stored.save(writer.db)
        }
        return try Data(contentsOf: destination)
    }

    /// A stale `downloading` state is an earlier fetch that never finished, not a state to keep:
    /// it rests as a completed fetch that produced no file.
    private func restingState(_ state: LocalFileState) -> LocalFileState {
        state == .downloading ? .downloaded : state
    }

    private func setFileState(_ id: String, _ state: LocalFileState, error: String? = nil) async throws {
        try await store.write { writer in
            guard var file = try RecordingFile.fetchOne(writer.db, key: id) else { return }
            file.localState = state
            file.error = error
            file.updatedAt = .now
            try file.update(writer.db)
        }
    }
}

/// When the download pass may next try each recording whose download failed, doubling the wait
/// with each failure in a row as uploads do, so a lasting error is not re-sent after every sync.
/// Kept in memory: a relaunch tries each once more, and a play fetches regardless.
@MainActor
final class DownloadRetries {
    var now: () -> ContinuousClock.Instant = { .now }
    private var waits: [String: (attempts: Int, until: ContinuousClock.Instant)] = [:]

    func isWaiting(_ id: String) -> Bool {
        guard let wait = waits[id] else { return false }
        return now() < wait.until
    }

    func failed(_ id: String) {
        let attempts = waits[id]?.attempts ?? 0
        waits[id] = (attempts + 1, now().advanced(by: uploadBackoff(attempts: attempts)))
    }

    func succeeded(_ id: String) {
        waits[id] = nil
    }
}

extension CrosstuneStore {
    /// The file a recording's row names, when it holds finished audio that is still on disk.
    public func localAudio(_ file: RecordingFile?) -> URL? {
        guard let file, let name = file.fileName, file.localState != .capturing, file.localState != .downloading
        else { return nil }
        let url = audioFolder.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) ? url : nil
    }

    /// The recording's audio on this device, without fetching it: what plays with no sync engine.
    public func localAudio(recordingID: String) async -> URL? {
        let file = try? await read { db in try RecordingFile.fetchOne(db, key: recordingID) }
        return localAudio(file ?? nil)
    }

    /// The bytes of the waveform a recording's row names, when it is still on disk.
    public func localPeaks(_ file: RecordingFile?) -> Data? {
        guard let file, let name = file.peaksFileName else { return nil }
        return try? Data(contentsOf: audioFolder.appending(path: name))
    }

    /// The recording's waveform bytes on this device, without fetching it: what shows offline or
    /// with no sync engine.
    public func localPeaks(recordingID: String) async -> Data? {
        let file = try? await read { db in try RecordingFile.fetchOne(db, key: recordingID) }
        return localPeaks(file ?? nil)
    }
}
