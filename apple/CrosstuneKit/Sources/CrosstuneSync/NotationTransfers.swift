import CrosstuneStore
import Foundation
import GRDB

/// The only type a notation page's image is stored as, and so the type every PUT is signed for.
let notationContentType = "image/jpeg"

/// The name a downloaded page image takes in the notation folder. A captured image's name
/// carries a UUID after the page ID, so the two never collide.
func downloadedPageName(_ pageID: String) -> String { "\(pageID).jpg" }

/// One run's notation page work: uploads every captured image whose page row has reached the
/// server, and downloads every ready page with no image here. Pages download whatever keep
/// offline says: a page is small, and the reading view has to work with no signal.
///
/// Every request is preceded by `checkStopped`, as in ``Transfers``.
@MainActor
struct NotationTransfers {
    let store: CrosstuneStore
    let api: any SyncAPI
    let checkStopped: @MainActor () throws -> Void

    // MARK: Upload

    /// Uploads every captured image waiting to go. A page's own transient failure does not stop
    /// the rest; the first one is returned, nil when every page settled. A stop or an auth
    /// failure ends the pass at once.
    func uploadPass() async throws -> (any Error)? {
        try await dropTombstonedFiles()

        let waiting = try await store.read { db -> [(file: NotationFile, serverSeq: Int64)] in
            let files = try NotationFile.filter(NotationFile.CodingKeys.origin == NotationOrigin.captured).fetchAll(db)
            let pages = try NotationPageRecord.fetchAll(db, keys: files.map(\.pageID))
            let serverSeqs = Dictionary(uniqueKeysWithValues: pages.map { ($0.id, $0.serverSeq) })
            return files.map { ($0, serverSeqs[$0.pageID] ?? 0) }
        }
        let storage = try await store.meta(.storage, as: StorageFigures.self)
        let now = Timestamp.now
        var firstError: (any Error)?
        for (file, serverSeq) in waiting {
            // A refused row the server has since stored, as after a later edit's push, can take
            // a slot after all.
            if file.error == NotationFile.refusedError, serverSeq == 0 { continue }
            // Only the figures a sync refreshes free a page refused for quota; asking for a slot
            // before they show room would draw the same refusal.
            if file.error == NotationFile.storageFullError, let storage {
                let bytes = (try? fileSize(store.notationFolder.appending(path: file.fileName))) ?? 0
                if Int64(storage.usedBytes) + bytes > Int64(storage.quotaBytes) { continue }
            }
            if let next = file.nextAttemptAt, next > now { continue }
            do {
                try await uploadOne(file.pageID)
            } catch {
                if endsThePass(error) { throw error }
                firstError = firstError ?? error
            }
        }
        return firstError
    }

    private func uploadOne(_ id: String) async throws {
        let found = try await store.read { db -> (NotationFile, NotationPageRecord, Bool)? in
            guard let file = try NotationFile.fetchOne(db, key: id), file.origin == .captured,
                let page = try NotationPageRecord.fetchOne(db, key: id)
            else { return nil }
            let queued =
                try OutboxEntry.filter(
                    OutboxEntry.CodingKeys.tableName == SyncTable.notationPages.rawValue
                        && OutboxEntry.CodingKeys.rowID == id
                ).fetchCount(db) > 0
            return (file, page, queued)
        }
        // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedFiles.
        guard let (file, page, queued) = found, page.deletedAt == nil else { return }
        // The server gives a slot only to a page row it has.
        if queued { return }
        let url = store.notationFolder.appending(path: file.fileName)
        let onDisk = FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
        guard page.state == NotationPageRecord.pendingUpload else {
            if onDisk {
                try await settleUploaded(file)
            } else {
                // The server has the image, so dropping the row lets the download pass fetch it.
                try await store.write { writer in _ = try NotationFile.deleteOne(writer.db, key: id) }
            }
            return
        }
        guard onDisk else {
            // The only copy is gone, so no retry can send it; the page is left for deleting.
            try await settleUpload(id, error: NotationFile.refusedError)
            return
        }

        let slot: SignedURL
        do {
            let bytes = try fileSize(url)
            try checkStopped()
            slot = try await api.notationUploadSlot(pageID: id, bytes: bytes)
        } catch let stop as RunStopped {
            throw stop
        } catch {
            if let refusal = underlying(error) as? APIStatusError {
                if refusal.problemType == quotaProblem {
                    try await settleUpload(id, error: NotationFile.storageFullError)
                    return
                }
                switch refusal.status {
                case 409:
                    // Already past pending on the server, so an earlier confirmation landed.
                    try await settleUploaded(file)
                    return
                case 404:
                    // A row the server never stored was refused on push and can never take a
                    // slot. One it did store has since been deleted there, with it or its tune;
                    // pushing it again would win over that tombstone, so the pull brings it
                    // instead.
                    if page.serverSeq == 0 {
                        try await settleUpload(id, error: NotationFile.refusedError)
                    } else {
                        try await scheduleRetry(id, after: error)
                    }
                    return
                default:
                    if refusesTheRequestItself(refusal) {
                        // No failed state holds a page's only copy, so it waits out the backoff
                        // without failing the run, and the rest of the queue still moves.
                        try await scheduleRetry(id, after: error)
                        return
                    }
                }
            }
            try await scheduleRetry(id, after: error)
            throw error
        }

        do {
            try checkStopped()
            try await api.putObject(slot.url, file: url, contentType: notationContentType)
            try checkStopped()
            try await api.notationUploaded(pageID: id)
            try await settleUploaded(file)
        } catch let stop as RunStopped {
            throw stop
        } catch {
            try await scheduleRetry(id, after: error)
            // The slot expired or the image never landed; the next pass asks for a fresh slot.
            if (underlying(error) as? APIStatusError)?.status == 409 { return }
            throw error
        }
    }

    /// The server holds the image now, so the kept file is a cache like any download and leaves
    /// the device backup.
    private func settleUploaded(_ file: NotationFile) async throws {
        // A page deleted mid-upload took its file along, so there is nothing to mark.
        guard try await settleUpload(file.pageID, origin: .downloaded) else { return }
        try store.applyBackupRule(toNotationFile: file.fileName, origin: .downloaded)
    }

    /// Leaves the retry loop with `error`, or none, starting the try count fresh. False when the
    /// file row is gone.
    @discardableResult
    private func settleUpload(_ id: String, origin: NotationOrigin? = nil, error: String? = nil) async throws -> Bool {
        try await store.write { writer in
            guard var file = try NotationFile.fetchOne(writer.db, key: id) else { return false }
            if let origin { file.origin = origin }
            file.error = error
            file.uploadAttempts = 0
            file.nextAttemptAt = nil
            try file.update(writer.db)
            return true
        }
    }

    /// Backs off a failed attempt, doubling with each failure in a row, and keeps the reason.
    private func scheduleRetry(_ id: String, after error: any Error) async throws {
        let message = transferMessage(error)
        try await store.write { writer in
            guard var file = try NotationFile.fetchOne(writer.db, key: id) else { return }
            file.error = message
            file.nextAttemptAt = nextUploadAttempt(attempts: file.uploadAttempts, from: .now)
            file.uploadAttempts += 1
            try file.update(writer.db)
        }
    }

    /// Removes the image and file row of every page whose page or tune was deleted, here or
    /// elsewhere, or is not here at all. A captured image goes too: unlike an unfiled recording, a
    /// deleted page has no tune to come back to.
    func dropTombstonedFiles() async throws {
        try await store.writeDroppingFiles { writer in
            try writer.db.execute(
                sql: "DELETE FROM notation_files WHERE page_id NOT IN (\(NotationPageRecord.liveIDsSQL))")
        }
    }

    // MARK: Download

    /// Fetches the image of every ready page with none here. A stop, no connection, or a refused
    /// session ends the pass; any other failure is that page's alone, so it backs off in
    /// `retries` and the rest still download.
    func downloadPass(retries: DownloadRetries) async throws {
        let ids = try await store.read { db in
            try String.fetchAll(
                db,
                sql: """
                    SELECT p.id FROM notation_pages p
                    LEFT JOIN notation_files f ON f.page_id = p.id
                    WHERE p.state = ? AND f.page_id IS NULL AND p.id IN (\(NotationPageRecord.liveIDsSQL))
                    """,
                arguments: [NotationPageRecord.ready])
        }
        for id in ids where !retries.isWaiting(id) {
            do {
                try await downloadOne(id)
                retries.succeeded(id)
            } catch {
                if endsTheDownloadPass(error) { throw error }
                retries.failed(id)
            }
        }
    }

    private func downloadOne(_ id: String) async throws {
        try checkStopped()
        let signed = try await api.notationDownload(pageID: id)
        try checkStopped()
        let name = downloadedPageName(id)
        let destination = store.notationFolder.appending(path: name)
        do {
            try await api.getObject(signed.url, to: destination)
            // Before the row names the file, so a failure here leaves no row to an unmarked file.
            try store.applyBackupRule(toNotationFile: name, origin: .downloaded)
            // A delete of the page or its tune, or a capture, that landed during the fetch wins.
            let kept = try await store.write { writer -> Bool in
                let live =
                    try Bool.fetchOne(
                        writer.db, sql: "SELECT EXISTS(\(NotationPageRecord.liveIDsSQL) AND p.id = ?)",
                        arguments: [id]) ?? false
                guard live, try NotationFile.fetchOne(writer.db, key: id) == nil else { return false }
                try NotationFile(pageID: id, fileName: name, origin: .downloaded).insert(writer.db)
                return true
            }
            if !kept { try? FileManager.default.removeItem(at: destination) }
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }
}
