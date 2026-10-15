import CrosstuneAnalytics
import CrosstuneStore
import Foundation
import GRDB
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "transfers")

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
    /// The clock the plan is judged by.
    var now: @MainActor () -> Date = Date.init
    var downloadRetries = DownloadRetries()
    var analytics = AnalyticsClient.noop

    /// Uploads every file waiting to go. A file's own transient failure does not stop the rest;
    /// the first one is returned, nil when every file settled, so the run can still fail. A stop
    /// or an auth failure ends the pass at once. While the plan is free nothing is sent, and a
    /// plan refusal ends only this pass's uploads; either way the files keep their state.
    func uploadPass() async throws -> (any Error)? {
        // Before the quota skip below, so a blocked file whose recording was deleted elsewhere is
        // cleaned up instead of being skipped forever by the figures check.
        try await dropTombstonedFiles()
        guard try await store.plan(at: now()).recordingsPlay else { return nil }

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
            } catch is RefusedByPlan {
                // Every later recording would draw the same refusal.
                break
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
            analytics.send(.uploadFailed(reason: .other, origin: RecordingOrigin(row)))
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
            if isPlanRefusal(error) {
                try await restore(file)
                throw RefusedByPlan()
            }
            if let refusal = underlying(error) as? APIStatusError {
                if refusal.problemType == quotaProblem {
                    try await settleUpload(id, .blockedQuota, error: refusal.message)
                    // A blocked file tried again and refused again is still the one limit.
                    if file.localState != .blockedQuota { await reportStorageLimit() }
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
                    analytics.send(.uploadFailed(reason: .other, origin: RecordingOrigin(row)))
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
            if isPlanRefusal(error) {
                try await restore(file)
                throw RefusedByPlan()
            }
            switch (underlying(error) as? APIStatusError)?.status {
            case 409:
                // The slot expired or the file never landed; the next pass asks for a fresh one.
                try await scheduleRetry(id, after: error)
            case 413:
                // The server deleted the file because it did not match the size declared.
                try await settleUpload(id, .failedUpload, error: transferMessage(error))
                analytics.send(.uploadFailed(reason: .other, origin: RecordingOrigin(row)))
            default:
                try await scheduleRetry(id, after: error)
                throw error
            }
        }
    }

    /// Puts a file back as it was before this attempt, so a refusal the plan lifts costs it no
    /// try and no message.
    private func restore(_ file: RecordingFile) async throws {
        try await store.write { writer in
            try writer.updateFile(file.id) { stored in
                stored.localState = file.localState
                stored.error = file.error
            }
        }
    }

    /// Reports the limit at the storage use the figures show. Without them nothing is sent, since
    /// a guessed use would land in the wrong bucket.
    private func reportStorageLimit() async {
        do {
            guard let storage = try await store.meta(.storage, as: StorageFigures.self) else {
                logger.info("The storage limit was reached before any storage figures; not reported")
                return
            }
            analytics.send(.storageLimitReached(bytesUsed: Int64(storage.usedBytes)))
        } catch {
            logger.error("The storage figures were not read: \(logDescription(of: error), privacy: .public)")
        }
    }

    /// A transient failure goes back to captured for a later pass, but not before a backoff that
    /// doubles with each failure in a row, so a lasting error does not resend the same file on
    /// every pass. The file keeps the reason, so a recording that keeps waiting can say why.
    private func scheduleRetry(_ id: String, after error: any Error) async throws {
        let message = transferMessage(error)
        try await store.write { writer in
            let now = Timestamp.now
            try writer.updateFile(id, at: now) { file in
                file.localState = .captured
                file.error = message
                file.nextAttemptAt = nextUploadAttempt(attempts: file.uploadAttempts, from: now)
                file.uploadAttempts += 1
            }
        }
    }

    /// Leaves the retry loop, win or lose: a state outside it (uploaded, blocked, failed) starts
    /// its count fresh.
    private func settleUpload(_ id: String, _ state: LocalFileState, error: String? = nil) async throws {
        try await store.write { writer in
            try writer.updateFile(id) { $0.leaveRetryLoop(state, error: error) }
        }
    }

    /// Queues the recording row again with a fresh time and puts its file back in the upload
    /// queue.
    private func requeueRecording(_ id: String) async throws {
        try await store.write { writer in
            if let row = try Recording.fetchOne(writer.db, key: id), row.deletedAt == nil {
                try writer.put(row)
            }
            try writer.updateFile(id) { $0.leaveRetryLoop(.captured) }
        }
    }

    /// Removes the file and file row of a recording tombstoned elsewhere, or one with no
    /// recording row at all. A capture still in progress is left alone: it has no recording row
    /// yet. A tombstoned recording whose audio never uploaded is restored unfiled instead, since
    /// the server takes a newer upsert over its tombstone and this file is the only copy. One
    /// whose audio is gone from disk has no copy to save, so its delete stands.
    func dropTombstonedFiles() async throws {
        let audioFolder = store.audioFolder
        // Read first so a pass with nothing to drop never takes the write lock.
        guard try await store.read({ db in try Self.orphanedFiles(db).isEmpty == false }) else { return }
        try await store.writeDroppingFiles { writer in
            for file in try Self.orphanedFiles(writer.db) {
                let row = try Recording.fetchOne(writer.db, key: file.id)
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

    /// The finished files whose recording is tombstoned or has no row at all.
    nonisolated static func orphanedFiles(_ db: Database) throws -> [RecordingFile] {
        try RecordingFile.fetchAll(
            db,
            sql: """
                SELECT f.* FROM recording_files f
                LEFT JOIN recordings r ON r.id = f.id
                WHERE f.local_state <> ? AND (r.id IS NULL OR r.deleted_at IS NOT NULL)
                """,
            arguments: [LocalFileState.capturing])
    }
}
