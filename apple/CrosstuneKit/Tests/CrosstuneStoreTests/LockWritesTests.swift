import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

@Test func lockingWritesRefusesEveryLaterWrite() async throws {
    let root = TemporaryRoot()
    let store = try root.open()

    #expect(try await store.lockWritesUnlessUnsent())

    #expect(store.isClosed)
    await #expect(throws: CrosstuneStore.StoreError.writesLocked) {
        try await store.write { writer in try writer.put(Tune(createdAt: noon, title: "Too late")) }
    }
    await #expect(throws: CrosstuneStore.StoreError.writesLocked) { try await store.setMeta(.pullCursor, to: 1) }
    #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
}

@Test func lockingWritesIsDisabledWhileWorkIsOnlyHere() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await store.write { writer in try writer.put(Tune(createdAt: noon, title: "Unsent")) }

    #expect(try await store.lockWritesUnlessUnsent() == false)

    #expect(!store.isClosed)
    try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }
}

@Test func lockingWritesCountsARecordingOrScanNotYetUploaded() async throws {
    let root = TemporaryRoot()
    let recording = try root.open("user_a")
    try await recording.write { writer in try RecordingFile(id: "r1", localState: .captured).insert(writer.db) }
    #expect(try await recording.lockWritesUnlessUnsent() == false)

    let scan = try root.open("user_b")
    try await scan.write { writer in
        try Tune(id: "t1", title: "Soldier's Joy").insert(writer.db)
        try ScanRecord(id: "p1", tuneID: "t1", width: 600, height: 800).insert(writer.db)
        try ScanFile(scanID: "p1", fileName: "p1-a.jpg", origin: .captured).insert(writer.db)
    }
    #expect(try await scan.lockWritesUnlessUnsent() == false)
}
