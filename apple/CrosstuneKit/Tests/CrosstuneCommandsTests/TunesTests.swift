import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

@Suite struct CreateTuneTests {
    @Test func writesTheTuneAndTheUserTuneWithDefaultsAndQueuesBoth() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let (tuneID, userTuneID) = try await commands.createTune(
            TuneInput(title: " Cluck Old Hen "), userTune: UserTuneInput(status: "learning"), at: noon)

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: tuneID) })
        #expect(tune.title == "Cluck Old Hen")
        #expect(tune.alternateTitles == [])
        #expect(tune.isCrooked == false)
        #expect(tune.timeSignature == nil)
        #expect(tune.deletedAt == nil)
        #expect(tune.serverSeq == 0)
        #expect(tune.createdAt == noon)
        #expect(tune.updatedAt == noon)
        let userTune = try #require(try await store.read { db in try UserTune.fetchOne(db, key: userTuneID) })
        #expect(userTune.tuneID == tuneID)
        #expect(userTune.status == "learning")
        #expect(userTune.archivedAt == nil)

        let queued = try await store.pendingChanges(limit: 10)
        #expect(queued.queuedOps == [QueuedOp(table: .tunes, op: .upsert), QueuedOp(table: .userTunes, op: .upsert)])
        #expect(queued[0].data?.keys.contains("id") == false)
        #expect(queued[1].data?.keys.contains("user_id") == false)
    }

    @Test func createsATuneWithItsTuningsMapOrAnEmptyOne() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let withMap = try await commands.createTune(
            TuneInput(title: "Sally Ann", tunings: ["guitar": .object(["capo": .integer(2)])]),
            userTune: UserTuneInput(status: "known"))
        let stored = try #require(try await store.read { db in try Tune.fetchOne(db, key: withMap.tuneID) })
        #expect(stored.tunings == ["guitar": .object(["capo": .integer(2)])])

        let without = try await commands.createTune(
            TuneInput(title: "Sally Goodin"), userTune: UserTuneInput(status: "known"))
        let storedWithout = try #require(try await store.read { db in try Tune.fetchOne(db, key: without.tuneID) })
        #expect(storedWithout.tunings == [:])
    }

    @Test func createsATuneWithATypePartModesAndAComposer() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let (tuneID, _) = try await commands.createTune(
            TuneInput(title: "The Kesh", tuneType: "Jig", modes: ["major", "mixolydian"], composer: "Traditional"),
            userTune: UserTuneInput(status: "known"))

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: tuneID) })
        #expect(tune.tuneType == "Jig")
        #expect(tune.modes == ["major", "mixolydian"])
        #expect(tune.composer == "Traditional")
    }

    @Test func createsATuneWithNoTypeModesOrComposerAsEmptyValues() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let (tuneID, _) = try await commands.createTune(
            TuneInput(title: "Sally Ann"), userTune: UserTuneInput(status: "known"))

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: tuneID) })
        #expect(tune.tuneType == nil)
        #expect(tune.modes == [])
        #expect(tune.composer == nil)
    }

    @Test func rejectsAnEmptyTitle() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.tuneTitleRequired) {
            try await commands.createTune(TuneInput(title: "  "), userTune: UserTuneInput(status: "known"))
        }
        #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
    }

    @Test func createsATuneAtTheEndOfAList() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let listID = try await commands.createList("Waltzes", at: noon)
        let first = try await commands.createTune(
            TuneInput(title: "Ashokan Farewell"), userTune: UserTuneInput(status: "known"), inList: listID, at: noon)
        let second = try await commands.createTune(
            TuneInput(title: "Rove Riley"), userTune: UserTuneInput(status: "known"), inList: listID, at: later(1))

        let items = try await store.read { db in
            try ListItem.filter(ListItem.CodingKeys.listID == listID).order(ListItem.CodingKeys.position).fetchAll(db)
        }
        #expect(items.map(\.userTuneID) == [first.userTuneID, second.userTuneID])
    }

    @Test func keepsTheTuneWhenItsListHasGone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let listID = try await commands.createList("Waltzes", at: noon)
        try await commands.deleteList(listID, at: noon)

        let created = try await commands.createTune(
            TuneInput(title: "Rove Riley"), userTune: UserTuneInput(status: "known"), inList: listID, at: later(1))

        #expect(try await store.read { db in try UserTune.fetchOne(db, key: created.userTuneID) } != nil)
        let items = try await store.read { db in
            try ListItem.filter(ListItem.CodingKeys.userTuneID == created.userTuneID).fetchCount(db)
        }
        #expect(items == 0)
    }
}

@Suite struct UpdateTuneTests {
    @Test func bumpsUpdatedAtKeepsOneOutboxEntryPerRowAndIgnoresKeep() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, userTuneID) = try await commands.createTune(
            TuneInput(title: "Angeline", key: "A"), userTune: UserTuneInput(status: "known"), at: noon)

        let later5 = later(5 * 60 * 1000)
        try await commands.updateTune(
            tuneID,
            patch: TunePatch(
                tunings: .value([
                    "violin": .object(["tuning": .string("AEAE")]),
                    "five_string_banjo": .object(["tuning": .string("gDGBD")]),
                ])),
            at: later5)
        try await commands.updateUserTune(userTuneID, patch: UserTunePatch(notes: .value("from Bruce")), at: later5)

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: tuneID) })
        #expect(tune.key == "A")
        #expect(
            tune.tunings == [
                "violin": .object(["tuning": .string("AEAE")]),
                "five_string_banjo": .object(["tuning": .string("gDGBD")]),
            ])
        #expect(tune.updatedAt == later5)
        let userTune = try #require(try await store.read { db in try UserTune.fetchOne(db, key: userTuneID) })
        #expect(userTune.notes == "from Bruce")
        #expect(try await store.pendingChangeCount() == 2)
        let tuneChange = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == tuneID })
        #expect(
            tuneChange.data?["tunings"]
                == .object([
                    "violin": .object(["tuning": .string("AEAE")]),
                    "five_string_banjo": .object(["tuning": .string("gDGBD")]),
                ]))
    }

    @Test func archivesAndUnarchivesThroughArchivedAt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (_, userTuneID) = try await commands.createTune(
            TuneInput(title: "X"), userTune: UserTuneInput(status: "known"), at: noon)

        try await commands.setArchived(userTuneID, archived: true, at: noon)
        var userTune = try #require(try await store.read { db in try UserTune.fetchOne(db, key: userTuneID) })
        #expect(userTune.archivedAt == noon)

        try await commands.setArchived(userTuneID, archived: false, at: later(1))
        userTune = try #require(try await store.read { db in try UserTune.fetchOne(db, key: userTuneID) })
        #expect(userTune.archivedAt == nil)
    }

    @Test func rejectsATitleThatTrimsToNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(
            TuneInput(title: "Angeline"), userTune: UserTuneInput(status: "known"))

        await #expect(throws: CommandError.tuneTitleRequired) {
            try await commands.updateTune(tuneID, patch: TunePatch(title: .value("  ")))
        }
    }

    @Test func rejectsAMissingTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.updateTune("missing", patch: TunePatch(key: .value("A")))
        }
    }
}

@Suite struct UpdateTuneEntryTests {
    @Test func savesTheTuneAndTheUserTuneTogether() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let ids = try await commands.createTune(TuneInput(title: "Angeline"), userTune: UserTuneInput(status: "known"))

        try await commands.updateTuneEntry(
            tuneID: ids.tuneID, userTuneID: ids.userTuneID, tune: TunePatch(key: .value("A")),
            userTune: UserTunePatch(notes: .value("from Bruce")))

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: ids.tuneID) })
        #expect(tune.key == "A")
        let userTune = try #require(try await store.read { db in try UserTune.fetchOne(db, key: ids.userTuneID) })
        #expect(userTune.notes == "from Bruce")
    }

    @Test func leavesARowAloneWhenItsPatchKeepsEveryField() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let ids = try await commands.createTune(TuneInput(title: "Angeline"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }

        try await commands.updateTuneEntry(
            tuneID: ids.tuneID, userTuneID: ids.userTuneID, tune: TunePatch(),
            userTune: UserTunePatch(status: .value("learning")))

        #expect(try await store.pendingChanges(limit: 10).queuedOps == [QueuedOp(table: .userTunes, op: .upsert)])
        #expect(TunePatch().isEmpty && UserTunePatch().isEmpty)
        #expect(!TunePatch(key: .value(nil)).isEmpty)
    }

    @Test func writesNeitherRowWhenTheUserTuneWriteFails() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, userTuneID) = try await commands.createTune(
            TuneInput(title: "Angeline"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try OutboxEntry.deleteAll(writer.db)
            _ = try UserTune.deleteOne(writer.db, key: userTuneID)
        }

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.updateTuneEntry(
                tuneID: tuneID, userTuneID: userTuneID, tune: TunePatch(key: .value("A")),
                userTune: UserTunePatch(notes: .value("from Bruce")))
        }

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: tuneID) })
        #expect(tune.key == nil)
        #expect(try await store.pendingChangeCount() == 0)
    }
}

@Suite struct DeleteTuneTests {
    @Test func tombstonesTheTuneAndItsDependentsLocallyQueuingOnlyTheTuneDelete() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, userTuneID) = try await commands.createTune(
            TuneInput(title: "X"), userTune: UserTuneInput(status: "known"), at: noon)
        let linkID = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://youtu.be/abc", provider: "youtube"), at: noon)
        let listID = newID()
        try await store.write { writer in
            try writer.put(TuneList(id: listID, createdAt: noon, name: "Tuesday"), at: noon)
        }
        let itemID = newID()
        try await store.write { writer in
            try writer.put(ListItem(id: itemID, createdAt: noon, listID: listID, userTuneID: userTuneID), at: noon)
        }
        let recordingID = newID()
        try await store.write { writer in
            try writer.put(
                Recording(id: recordingID, createdAt: noon, tuneID: tuneID, source: "microphone", recordedAt: noon),
                at: noon)
            try RecordingFile(id: recordingID, localState: .captured, updatedAt: noon).insert(writer.db)
        }

        let deleteTime = later(60 * 60 * 1000)
        try await commands.deleteTune(tuneID, at: deleteTime)

        #expect(try await store.read { db in try Tune.fetchOne(db, key: tuneID) }?.deletedAt == deleteTime)
        #expect(try await store.read { db in try UserTune.fetchOne(db, key: userTuneID) }?.deletedAt == deleteTime)
        #expect(try await store.read { db in try RecordingLink.fetchOne(db, key: linkID) }?.deletedAt == deleteTime)
        #expect(try await store.read { db in try ListItem.fetchOne(db, key: itemID) }?.deletedAt == deleteTime)
        #expect(try await store.read { db in try Recording.fetchOne(db, key: recordingID) }?.deletedAt == deleteTime)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)

        let queued = try await store.pendingChanges(limit: 10)
        #expect(queued.queuedOps == [QueuedOp(table: .tunes, op: .delete), QueuedOp(table: .lists, op: .upsert)])
    }
}

@Suite struct PatchEmptinessTests {
    /// Each field set on its own. A field added to a patch without joining `isEmpty` fails the
    /// count check here, which is the reminder to add it to both.
    @Test func countsEveryTuneFieldAsAChange() {
        let each: [TunePatch] = [
            TunePatch(title: .value("x")), TunePatch(alternateTitles: .value([])), TunePatch(genre: .value(nil)),
            TunePatch(lyrics: .value(nil)), TunePatch(key: .value(nil)), TunePatch(tuneType: .value(nil)),
            TunePatch(modes: .value([])), TunePatch(composer: .value(nil)), TunePatch(tunings: .value([:])),
            TunePatch(partStructure: .value(nil)), TunePatch(timeSignature: .value(nil)),
            TunePatch(isCrooked: .value(true)),
        ]
        #expect(Mirror(reflecting: TunePatch()).children.count == each.count)
        #expect(each.allSatisfy { !$0.isEmpty })
        #expect(TunePatch().isEmpty)
    }

    @Test func countsEveryUserTuneFieldAsAChange() {
        let each: [UserTunePatch] = [
            UserTunePatch(status: .value("known")), UserTunePatch(learnedFrom: .value(nil)),
            UserTunePatch(learnedOn: .value(nil)), UserTunePatch(notes: .value(nil)),
        ]
        #expect(Mirror(reflecting: UserTunePatch()).children.count == each.count)
        #expect(each.allSatisfy { !$0.isEmpty })
        #expect(UserTunePatch().isEmpty)
    }
}
