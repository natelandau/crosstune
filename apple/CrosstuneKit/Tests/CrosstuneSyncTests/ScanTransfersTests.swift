import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore
@testable import CrosstuneSync

@MainActor
@Suite struct ScanTransfersTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()

    init() throws {
        store = try root.open()
    }

    func engine() -> SyncEngine {
        SyncEngine(store: store, api: api, isOffline: { false }, sleep: sleeper.sleep)
    }

    /// A scan added on this device: its image in the scans folder under a captured name, its
    /// `captured` file row, and its row as the server stored it (`serverSeq` 0 is a row the
    /// server never stored), with nothing queued unless `queued`.
    @discardableResult
    func capturedScan(
        _ id: String, image: String = "scan image", serverSeq: Int64 = 1,
        state: String = ScanRecord.pendingUpload, error: String? = nil, attempts: Int = 0,
        nextAttemptAt: Timestamp? = nil, queued: Bool = false
    ) async throws -> URL {
        let name = "\(id)-\(UUID().uuidString).jpg"
        let url = store.scansFolder.appending(path: name)
        try Data(image.utf8).write(to: url)
        try await store.write { writer in
            try Self.tune(writer.db)
            try writer.put(
                ScanRecord(
                    id: id, createdAt: noon, serverSeq: serverSeq, tuneID: "t1", width: 600, height: 800,
                    state: state))
            try ScanFile(
                scanID: id, fileName: name, origin: .captured, error: error, uploadAttempts: attempts,
                nextAttemptAt: nextAttemptAt
            ).insert(writer.db)
            if !queued { try OutboxEntry.deleteAll(writer.db) }
        }
        try store.applyBackupRule(toScanFile: name, origin: .captured)
        return url
    }

    /// A scan another device uploaded, with no file here.
    func readyScan(_ id: String) async throws {
        try await store.write { writer in
            try Self.tune(writer.db)
            try ScanRecord(
                id: id, createdAt: noon, serverSeq: 3, tuneID: "t1", width: 600, height: 800,
                state: ScanRecord.ready
            ).insert(writer.db)
        }
    }

    /// The tune every scan here is on, as the server stored it, with nothing queued.
    nonisolated static func tune(_ db: Database) throws {
        try Tune(id: "t1", createdAt: noon, serverSeq: 1, title: "Soldier's Joy").insert(db, onConflict: .ignore)
    }

    /// A finished recording capture whose row the server already has.
    func capturedRecording(_ id: String) async throws {
        let name = "\(id).m4a"
        try Data("captured audio".utf8).write(to: store.audioFolder.appending(path: name))
        try await store.write { writer in
            try RecordingFile(
                id: id, localState: .captured, fileName: name, contentType: "audio/mp4", bytes: 14
            ).insert(writer.db)
            try writer.put(
                Recording(
                    id: id, createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon,
                    state: "pending_upload"))
            try OutboxEntry.deleteAll(writer.db)
        }
    }

    func file(_ id: String) async throws -> ScanFile? {
        try await store.read { db in try ScanFile.fetchOne(db, key: id) }
    }

    func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    func isExcludedFromBackup(_ url: URL) throws -> Bool {
        try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true
    }

    nonisolated static func tombstone(_ id: String) -> JSONObject {
        [
            "id": .string(id), "created_at": .string(noon.iso), "updated_at": .string(later(60_000).iso),
            "deleted_at": .string(later(60_000).iso), "server_seq": .integer(5), "tune_id": .string("t1"),
            "position": .integer(0), "width": .integer(600), "height": .integer(800), "state": .string("ready"),
        ]
    }

    // MARK: Upload

    @Test func uploadsACapturedScanOnceItsRowIsPushed() async throws {
        let image = try await capturedScan("p1", image: "twelve bytes", queued: true)
        let engine = engine()

        await engine.transfer()
        #expect(api.transfers.isEmpty)

        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }
        await engine.transfer()

        #expect(api.transfers == ["scan-slot p1", "put p1", "scan-confirm p1"])
        #expect(api.scanSlotBytes["p1"] == 12)
        #expect(api.putBodies["p1"]?.data == Data("twelve bytes".utf8))
        #expect(api.putBodies["p1"]?.contentType == "image/jpeg")
        let file = try #require(try await file("p1"))
        // The server holds the bytes now, so the kept file is a cache like any download.
        #expect(file.origin == .downloaded)
        #expect(file.fileName == image.lastPathComponent)
        #expect(file.error == nil)
        #expect(exists(image))
        #expect(try isExcludedFromBackup(image))
        #expect(engine.transferStatus == .idle)
    }

    @Test func aScanPendingBeforeTheRenameStillUploads() async throws {
        let oldRoot = TemporaryRoot()
        let folder = try CrosstuneStore.folder(for: "user_a", in: oldRoot.url)
        let scans = folder.appending(path: "scans", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: scans, withIntermediateDirectories: true)
        let pool = try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
        try Schema.migrator.migrate(pool, upTo: "v11")
        let queued = try ScanRecord(id: "p1", createdAt: noon, tuneID: "t1", width: 600, height: 800).changeData()
        let queuedJSON = String(decoding: try JSONEncoder().encode(queued), as: UTF8.self)
        try await pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO tunes
                        (id, created_at, updated_at, server_seq, title, alternate_titles, modes, is_crooked,
                         tunings, extra)
                    VALUES ('t1', ?, ?, 1, 'Jam', '[]', '[]', 0, '{}', '{}')
                    """,
                arguments: [noon.iso, noon.iso])
            try db.execute(
                sql: """
                    INSERT INTO notation_pages
                        (id, created_at, updated_at, server_seq, tune_id, position, width, height, state, extra)
                    VALUES ('p1', ?, ?, 0, 't1', 0, 600, 800, 'pending_upload', '{}')
                    """,
                arguments: [noon.iso, noon.iso])
            try db.execute(
                sql: "INSERT INTO notation_files (page_id, file_name, origin) VALUES ('p1', 'p1-a.jpg', 'captured')")
            try db.execute(
                sql: """
                    INSERT INTO outbox (table_name, row_id, op, updated_at, data)
                    VALUES ('notation_pages', 'p1', 'upsert', ?, ?)
                    """,
                arguments: [noon.iso, queuedJSON])
        }
        try pool.close()
        try Data("old image".utf8).write(to: scans.appending(path: "p1-a.jpg"))

        let migrated = try oldRoot.open()
        // The server answers a stored scan row with the upload state it sets.
        api.respondToPush = { changes in
            changes.map { change in
                var row = FakeSyncAPI.echo(change)
                row?["state"] = .string(ScanRecord.pendingUpload)
                return PushResult(table: change.table, id: change.id, status: .applied, row: row)
            }
        }
        let engine = SyncEngine(store: migrated, api: api, isOffline: { false }, sleep: sleeper.sleep)
        await engine.sync()
        #expect(api.pushes.flatMap { $0 }.map(\.table) == [.scans])
        #expect(try await migrated.pendingChangeCount() == 0)
        await engine.transfer()

        #expect(api.transfers.contains("scan-slot p1"))
        #expect(api.transfers.contains("scan-confirm p1"))
        #expect(api.putBodies["p1"]?.data == Data("old image".utf8))
        let file = try #require(try await migrated.read { db in try ScanFile.fetchOne(db, key: "p1") })
        #expect(file.origin == .downloaded)
    }

    @Test func keepsACapturedScanInTheBackupUntilItUploads() async throws {
        let image = try await capturedScan("p1", queued: true)

        await engine().transfer()

        #expect(try !isExcludedFromBackup(image))
    }

    @Test func settlesAScanPastPendingAsUploaded() async throws {
        try await capturedScan("p1", state: ScanRecord.ready)

        await engine().transfer()

        #expect(api.transfers.isEmpty)
        #expect(try await file("p1")?.origin == .downloaded)
    }

    @Test func dropsTheRowOfAnUploadedScanWhoseImageIsGoneSoItDownloadsAgain() async throws {
        let image = try await capturedScan("p1", state: ScanRecord.ready)
        try FileManager.default.removeItem(at: image)

        await engine().transfer()

        #expect(api.transfers == ["scan-url p1", "get p1"])
        let file = try #require(try await file("p1"))
        #expect(file.origin == .downloaded)
        #expect(try file.fileName == downloadedScanName("p1"))
        #expect(exists(store.scansFolder.appending(path: file.fileName)))
    }

    @Test func aScanDeletedDuringItsUploadLeavesTheRunClean() async throws {
        let image = try await capturedScan("p1")
        let store = store
        api.onTransfer = { entry in
            guard entry == "scan-confirm p1" else { return }
            // As deleting the scan does: tombstone it and let go of its file.
            try? await store.writeDroppingFiles { writer in
                try writer.tombstone(ScanRecord.self, id: "p1")
                try ScanFile.deleteOne(writer.db, key: "p1")
            }
        }
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers == ["scan-slot p1", "put p1", "scan-confirm p1"])
        #expect(try await file("p1") == nil)
        #expect(!exists(image))
        #expect(engine.transferStatus == .idle)
    }

    @Test func takesASlotConflictAsAlreadyUploaded() async throws {
        try await capturedScan("p1")
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 409)

        await engine().transfer()

        #expect(api.transfers == ["scan-slot p1"])
        #expect(try await file("p1")?.origin == .downloaded)
    }

    @Test func quotaRefusalMarksTheScanStorageFullUntilTheFiguresShowRoom() async throws {
        let image = try await capturedScan("p1", image: "0123456789")
        api.transferFailures["scan-slot p1"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This scan would pass your storage quota.")
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("p1"))
        #expect(file.origin == .captured)
        #expect(file.error == ScanFile.storageFullError)
        #expect(file.uploadAttempts == 0)
        #expect(exists(image))
        #expect(engine.transferStatus == .idle)

        api.transferFailures = [:]
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 95, quotaBytes: 100, maxFileBytes: 50))
        await engine.transfer()
        #expect(api.transfers == ["scan-slot p1"])

        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 50, quotaBytes: 100, maxFileBytes: 50))
        await engine.transfer()
        #expect(api.transfers == ["scan-slot p1", "scan-slot p1", "put p1", "scan-confirm p1"])
        #expect(try await self.file("p1")?.error == nil)
    }

    @Test func marksAScanTheServerNeverStoredRefusedWithoutQueuingItAgain() async throws {
        let image = try await capturedScan("p1", serverSeq: 0)
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 404)
        let engine = engine()

        await engine.transfer()
        await engine.transfer()

        #expect(api.transfers == ["scan-slot p1"])
        let file = try #require(try await file("p1"))
        #expect(file.error == ScanFile.refusedError)
        #expect(file.origin == .captured)
        #expect(exists(image))
        #expect(try await store.pendingChanges(limit: 10).isEmpty)
        #expect(engine.transferStatus == .idle)
    }

    @Test func backsOffAStoredScanTheSlotCannotFindAndWaitsForItsTombstone() async throws {
        let image = try await capturedScan("p1", serverSeq: 4)
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 404)
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("p1"))
        #expect(file.error == "API request failed with status 404")
        #expect(file.uploadAttempts == 1)
        #expect(file.nextAttemptAt != nil)
        #expect(try await store.pendingChanges(limit: 10).isEmpty)
        #expect(engine.transferStatus == .idle)

        try await store.write { writer in
            try writer.applyPullPage(rows: [(.scans, Self.tombstone("p1"))], nextSince: 5)
        }
        await engine.transfer()

        #expect(try await self.file("p1") == nil)
        #expect(!exists(image))
    }

    @Test func uploadsARefusedScanOnceTheServerHasStoredItsRow() async throws {
        try await capturedScan("p1", serverSeq: 0, error: ScanFile.refusedError)
        let engine = engine()

        await engine.transfer()
        #expect(api.transfers.isEmpty)

        try await store.write { writer in
            try writer.db.execute(sql: "UPDATE scans SET server_seq = 7 WHERE id = 'p1'")
        }
        await engine.transfer()

        #expect(api.transfers == ["scan-slot p1", "put p1", "scan-confirm p1"])
        let file = try #require(try await file("p1"))
        #expect(file.error == nil)
        #expect(file.origin == .downloaded)
    }

    @Test func backsOffATransientFailureAndKeepsItsReason() async throws {
        try await capturedScan("p1", attempts: 2)
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 500)
        let engine = engine()
        let before = Timestamp.now

        await engine.transfer()

        let after = Timestamp.now
        let file = try #require(try await file("p1"))
        #expect(file.origin == .captured)
        #expect(file.uploadAttempts == 3)
        #expect(file.error == "API request failed with status 500")
        let next = try #require(file.nextAttemptAt).milliseconds
        #expect(next >= before.milliseconds + 120_000 && next <= after.milliseconds + 120_000)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }

    @Test func skipsAScanStillInItsBackoff() async throws {
        try await capturedScan(
            "p1", attempts: 1, nextAttemptAt: Timestamp(milliseconds: Timestamp.now.milliseconds + 60_000))

        await engine().transfer()

        #expect(api.transfers.isEmpty)
    }

    @Test func backsOffARefusalOfTheRequestWithoutFailingTheRun() async throws {
        try await capturedScan("p1")
        try await capturedScan("p2")
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 422, detail: "Not a JPEG.")
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("p1"))
        #expect(file.origin == .captured)
        #expect(file.uploadAttempts == 1)
        #expect(file.error == "Not a JPEG.")
        #expect(try await self.file("p2")?.origin == .downloaded)
        #expect(engine.transferStatus == .idle)
    }

    @Test func asksForAFreshSlotWhenConfirmationFindsNoImage() async throws {
        try await capturedScan("p1")
        api.transferFailures["scan-confirm p1"] = APIStatusError(status: 409)
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("p1"))
        #expect(file.origin == .captured)
        #expect(file.uploadAttempts == 1)
        #expect(engine.transferStatus == .idle)
    }

    @Test func anAuthFailureEndsThePass() async throws {
        try await capturedScan("p1")
        try await capturedScan("p2")
        api.transferFailures["scan-slot p1"] = APIStatusError(status: 401)
        api.transferFailures["scan-slot p2"] = APIStatusError(status: 401)
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers.count == 1)
        engine.stop()
    }

    @Test func marksAScanWhoseImageIsGoneRefusedWithoutARequest() async throws {
        let image = try await capturedScan("p1")
        try FileManager.default.removeItem(at: image)

        await engine().transfer()

        #expect(api.transfers.isEmpty)
        #expect(try await file("p1")?.error == ScanFile.refusedError)
    }

    @Test func aStoppedPassSendsNothing() async throws {
        try await capturedScan("p1")
        try await readyScan("p2")
        let stopped = ScanTransfers(store: store, api: api, checkStopped: { throw RunStopped() })

        await #expect(throws: RunStopped.self) { _ = try await stopped.uploadPass() }
        await #expect(throws: RunStopped.self) { try await stopped.downloadPass(retries: DownloadRetries()) }

        #expect(api.transfers.isEmpty)
        #expect(try await file("p1")?.origin == .captured)
        #expect(try await file("p2") == nil)
    }

    // MARK: Tombstones

    @Test func dropsTheFileOfAScanTombstonedElsewhere() async throws {
        let uploaded = try await capturedScan("p1", state: ScanRecord.ready)
        let captured = try await capturedScan("p2")
        try await store.write { writer in
            try writer.applyPullPage(
                rows: [(.scans, Self.tombstone("p1")), (.scans, Self.tombstone("p2"))], nextSince: 5)
        }

        await engine().transfer()

        #expect(try await file("p1") == nil)
        #expect(try await file("p2") == nil)
        #expect(!exists(uploaded))
        #expect(!exists(captured))
        #expect(api.transfers.isEmpty)
    }

    @Test func dropsTheFileOfARefusedScanWhoseTuneWasDeletedElsewhere() async throws {
        let image = try await capturedScan("p1", serverSeq: 0, error: ScanFile.refusedError)
        var deleted = serverTune(id: "t1", serverSeq: 6)
        deleted["updated_at"] = .string(later(60_000).iso)
        deleted["deleted_at"] = .string(later(60_000).iso)
        let tombstone = deleted
        try await store.write { writer in
            try writer.applyPullPage(rows: [(.tunes, tombstone)], nextSince: 6)
        }

        await engine().transfer()

        #expect(try await file("p1") == nil)
        #expect(!exists(image))
        #expect(try await store.notUploadedScanCount() == 0)
    }

    @Test func dropsTheFileOfAScanWhoseTuneIsNotHere() async throws {
        let image = try await capturedScan("p1")
        try await store.write { writer in _ = try Tune.deleteOne(writer.db, key: "t1") }

        await engine().transfer()

        #expect(try await file("p1") == nil)
        #expect(!exists(image))
        #expect(api.transfers.isEmpty)
    }

    @Test func downloadsNothingForAScanWhoseTuneIsDeletedOrNotHere() async throws {
        try await readyScan("p1")
        try await store.write { writer in
            try writer.db.execute(sql: "UPDATE tunes SET deleted_at = ?", arguments: [later(60_000).iso])
            try ScanRecord(
                id: "p2", createdAt: noon, serverSeq: 3, tuneID: "elsewhere", width: 1, height: 1,
                state: ScanRecord.ready
            ).insert(writer.db)
        }

        await engine().transfer()

        #expect(api.transfers.isEmpty)
    }

    @Test func dropsAFileWithNoScanRow() async throws {
        let url = store.scansFolder.appending(path: "orphan.jpg")
        try Data("x".utf8).write(to: url)
        try await store.write { writer in
            try ScanFile(scanID: "orphan", fileName: "orphan.jpg", origin: .downloaded).insert(writer.db)
        }

        await engine().transfer()

        #expect(try await file("orphan") == nil)
        #expect(!exists(url))
    }

    // MARK: Download

    @Test func downloadsReadyScansWithKeepOfflineOff() async throws {
        try await store.setMeta(.keepOffline, to: false)
        try await readyScan("p1")
        try await capturedScan("mine", state: ScanRecord.ready, queued: true)

        await engine().transfer()

        #expect(api.transfers == ["scan-url p1", "get p1"])
        let file = try #require(try await file("p1"))
        #expect(file.origin == .downloaded)
        let url = store.scansFolder.appending(path: file.fileName)
        #expect(try Data(contentsOf: url) == api.objectData)
        #expect(try isExcludedFromBackup(url))
    }

    @Test func downloadsNothingForAScanWaitingForItsUpload() async throws {
        try await store.write { writer in
            try ScanRecord(id: "p1", createdAt: noon, serverSeq: 3, tuneID: "t1", width: 1, height: 1)
                .insert(writer.db)
        }

        await engine().transfer()

        #expect(api.transfers.isEmpty)
    }

    @Test func keepsNoImageOfAScanDeletedDuringItsDownload() async throws {
        try await readyScan("p1")
        let store = store
        api.onTransfer = { entry in
            guard entry == "get p1" else { return }
            try? await store.write { writer in
                try writer.applyPullPage(rows: [(.scans, Self.tombstone("p1"))], nextSince: 5)
            }
        }

        await engine().transfer()

        #expect(try await file("p1") == nil)
        let left = try FileManager.default.contentsOfDirectory(atPath: store.scansFolder.path(percentEncoded: false))
        #expect(left.isEmpty)
    }

    @Test func oneScansFailedDownloadWaitsOutItsBackoffWithoutStoppingTheRest() async throws {
        try await readyScan("p1")
        try await readyScan("p2")
        api.transferFailures["get p1"] = TransferError(status: 403)
        var now = ContinuousClock.now
        let engine = engine()
        engine.scanRetries.now = { now }

        await engine.transfer()
        #expect(try await file("p1") == nil)
        #expect(try await file("p2")?.origin == .downloaded)
        #expect(engine.transferStatus == .idle)

        api.transferFailures = [:]
        await engine.transfer()
        #expect(api.transfers.filter { $0 == "scan-url p1" }.count == 1)

        now = now.advanced(by: uploadBackoff(attempts: 0))
        await engine.transfer()
        #expect(try await file("p1")?.origin == .downloaded)
        engine.stop()
    }

    // MARK: Order

    @Test func scansRunBeforeRecordings() async throws {
        try await capturedRecording("r1")
        try await capturedScan("p1")
        try await readyScan("p2")

        await engine().transfer()

        #expect(
            api.transfers == [
                "scan-slot p1", "put p1", "scan-confirm p1", "scan-url p2", "get p2", "slot r1", "put r1",
                "confirm r1",
            ])
    }

    @Test func aFailedScanDownloadStillLetsRecordingsTransferThenFailsTheRun() async throws {
        try await capturedRecording("r1")
        try await readyScan("p1")
        api.transferFailures["scan-url p1"] = URLError(.timedOut)
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers == ["scan-url p1", "slot r1", "put r1", "confirm r1"])
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") }?.localState == .uploaded)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }
}
