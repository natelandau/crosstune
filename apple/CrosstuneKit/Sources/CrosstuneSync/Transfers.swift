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

/// The type without codec parameters, which is what the signed upload is pinned to.
func baseContentType(_ contentType: String?) -> String {
    let base = contentType?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces)
    guard let base, !base.isEmpty else { return "application/octet-stream" }
    return base.lowercased()
}

/// The name a downloaded recording's file takes in the audio folder. The extension lets the
/// player tell the container without sniffing it.
func downloadedFileName(_ recordingID: String, contentType: String?) -> String {
    let ext =
        switch baseContentType(contentType) {
        case "audio/mpeg": "mp3"
        case "audio/webm": "webm"
        case "audio/ogg": "ogg"
        case "audio/wav", "audio/x-wav": "wav"
        default: "m4a"
        }
    return "\(recordingID).\(ext)"
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
                if error is RunStopped || isAuthFailure(error) { throw error }
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
                case 400..<500 where ![401, 403, 408, 429].contains(refusal.status):
                    // A refusal of the request itself (bad type, too large) never succeeds as it
                    // is; an auth, timeout, or rate-limit refusal might on a retry.
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

    private func fileSize(_ url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))
        return (attributes[.size] as? NSNumber)?.int64Value ?? 0
    }

    /// A transient failure goes back to captured for a later pass, but not before a backoff that
    /// doubles with each failure in a row, so a lasting error does not resend the same file on
    /// every pass. The file keeps the reason, so a recording that keeps waiting can say why.
    private func scheduleRetry(_ id: String, after error: any Error) async throws {
        let message = transferMessage(error)
        try await store.write { writer in
            guard var file = try RecordingFile.fetchOne(writer.db, key: id) else { return }
            let now = Timestamp.now
            let delay = uploadBackoff(attempts: file.uploadAttempts)
            file.localState = .captured
            file.error = message
            file.uploadAttempts += 1
            file.nextAttemptAt = Timestamp(
                milliseconds: now.milliseconds + delay.components.seconds * 1000)
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
        try await store.writeDroppingAudio { writer in
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

    /// When this device keeps recordings offline, fetches the audio of every ready recording not
    /// already here. `fetch` shares one download per recording with a play that asks for it.
    func downloadPass(fetch: @MainActor (String) async throws -> URL?) async throws {
        guard try await store.meta(.keepOffline, as: Bool.self) == true else { return }
        let missing = try await store.read { db -> [(String, RecordingFile?)] in
            let rows = try Recording.filter(
                Recording.CodingKeys.deletedAt == nil && Recording.CodingKeys.state == "ready"
            ).fetchAll(db)
            let files = Dictionary(
                uniqueKeysWithValues: try RecordingFile.fetchAll(db, keys: rows.map(\.id)).map { ($0.id, $0) })
            return rows.compactMap { row in
                let file = files[row.id]
                return file?.fileName == nil ? (row.id, file) : nil
            }
        }
        for (id, file) in missing where !downloadRetries.isWaiting(id) {
            do {
                _ = try await fetch(id)
                downloadRetries.succeeded(id)
            } catch {
                // A stop, no connection, or a refused session ends the pass; anything else is this
                // recording's problem alone, so it is noted and the rest still download.
                if error is RunStopped || underlying(error) is URLError || isAuthFailure(error) { throw error }
                downloadRetries.failed(id)
                if let file {
                    try await setFileState(id, restingState(file.localState), error: transferMessage(error))
                }
            }
        }
    }

    /// The recording's audio on this device, fetched first when it is not here. Nil when there
    /// is nothing to fetch: the recording is gone or not ready.
    func downloadOne(_ id: String) async throws -> URL? {
        let (file, row) = try await store.read { db in
            (try RecordingFile.fetchOne(db, key: id), try Recording.fetchOne(db, key: id))
        }
        if let local = store.localAudio(file) { return local }
        guard let row, row.deletedAt == nil, row.state == "ready" else { return nil }
        // Before the first write, so a stopped engine leaves the store as it found it.
        try checkStopped()
        let previousState = file.map { restingState($0.localState) }
        try await setFileState(id, .downloading)
        let name = downloadedFileName(id, contentType: row.playbackMime)
        let destination = store.audioFolder.appending(path: name)
        do {
            try checkStopped()
            let signed = try await api.downloadURL(recordingID: id)
            try checkStopped()
            try await api.getObject(signed, to: destination)
            // The server keeps the copy, so a device backup would only duplicate it.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var excluded = destination
            try excluded.setResourceValues(values)
            let bytes = try fileSize(destination)
            try await store.write { writer in
                var stored =
                    try RecordingFile.fetchOne(writer.db, key: id) ?? RecordingFile(id: id, localState: .downloaded)
                stored.localState = .downloaded
                stored.fileName = name
                stored.contentType = row.playbackMime
                stored.bytes = bytes
                stored.error = nil
                stored.updatedAt = .now
                try stored.save(writer.db)
            }
            return destination
        } catch {
            try? FileManager.default.removeItem(at: destination)
            // A file with no row before downloading gets none back; setFileState passes it by.
            if let previousState { try? await setFileState(id, previousState) }
            throw error
        }
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
}
