import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

@Test func eachUserHasTheirOwnFolder() async throws {
    let root = TemporaryRoot()
    let alice = try root.open("user_a")
    let bob = try root.open("user_b")

    try await alice.write { writer in try writer.put(Tune(title: "Angeline the Baker")) }

    #expect(alice.folder != bob.folder)
    #expect(FileManager.default.fileExists(atPath: alice.folder.appending(path: "crosstune.sqlite").path()))
    #expect(FileManager.default.fileExists(atPath: bob.audioFolder.path()))
    #expect(try await alice.read { db in try Tune.fetchCount(db) } == 1)
    #expect(try await bob.read { db in try Tune.fetchCount(db) } == 0)
}

@Test(arguments: ["", "..", "user_a/../user_b", "user a", "ユーザー"])
func refusesAUserIDThatIsNotAPlainName(_ userID: String) {
    let root = TemporaryRoot()
    #expect(throws: CrosstuneStore.StoreError.invalidUserID(userID)) {
        try root.open(userID)
    }
}

@Test func deletingAUserRemovesTheirFolder() throws {
    let root = TemporaryRoot()
    let store = try root.open("user_a")
    try store.close()

    try CrosstuneStore.delete(userID: "user_a", root: root.url)
    try CrosstuneStore.delete(userID: "user_a", root: root.url)

    #expect(!FileManager.default.fileExists(atPath: store.folder.path()))
}

@Test func deletingOthersKeepsOnlyTheSignedInUser() throws {
    let root = TemporaryRoot()
    let kept = try root.open("user_a")
    let stale = try root.open("user_b")
    try stale.close()

    try CrosstuneStore.deleteOthers(keeping: "user_a", root: root.url)

    #expect(FileManager.default.fileExists(atPath: kept.folder.path()))
    #expect(!FileManager.default.fileExists(atPath: stale.folder.path()))
}

@Test func deletingOthersKeepsEveryListedUser() throws {
    let root = TemporaryRoot()
    let first = try root.open("user_a")
    let second = try root.open("user_b")
    let stale = try root.open("user_c")
    try stale.close()

    try CrosstuneStore.deleteOthers(keeping: ["user_a", "user_b"], root: root.url)

    #expect(FileManager.default.fileExists(atPath: first.folder.path()))
    #expect(FileManager.default.fileExists(atPath: second.folder.path()))
    #expect(!FileManager.default.fileExists(atPath: stale.folder.path()))
}

@Test func anOlderStoreStartsOverAndKeepsPreferences() async throws {
    let root = TemporaryRoot()
    let old = try root.open(schemaVersion: 1)
    try await old.write { writer in
        try writer.put(Tune(title: "Arkansas Traveler"))
        try RecordingFile(id: newID(), localState: .captured, updatedAt: noon).insert(writer.db)
        try writer.setMeta(.pullCursor, to: 99)
        try writer.setMeta(.invalidChanges, to: 3)
        try writer.setMeta(.keepOffline, to: true)
    }
    try old.close()

    let store = try root.open(schemaVersion: 2)
    #expect(try await store.meta(.invalidChanges, as: Int.self) == nil)

    #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
    #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    #expect(try await store.pendingChangeCount() == 0)
    #expect(try await store.meta(.pullCursor, as: Int.self) == nil)
    #expect(try await store.meta(.keepOffline, as: Bool.self) == true)
    #expect(try await store.read(Schema.storedVersion) == 2)
}

@Test func aNewerStoreIsDeleted() async throws {
    let root = TemporaryRoot()
    let newer = try root.open(schemaVersion: 2)
    try await newer.write { writer in
        try writer.put(Tune(title: "Billy in the Lowground"))
        try writer.setMeta(.keepOffline, to: true)
    }
    try newer.close()

    let store = try root.open(schemaVersion: 1)

    #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
    #expect(try await store.meta(.keepOffline, as: Bool.self) == nil)
    #expect(try await store.read(Schema.storedVersion) == 1)
}

@Test func reopeningTheCurrentVersionKeepsEverything() async throws {
    let root = TemporaryRoot()
    let first = try root.open()
    try await first.write { writer in
        try writer.put(Tune(title: "Whiskey Before Breakfast"))
        try writer.setMeta(.pullCursor, to: 7)
    }
    try first.close()

    let store = try root.open()

    #expect(try await store.read { db in try Tune.fetchCount(db) } == 1)
    #expect(try await store.pendingChangeCount() == 1)
    #expect(try await store.meta(.pullCursor, as: Int.self) == 7)
}

@Test func theSweepDeletesOnlyUnnamedAudioThatWasThereAtOpen() async throws {
    let root = TemporaryRoot()
    let first = try root.open()
    let kept = "\(newID()).m4a"
    let capturing = newID()
    try await first.write { writer in
        try RecordingFile(id: newID(), localState: .captured, fileName: kept, updatedAt: noon).insert(writer.db)
        try RecordingFile(id: capturing, localState: .capturing, fileName: "\(capturing).aac", updatedAt: noon)
            .insert(writer.db)
    }
    let names = [kept, "\(newID()).m4a", "\(newID()).mp3", "\(newID()).aac", "\(capturing).m4a"]
    for name in names {
        try Data([1]).write(to: first.audioFolder.appending(path: name))
    }
    try first.close()

    let store = try root.open()
    let later = "\(newID()).m4a"
    try Data([1]).write(to: store.audioFolder.appending(path: later))
    await store.deleteUnnamedAudio()

    let left = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
    #expect(
        Set(left) == [kept, names[3], names[4], later],
        "a capture, a capturing row's finished file, and a file written after open stay")
}

@MainActor
@Test func aLiveQueryFollowsWrites() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let titles = LiveQuery(store, initial: [String]()) { db in
        try String.fetchAll(db, Tune.select(Tune.CodingKeys.title).order(Tune.CodingKeys.title))
    }

    try await store.write { writer in try writer.put(Tune(title: "Red Haired Boy")) }

    let deadline = ContinuousClock.now + .seconds(5)
    while titles.value != ["Red Haired Boy"], ContinuousClock.now < deadline {
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(titles.value == ["Red Haired Boy"])
    #expect(titles.error == nil)
}
