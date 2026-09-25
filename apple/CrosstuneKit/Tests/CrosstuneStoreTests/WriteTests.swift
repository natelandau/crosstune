import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

@Test func storesTheRowAndQueuesItsChangeTogether() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(createdAt: noon, title: "Soldier's Joy", modes: ["major"])

    let stored = try await store.write { writer in try writer.put(tune, at: noon) }

    #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) } == stored)
    let changes = try await store.pendingChanges(limit: 10)
    #expect(changes.count == 1)
    #expect(changes[0].tableName == .tunes)
    #expect(changes[0].rowID == tune.id)
    #expect(changes[0].op == .upsert)
    #expect(changes[0].updatedAt == noon)
    #expect(changes[0].data?["title"] == .string("Soldier's Joy"))
}

@Test func aFailedWriteStoresNothing() async throws {
    let root = TemporaryRoot()
    let store = try root.open()

    await #expect(throws: Deliberate.self) {
        try await store.write { writer in
            try writer.put(Tune(title: "Cluck Old Hen"))
            throw Deliberate()
        }
    }

    #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
    #expect(try await store.pendingChangeCount() == 0)
}

@Test func aSecondWriteReplacesTheChangeAndKeepsItsPlace() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let first = Tune(title: "Sally Goodin")
    let second = Tune(title: "Sally Ann")

    try await store.write { writer in
        try writer.put(first, at: noon)
        try writer.put(second, at: noon)
    }
    let seqBefore = try await store.pendingChanges(limit: 10)[0].seq
    var edited = first
    edited.title = "Sally Gooden"
    try await store.write { [edited] writer in try writer.put(edited, at: later(5)) }

    let changes = try await store.pendingChanges(limit: 10)
    #expect(changes.map(\.rowID) == [first.id, second.id])
    #expect(changes[0].seq == seqBefore)
    #expect(changes[0].data?["title"] == .string("Sally Gooden"))
    #expect(changes[0].updatedAt == later(5))
}

@Test func twoWritesInOneMillisecondGetDistinctTimes() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(title: "Forked Deer")

    let first = try await store.write { writer in try writer.put(tune, at: noon) }
    let second = try await store.write { writer in try writer.put(tune, at: noon) }
    let earlier = try await store.write { writer in try writer.put(tune, at: later(-50)) }

    #expect(first.updatedAt == noon)
    #expect(second.updatedAt == later(1))
    #expect(earlier.updatedAt == later(2))
}

@Test func clearingAFieldStoresAndSendsNull() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(title: "Bonaparte's Retreat", composer: "Traditional")
    try await store.write { writer in try writer.put(tune) }

    var cleared = tune
    cleared.composer = nil
    try await store.write { [cleared] writer in try writer.put(cleared) }

    #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.composer == nil)
    #expect(try await store.pendingChanges(limit: 1)[0].data?["composer"] == .null)
}

@Test func aFieldThisBuildDoesNotKnowSurvivesAnEdit() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let pulled = Tune(title: "Old Joe Clark", extra: ["tempo": .integer(120), "region": .string("Kentucky")])
    try await store.write { writer in try pulled.insert(writer.db) }

    // A screen that builds the row afresh leaves extra empty; the stored one is kept.
    var edited = Tune(id: pulled.id, createdAt: pulled.createdAt, title: "Old Joe Clark")
    edited.key = "A"
    let stored = try await store.write { [edited] writer in try writer.put(edited) }

    #expect(stored.extra == pulled.extra)
    let data = try #require(try await store.pendingChanges(limit: 1)[0].data)
    #expect(data["tempo"] == .integer(120))
    #expect(data["region"] == .string("Kentucky"))
    #expect(data["key"] == .string("A"))
}

@Test func changeDataCarriesOnlyEditableFields() throws {
    let recording = Recording(
        createdAt: noon, deletedAt: noon, serverSeq: 42, tuneID: nil, source: "microphone", recordedAt: noon,
        state: "ready", durationMs: 1000, playbackMime: "audio/mp4", playbackBytes: 2048, error: "none",
        extra: ["user_id": .string("someone"), "added_by_user_id": .string("someone"), "mood": .string("jolly")])

    let data = try recording.changeData()

    #expect(Set(data.keys) == ["created_at", "tune_id", "source", "recorded_at", "label", "position", "mood"])
    #expect(data["created_at"] == .string("2026-09-25T12:00:00.000Z"))
    #expect(data["tune_id"] == .null)
}

@Test func aTombstoneQueuesADelete() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let link = RecordingLink(tuneID: newID(), url: "https://example.com", provider: "other")
    try await store.write { writer in try writer.put(link, at: noon) }

    try await store.write { writer in try writer.tombstone(RecordingLink.self, id: link.id, at: noon) }

    let stored = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: link.id) })
    #expect(stored.deletedAt == later(1))
    #expect(stored.updatedAt == later(1))
    let change = try await store.pendingChanges(limit: 1)[0]
    #expect(change.op == .delete)
    #expect(change.data == nil)
    #expect(change.updatedAt == later(1))
}

@Test func aCascadedTombstoneDropsThePendingChange() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let item = ListItem(listID: newID(), userTuneID: newID())
    try await store.write { writer in try writer.put(item) }

    try await store.write { writer in
        try writer.tombstone(ListItem.self, id: item.id, enqueueDelete: false)
    }

    #expect(try await store.read { db in try ListItem.fetchOne(db, key: item.id) }?.deletedAt != nil)
    #expect(try await store.pendingChangeCount() == 0)
}

@Test func everyTableRoundTrips() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(
        title: "Grey Eagle", alternateTitles: ["Gray Eagle"], modes: ["major", "mixolydian"],
        timeSignature: "2/4", tunings: ["violin": .string("AEAE")])
    let userTune = UserTune(tuneID: tune.id, status: "learning", learnedOn: "2026-09-01", archivedAt: noon)
    let list = TuneList(name: "Jam", position: 3)
    let item = ListItem(listID: list.id, userTuneID: userTune.id)
    let link = RecordingLink(tuneID: tune.id, url: "https://example.com", provider: "youtube", artworkURL: "a")
    let recording = Recording(tuneID: tune.id, source: "upload", recordedAt: noon, durationMs: 5)
    let settings = UserSettings(instruments: ["violin", "banjo"])

    try await store.write { writer in
        _ = try writer.put(tune, at: noon)
        _ = try writer.put(userTune, at: noon)
        _ = try writer.put(list, at: noon)
        _ = try writer.put(item, at: noon)
        _ = try writer.put(link, at: noon)
        _ = try writer.put(recording, at: noon)
        _ = try writer.put(settings, at: noon)
    }

    func fetch<Record: SyncedRecord>(_ row: Record) async throws -> Record? {
        try await store.read { db in try Record.fetchOne(db, key: row.id) }
    }
    #expect(try await fetch(tune)?.tunings == tune.tunings)
    #expect(try await fetch(tune)?.alternateTitles == ["Gray Eagle"])
    #expect(try await fetch(userTune)?.archivedAt == noon)
    #expect(try await fetch(list)?.position == 3)
    #expect(try await fetch(item)?.userTuneID == userTune.id)
    #expect(try await fetch(link)?.artworkURL == "a")
    #expect(try await fetch(recording)?.durationMs == 5)
    #expect(try await fetch(settings)?.instruments == ["violin", "banjo"])
    #expect(try await store.pendingChangeCount() == 7)
}
