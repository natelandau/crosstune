import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

/// A tune with one page, its file row, and its file on disk.
@discardableResult
private func pageWithFile(_ store: CrosstuneStore, origin: NotationOrigin = .captured) async throws -> URL {
    let name = "p1.jpg"
    let url = store.notationFolder.appending(path: name)
    try Data([1, 2, 3]).write(to: url)
    try await store.write { writer in
        let tune = try writer.put(Tune(id: "t1", title: "Soldier's Joy"))
        try writer.put(NotationPageRecord(id: "p1", tuneID: tune.id, width: 1700, height: 2200))
        try NotationFile(pageID: "p1", fileName: name, origin: origin).insert(writer.db)
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

    #expect(try await store.meta(.pullCursor, as: Int.self) == nil, "pages already on the server are pulled again")
    #expect(try await store.meta(.keepOffline, as: Bool.self) == true)
    #expect(try await store.pendingChangeCount() == 1)
    #expect(try await store.read { db in try db.tableExists("notation_pages") && db.tableExists("notation_files") })
    #expect(FileManager.default.fileExists(atPath: store.notationFolder.path(percentEncoded: false)))
}

@Test func droppingAPageFileRowRemovesItsFileAfterCommit() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await pageWithFile(store)

    try await store.writeDroppingFiles { writer in
        try writer.tombstone(NotationPageRecord.self, id: "p1")
        _ = try NotationFile.deleteOne(writer.db, key: "p1")
    }

    #expect(!FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
}

@Test func aFailedWriteKeepsThePageFile() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await pageWithFile(store)

    await #expect(throws: Deliberate.self) {
        try await store.writeDroppingFiles { writer in
            _ = try NotationFile.deleteOne(writer.db, key: "p1")
            throw Deliberate()
        }
    }

    #expect(FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
    #expect(try await store.read { db in try NotationFile.fetchCount(db) } == 1)
}

@Test func theSweepDeletesOnlyUnnamedPageFilesThatWereThereAtOpen() async throws {
    let root = TemporaryRoot()
    let first = try root.open()
    try await pageWithFile(first)
    let orphan = "\(newID()).jpg"
    try Data([1]).write(to: first.notationFolder.appending(path: orphan))
    try first.close()

    let store = try root.open()
    let later = "\(newID()).jpg"
    try Data([1]).write(to: store.notationFolder.appending(path: later))
    await store.deleteUnnamedFiles()

    let left = try FileManager.default.contentsOfDirectory(atPath: store.notationFolder.path(percentEncoded: false))
    #expect(Set(left) == ["p1.jpg", later], "a named page and one written after open stay")
}

@Test func aDownloadedPageStaysOutOfBackups() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await pageWithFile(store, origin: .downloaded)

    try store.applyBackupRule(toNotationFile: "p1.jpg", origin: .downloaded)

    #expect(try isExcludedFromBackup(url) == true)
}

@Test func aCapturedPageStaysInBackups() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let url = try await pageWithFile(store, origin: .downloaded)
    try store.applyBackupRule(toNotationFile: "p1.jpg", origin: .downloaded)
    #expect(try isExcludedFromBackup(url) == true)

    try store.applyBackupRule(toNotationFile: "p1.jpg", origin: .captured)

    #expect(try isExcludedFromBackup(url) == false)
}

@Test func aCapturedPageCountsAsNotUploadedUntilTheServerHasIt() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await pageWithFile(store)

    #expect(try await store.notUploadedNotationCount() == 1)

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE notation_pages SET state = 'ready'")
    }
    #expect(try await store.notUploadedNotationCount() == 0, "a page the server holds is not only here")

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE notation_pages SET state = 'pending_upload'")
        try writer.tombstone(NotationPageRecord.self, id: "p1")
    }
    #expect(try await store.notUploadedNotationCount() == 0, "a deleted page never holds up a sign-out")
}

@Test func aCapturedPageWhoseTuneIsGoneNeverHoldsUpASignOut() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await pageWithFile(store)

    try await store.write { writer in
        try writer.db.execute(sql: "UPDATE tunes SET deleted_at = '2026-10-03T21:00:00.000Z'")
    }
    #expect(try await store.notUploadedNotationCount() == 0, "a tune deleted elsewhere takes its page along")

    try await store.write { writer in try writer.db.execute(sql: "DELETE FROM tunes") }
    #expect(try await store.notUploadedNotationCount() == 0, "a page with no tune here is gone too")
}

@Test func aDownloadedPageIsNeverNotUploaded() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await pageWithFile(store, origin: .downloaded)

    #expect(try await store.notUploadedNotationCount() == 0)
}

@Test func aPageChangeNeverCarriesTheServersColumns() throws {
    let page = NotationPageRecord(
        id: "p1", tuneID: "t1", position: 2, width: 1700, height: 2200, state: "ready", fileBytes: 900)

    let data = try page.changeData()

    #expect(Set(data.keys) == ["created_at", "tune_id", "position", "width", "height"])
}

@Test func aPulledPageDecodesAndKeepsUnknownFields() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let wire: JSONObject = [
        "id": .string("p1"), "user_id": .string("user_a"), "tune_id": .string("t1"), "width": .integer(1700),
        "height": .integer(2200), "state": .string("ready"), "file_bytes": .integer(900),
        "created_at": .string("2026-09-25T12:00:00.000Z"), "updated_at": .string("2026-09-25T12:00:00.000Z"),
        "deleted_at": .null, "server_seq": .integer(4), "caption": .string("A part"),
    ]

    try await store.write { writer in try writer.applyPullPage(rows: [(.notationPages, wire)], nextSince: 4) }

    let page = try #require(try await store.read { db in try NotationPageRecord.fetchOne(db, key: "p1") })
    #expect(page.position == 0, "the contract's default")
    #expect(page.state == "ready")
    #expect(page.fileBytes == 900)
    #expect(page.extra == ["caption": .string("A part")])
}
