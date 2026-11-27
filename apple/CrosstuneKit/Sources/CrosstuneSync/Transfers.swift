import CrosstuneAnalytics
import CrosstuneDiagnostics
import CrosstuneStore
import Foundation
import GRDB
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "transfers")

/// One run of the transfer loop's work: hands every captured file whose recording has reached
/// the server to the background upload session, and downloads what this device keeps offline.
/// Also the single download a play asks for.
///
/// Every request is preceded by `checkStopped`, so a pass on an engine that has stopped for a
/// sign-out never sends the next user's token on the previous user's behalf.
@MainActor
struct Transfers {
    let store: CrosstuneStore
    let api: any SyncAPI
    let checkStopped: @MainActor () throws -> Void
    /// Sends each recording's upload and token confirm as tasks that outlive the app.
    let uploads: any RecordingUploadTransport
    /// The clock the plan is judged by.
    var now: @MainActor () -> Date = Date.init
    var downloadRetries = DownloadRetries()
    var analytics = AnalyticsClient.noop
    var diagnostics = DiagnosticsClient.noop

    /// What one upload pass leaves for the transfer loop.
    struct UploadPassResult {
        /// The first transient failure of a file, nil when every file settled, so the run can
        /// still fail.
        var firstError: (any Error)?
        /// The earliest time a file's backoff ends, so the loop runs again then. Nil when no
        /// file waits out a backoff.
        var nextAttemptAt: Timestamp?
    }

    /// Hands every file waiting to go to the upload session, and starts again a hand-off whose
    /// task has ended. A file's own transient failure does not stop the rest. A stop or an auth
    /// failure ends the pass at once. While the plan is free nothing is sent, and a plan refusal
    /// ends only this pass's uploads; either way the files keep their state.
    func uploadPass() async throws -> UploadPassResult {
        // Before the quota skip below, so a blocked file whose recording was deleted elsewhere is
        // cleaned up instead of being skipped forever by the usage check.
        try await dropTombstonedFiles()
        guard try await store.plan(at: now()).recordingsPlay else { return UploadPassResult() }

        // Listed before the files are read: a task that finishes in between has written its
        // result to the row by the time the row is read, or is still in this list.
        let running = await uploads.runningRecordingIDs(userID: userID)
        let waiting: [LocalFileState] = [.captured, .blockedQuota, .uploading]
        let (files, rows) = try await store.read { db in
            let files = try RecordingFile.filter(waiting.contains(RecordingFile.CodingKeys.localState)).fetchAll(db)
            let rows = try Recording.fetchAll(db, keys: files.map(\.id))
            return (files, Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }))
        }
        let storage = try await store.meta(.storage, as: StorageUsage.self)
        let now = Timestamp.now
        // A cancelled task reports no event, so a new slot's upload never runs beside it.
        let lapsed = Set(
            files.filter { file in
                guard let handoff = file.handoff else { return false }
                return running.contains(file.id) && handoffStatus(handoff, now: now) != .live
            }.map(\.id))
        if !lapsed.isEmpty { await uploads.cancel(recordingIDs: lapsed, userID: userID) }
        var firstError: (any Error)?
        for file in files {
            do {
                if let handoff = file.handoff {
                    let settlement = try await settleHandoff(
                        file, handoff, running: running, row: rows[file.id], now: now)
                    if case .waits(let failure) = settlement {
                        // Not thrown: a recorded failure is one file's, never a reason to end the pass.
                        firstError = firstError ?? failure
                        continue
                    }
                }
                // A pass is the only place a blocked file is reconsidered, so the usage is checked
                // rather than asking for a slot the server will refuse again.
                if file.localState == .blockedQuota, let storage,
                    Int64(storage.usedBytes) + (file.bytes ?? 0) > Int64(storage.quotaBytes)
                {
                    continue
                }
                if let next = file.nextAttemptAt, next > now { continue }
                // Held until a split replaces it with pieces the server accepts.
                if let row = rows[file.id], RecordingLimits.mustSplitToUpload(row, file: file, uploadLimits: storage) {
                    continue
                }
                try await uploadOne(file.id)
            } catch is RefusedByPlan {
                // Every later recording would draw the same refusal.
                break
            } catch {
                if endsThePass(error) { throw error }
                firstError = firstError ?? error
            }
        }
        return UploadPassResult(firstError: firstError, nextAttemptAt: try await earliestBackoffEnd(after: now))
    }

    /// Start again, or take back, a file the pass finds handed off. The pass has already
    /// cancelled the running task of a hand-off that is no longer live.
    private func settleHandoff(
        _ file: RecordingFile, _ handoff: UploadHandoff, running: Set<String>, row: Recording?, now: Timestamp
    ) async throws -> HandoffSettlement {
        if handoffStatus(handoff, now: now) == .live {
            let lastFailure = handoff.lastFailure.map(failureError)
            // The session may still finish it, so it takes no new slot.
            if running.contains(file.id) { return .waits(failure: lastFailure) }
            if let next = file.nextAttemptAt, next > now { return .waits(failure: lastFailure) }
            switch try await startAgain(file, handoff) {
            case .started: return .waits(failure: lastFailure)
            case .settled(let failure): return .waits(failure: failure)
            case .noAudio: break
            case .refused:
                // The refusal is on the row now, so the take-back below reads it from there.
                let refused = try await store.read { db in try RecordingFile.fetchOne(db, key: file.id) }
                guard let refused, let refusedHandoff = refused.handoff else { return .waits(failure: nil) }
                return try await takeBack(refused, refusedHandoff, row: row)
            }
        }
        return try await takeBack(file, handoff, row: row)
    }

    /// The earliest end of a backoff still to come among the files waiting to upload.
    private func earliestBackoffEnd(after now: Timestamp) async throws -> Timestamp? {
        let waiting: [LocalFileState] = [.captured, .uploading]
        return try await store.read { db in
            // Stored as ISO 8601 text, which sorts in time order.
            try RecordingFile
                .filter(waiting.contains(RecordingFile.CodingKeys.localState))
                .filter(RecordingFile.CodingKeys.nextAttemptAt > now)
                .select(min(RecordingFile.CodingKeys.nextAttemptAt), as: Timestamp.self)
                .fetchOne(db)
        }
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
            diagnostics.report(MissingAudio(), area: .upload)
            return
        }
        try await setFileState(id, .uploading)
        let contentType = baseContentType(file.contentType)

        let slot: UploadSlot
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
                    diagnostics.report(refusal, area: .upload)
                    return
                default: break
                }
            }
            try await scheduleRetry(id, after: error)
            throw error
        }

        // The stop rule: a slot granted after a stop is dropped, never saved.
        try checkStopped()
        let handoff = UploadHandoff(
            url: slot.url, confirmToken: slot.confirmToken, contentType: contentType, expiresAt: slot.expiresAt)
        try await store.write { writer in
            try writer.updateFile(id) { stored in
                stored.handoff = handoff
                stored.localState = .uploading
                // The try count stays until the upload lands, so a file the server keeps
                // refusing still backs off further each time.
                stored.error = nil
                stored.nextAttemptAt = nil
            }
        }
        // A stop during the write leaves a hand-off with no task, which the next pass starts.
        try checkStopped()
        uploads.startPut(tag(id, .put, handoff), file: url, contentType: contentType)
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

    /// Reports the limit at the storage use the usage shows. Without it nothing is sent, since
    /// a guessed use would land in the wrong bucket.
    private func reportStorageLimit() async {
        do {
            guard let storage = try await store.meta(.storage, as: StorageUsage.self) else {
                logger.info("The storage limit was reached before any storage usage; not reported")
                return
            }
            analytics.send(.storageLimitReached(bytesUsed: Int64(storage.usedBytes)))
        } catch {
            logger.error("The storage usage was not read: \(logDescription(of: error), privacy: .public)")
        }
    }

    /// A transient failure goes back to captured for a later pass, but not before a backoff that
    /// doubles with each failure in a row, so a persistent error does not resend the same file on
    /// every pass. The file keeps the reason, so a recording that keeps waiting can say why.
    private func scheduleRetry(_ id: String, after error: any Error) async throws {
        let message = transferMessage(error)
        try await store.write { writer in
            let now = Timestamp.now
            try writer.updateFile(id, at: now) { file in file.scheduleRetry(at: now, error: message) }
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
    /// whose audio is gone from disk has no copy to save, so its delete is kept.
    func dropTombstonedFiles() async throws {
        let audioFolder = store.audioFolder
        // Read first so a pass with nothing to drop never takes the write lock.
        guard try await store.read({ db in try Self.orphanedFiles(db).isEmpty == false }) else { return }
        try await store.writeDroppingFiles { writer in
            let waiting = try RecordingLimits.waitingParentIDs(writer.db)
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
                // A piece waiting for its cut plays from this audio; a later pass drops it.
                if let row, RecordingLimits.holdsSplitAudio(row, waitingParentIDs: waiting) { continue }
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
