import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

/// A tune with one scan, its file row, and its file on disk.
@discardableResult
private func scanWithFile(_ store: CrosstuneStore, origin: ScanOrigin = .captured) async throws -> URL {
    let name = "p1.jpg"
    let url = store.scansFolder.appending(path: name)
    try Data([1, 2, 3]).write(to: url)
    try await store.write { writer in
        let tune = try writer.put(Tune(id: "t1", title: "Soldier's Joy"))
        try writer.put(ScanRecord(id: "p1", tuneID: tune.id, width: 1700, height: 2200))
        try ScanFile(scanID: "p1", fileName: name, origin: origin).insert(writer.db)
    }
    return url
}

private func isExcludedFromBackup(_ url: URL) throws -> Bool? {
    // A URL caches resource values it has read, which would hide a later change.
    var url = url
    url.removeAllCachedResourceValues()
    return try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
}

@Test func theV10MigrationPullsEveryRowAgain() async throws {
    let root = TemporaryRoot()
    let folder = try CrosstuneStore.folder(for: "user_a", in: root.url)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let pool = try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
    try Schema.migrator.migrate(pool, upTo: "v9")
    try await pool.write { db in
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data)
                VALUES ('tunes', 't1', 'upsert', '2026-09-25T12:00:00.000Z', '{"title":"Jam"}')
                """)
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('pull_cursor', '5'), ('keep_offline', 'true')")
    }
    try pool.close()

    let store = try root.open()

    #expect(try await store.meta(.pullCursor, as: Int.self) == nil, "scans already on the server are pulled again")
    #expect(try await store.meta(.keepOffline, as: Bool.self) == true)
    #expect(try await store.pendingChangeCount() == 1)
    #expect(try await store.read { db in try db.tableExists("scans") && db.tableExists("scan_files") })
    #expect(FileManager.default.fileExists(atPath: store.scansFolder.path(percentEncoded: false)))
}

@Test func droppingAScanFileRowRemovesItsFileAfterCommit() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await scanWithFile(store)

    try await store.writeDroppingFiles { writer in
        try writer.tombstone(ScanRecord.self, id: "p1")
        _ = try ScanFile.deleteOne(writer.db, key: "p1")
    }

    #expect(!FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
}

@Test func aFailedWriteKeepsTheScanFile() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await scanWithFile(store)

    await #expect(throws: Deliberate.self) {
        try await store.writeDroppingFiles { writer in
            _ = try ScanFile.deleteOne(writer.db, key: "p1")
            throw Deliberate()
        }
    }

    #expect(FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
    #expect(try await store.read { db in try ScanFile.fetchCount(db) } == 1)
}

@Test func theSweepDeletesOnlyUnnamedScanFilesThatWereThereAtOpen() async throws {
    let root = TemporaryRoot()
    let first = try root.open()
    try await scanWithFile(first)
    let orphan = "\(newID()).jpg"
    try Data([1]).write(to: first.scansFolder.appending(path: orphan))
    try first.close()

    let store = try root.open()
    let later = "\(newID()).jpg"
    try Data([1]).write(to: store.scansFolder.appending(path: later))
    await store.deleteUnnamedFiles()

    let left = try FileManager.default.contentsOfDirectory(atPath: store.scansFolder.path(percentEncoded: false))
    #expect(Set(left) == ["p1.jpg", later], "a named scan and one written after open stay")
}

@Test func aDownloadedScanStaysOutOfBackups() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await scanWithFile(store, origin: .downloaded)

    try store.applyBackupRule(toScanFile: "p1.jpg", origin: .downloaded)

    #expect(try isExcludedFromBackup(url) == true)
}

@Test func aCapturedScanStaysInBackups() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await scanWithFile(store, origin: .downloaded)
    try store.applyBackupRule(toScanFile: "p1.jpg", origin: .downloaded)
    #expect(try isExcludedFromBackup(url) == true)

    try store.applyBackupRule(toScanFile: "p1.jpg", origin: .captured)

    // macOS writes an exclusion again shortly after setResourceValues returns, so clearing one
    // just set can read as excluded until the clear's own deferred write lands.
    #expect(try await poll { try isExcludedFromBackup(url) == false })
}

@Test func aCapturedScanCountsAsNotUploadedUntilTheServerHasIt() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await scanWithFile(store)

    #expect(try await store.notUploadedScanCount() == 1)

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE scans SET state = 'ready'")
    }
    #expect(try await store.notUploadedScanCount() == 0, "a scan the server holds is not only here")

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE scans SET state = 'pending_upload'")
        try writer.tombstone(ScanRecord.self, id: "p1")
    }
    #expect(try await store.notUploadedScanCount() == 0, "a deleted scan never holds up a sign-out")
}

@Test func aCapturedScanWhoseTuneIsGoneNeverHoldsUpASignOut() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await scanWithFile(store)

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE tunes SET deleted_at = '2026-10-03T21:00:00.000Z'")
    }
    #expect(try await store.notUploadedScanCount() == 0, "a tune deleted elsewhere takes its scan along")

    try await store.write { writer in try writer.db.execute(sql: "DELETE FROM tunes") }
    #expect(try await store.notUploadedScanCount() == 0, "a scan with no tune here is gone too")
}

@Test func aDownloadedScanIsNeverNotUploaded() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await scanWithFile(store, origin: .downloaded)

    #expect(try await store.notUploadedScanCount() == 0)
}

@Test func aScanChangeNeverCarriesTheServersColumns() throws {
    let scan = ScanRecord(
        id: "p1", tuneID: "t1", position: 2, width: 1700, height: 2200, state: "ready", fileBytes: 900)

    let data = try scan.changeData()

    #expect(Set(data.keys) == ["created_at", "tune_id", "position", "width", "height"])
}

@Test func aPulledScanDecodesAndKeepsUnknownFields() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let wire: JSONObject = [
        "id": .string("p1"), "user_id": .string("user_a"), "tune_id": .string("t1"), "width": .integer(1700),
        "height": .integer(2200), "state": .string("ready"), "file_bytes": .integer(900),
        "created_at": .string("2026-09-25T12:00:00.000Z"), "updated_at": .string("2026-09-25T12:00:00.000Z"),
        "deleted_at": .null, "server_seq": .integer(4), "caption": .string("A part"),
    ]

    try await store.write { writer in try writer.applyPullPage(rows: [(.scans, wire)], nextSince: 4) }

    let scan = try #require(try await store.read { db in try ScanRecord.fetchOne(db, key: "p1") })
    #expect(scan.position == 0, "the contract's default")
    #expect(scan.state == "ready")
    #expect(scan.fileBytes == 900)
    #expect(scan.extra == ["caption": .string("A part")])
}
