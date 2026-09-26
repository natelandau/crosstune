import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

private func fetchTune(_ store: CrosstuneStore, _ id: String) async throws -> Tune {
    try #require(try await store.read { db in try Tune.fetchOne(db, key: id) })
}

private func fetchUserTune(_ store: CrosstuneStore, _ id: String) async throws -> UserTune {
    try #require(try await store.read { db in try UserTune.fetchOne(db, key: id) })
}

private func activeItems(_ store: CrosstuneStore, _ listID: String) async throws -> [ListItem] {
    activeByPosition(try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
}

@Suite struct UpdateTunesTests {
    @Test func writesTuneAndUserTuneFieldsOnEverySelectedTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", key: "A"), userTune: UserTuneInput(status: "learning"))
        let b = try await commands.createTune(
            TuneInput(title: "Lost Indian", genre: "Old-time", key: "A"), userTune: UserTuneInput(status: "learning"))

        _ = try await commands.updateTunes(
            [a.userTuneID, b.userTuneID],
            patch: BulkPatch(
                tune: BulkTunePatch(genre: .value(nil)), userTune: BulkUserTunePatch(status: .value("known")),
                tunings: ["violin": .value("Cross A (AEAE)")]))

        for (tuneID, userTuneID) in [(a.tuneID, a.userTuneID), (b.tuneID, b.userTuneID)] {
            let tune = try await fetchTune(store, tuneID)
            #expect(tune.tunings == ["violin": .object(["tuning": .string("Cross A (AEAE)")])])
            #expect(tune.genre == nil)
            #expect(tune.key == "A")
            #expect(try await fetchUserTune(store, userTuneID).status == "known")
        }
    }

    @Test func writesNothingWhenOneTuneIsMissing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "learning"))
        let b = try await commands.createTune(
            TuneInput(title: "Lost Indian"), userTune: UserTuneInput(status: "learning"))
        try await commands.deleteTune(b.tuneID)

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.updateTunes(
                [a.userTuneID, b.userTuneID], patch: BulkPatch(userTune: BulkUserTunePatch(status: .value("known"))))
        }
        #expect(try await fetchUserTune(store, a.userTuneID).status == "learning")
    }

    @Test func leavesARowAloneWhenItAlreadyMatchesThePatch() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", key: "A"), userTune: UserTuneInput(status: "learning"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }
        let before = try await fetchTune(store, a.tuneID)

        _ = try await commands.updateTunes([a.userTuneID], patch: BulkPatch(tune: BulkTunePatch(key: .value("A"))))

        #expect(try await fetchTune(store, a.tuneID) == before)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func keepsAFieldThePatchLeavesUndefined() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", genre: "Old-time", key: "A"), userTune: UserTuneInput(status: "learning"))

        _ = try await commands.updateTunes([a.userTuneID], patch: BulkPatch(tune: BulkTunePatch(key: .value("D"))))

        let tune = try await fetchTune(store, a.tuneID)
        #expect(tune.key == "D")
        #expect(tune.genre == "Old-time")
    }

    @Test func undoesOnlyTheFieldsItChangedKeepingAnEditMadeSince() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(
                title: "Say Old Man", key: "A", tunings: ["violin": .object(["tuning": .string("Standard (GDAE)")])]),
            userTune: UserTuneInput(status: "learning"))

        let snapshots = try await commands.updateTunes(
            [a.userTuneID],
            patch: BulkPatch(
                userTune: BulkUserTunePatch(status: .value("known")), tunings: ["violin": .value("Cross A (AEAE)")]))
        try await commands.updateTune(a.tuneID, patch: TunePatch(key: .value("G")))
        try await commands.restoreFields(snapshots)

        let tune = try await fetchTune(store, a.tuneID)
        #expect(tune.tunings == ["violin": .object(["tuning": .string("Standard (GDAE)")])])
        #expect(tune.key == "G")
        #expect(try await fetchUserTune(store, a.userTuneID).status == "learning")
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == a.tuneID })
        #expect(queued.op == .upsert)
    }

    @Test func setsOneInstrumentsTuningKeepsCaposAndUnknownKeysAndUndoesTheWholeMap() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tunings: JSONObject = [
            "guitar": .object(["tuning": .string("DADGAD"), "capo": .integer(2)]),
            "violin": .object(["tuning": .string("AEAE")]),
            "hardanger": .object(["tuning": .string("x")]),
        ]
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", tunings: tunings), userTune: UserTuneInput(status: "learning"))

        let snapshots = try await commands.updateTunes(
            [a.userTuneID], patch: BulkPatch(tunings: ["guitar": .value("Drop D (DADGBE)"), "violin": .value(nil)]))

        let after = try await fetchTune(store, a.tuneID)
        #expect(
            after.tunings == [
                "guitar": .object(["tuning": .string("Drop D (DADGBE)"), "capo": .integer(2)]),
                "hardanger": .object(["tuning": .string("x")]),
            ])
        try await commands.restoreFields(snapshots)
        #expect(try await fetchTune(store, a.tuneID).tunings == tunings)
    }

    @Test func leavesATuneAloneWhenItsTuningsAlreadyMatch() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", tunings: ["violin": .object(["tuning": .string("AEAE")])]),
            userTune: UserTuneInput(status: "learning"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }

        _ = try await commands.updateTunes([a.userTuneID], patch: BulkPatch(tunings: ["violin": .value("AEAE")]))

        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func leavesATuneAloneWhenItsTuningsMatchInAnotherKeyOrder() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tunings: JSONObject = [
            "violin": .object(["tuning": .string("AEAE")]),
            "guitar": .object(["capo": .integer(2), "tuning": .string("DADGAD")]),
        ]
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man", tunings: tunings), userTune: UserTuneInput(status: "learning"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }

        _ = try await commands.updateTunes(
            [a.userTuneID], patch: BulkPatch(tunings: ["guitar": .value("DADGAD"), "violin": .value("AEAE")]))

        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await fetchTune(store, a.tuneID).tunings == tunings)
    }

    @Test func leavesATuneWhoseModesAlreadyMatchUntouched() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "The Kesh", modes: ["dorian"]), userTune: UserTuneInput(status: "learning"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }

        _ = try await commands.updateTunes(
            [a.userTuneID], patch: BulkPatch(tune: BulkTunePatch(modes: .value(["dorian"]))))

        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func restoresEveryPartModeOnUndo() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "The Kesh", modes: ["major", "mixolydian"]), userTune: UserTuneInput(status: "learning"))

        let snapshots = try await commands.updateTunes(
            [a.userTuneID], patch: BulkPatch(tune: BulkTunePatch(modes: .value(["dorian"]))))
        #expect(try await fetchTune(store, a.tuneID).modes == ["dorian"])

        try await commands.restoreFields(snapshots)
        #expect(try await fetchTune(store, a.tuneID).modes == ["major", "mixolydian"])
    }

    @Test func undoGivesTheRestoredRowAFreshUpdatedAt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "learning"), at: noon)

        let snapshots = try await commands.updateTunes(
            [a.userTuneID], patch: BulkPatch(tune: BulkTunePatch(key: .value("A"))), at: noon)
        let changed = try await fetchTune(store, a.tuneID).updatedAt

        try await commands.restoreFields(snapshots, at: later(1000))
        #expect(try await fetchTune(store, a.tuneID).updatedAt > changed)
    }

    @Test func undoSkipsATuneDeletedSince() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(
            TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "learning"))
        let b = try await commands.createTune(
            TuneInput(title: "Lost Indian"), userTune: UserTuneInput(status: "learning"))

        let snapshots = try await commands.updateTunes(
            [a.userTuneID, b.userTuneID], patch: BulkPatch(tune: BulkTunePatch(key: .value("A"))))
        try await commands.deleteTune(b.tuneID)
        try await commands.restoreFields(snapshots)

        #expect(try await fetchTune(store, a.tuneID).key == nil)
        #expect(try await fetchTune(store, b.tuneID).deletedAt != nil)
    }
}

@Suite struct SetArchivedManyTests {
    @Test func archivesTheSelectedTunesAndUndoRestoresEachOne() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "Lost Indian"), userTune: UserTuneInput(status: "known"))
        try await commands.setArchived(b.userTuneID, archived: true)
        let archivedAt = try await fetchUserTune(store, b.userTuneID).archivedAt

        let snapshots = try await commands.setArchivedMany([a.userTuneID, b.userTuneID], archived: true)
        #expect(try await fetchUserTune(store, a.userTuneID).archivedAt != nil)
        #expect(try await fetchUserTune(store, b.userTuneID).archivedAt == archivedAt)

        try await commands.restoreFields(snapshots)
        #expect(try await fetchUserTune(store, a.userTuneID).archivedAt == nil)
        #expect(try await fetchUserTune(store, b.userTuneID).archivedAt == archivedAt)
    }

    @Test func unarchivesAndUndoArchivesAgainWithTheOldTimestamp() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))
        try await commands.setArchived(a.userTuneID, archived: true)
        let archivedAt = try await fetchUserTune(store, a.userTuneID).archivedAt

        let snapshots = try await commands.setArchivedMany([a.userTuneID], archived: false)
        #expect(try await fetchUserTune(store, a.userTuneID).archivedAt == nil)

        try await commands.restoreFields(snapshots)
        #expect(try await fetchUserTune(store, a.userTuneID).archivedAt == archivedAt)
    }
}

@Suite struct DeleteTunesTests {
    @Test func tombstonesEachSelectedTuneWithItsUserTuneListEntriesAndRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "Lost Indian"), userTune: UserTuneInput(status: "known"))
        let kept = try await commands.createTune(
            TuneInput(title: "Ducks on the Millpond"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        try await commands.addToList(listID, userTuneID: a.userTuneID)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: a.tuneID, source: "microphone", recordedAt: .now))
            try RecordingFile(id: "r1", localState: .captured).insert(writer.db)
        }

        let count = try await commands.deleteTunes([a.userTuneID, b.userTuneID])

        #expect(count == 2)
        #expect(try await fetchTune(store, a.tuneID).deletedAt != nil)
        #expect(try await fetchUserTune(store, a.userTuneID).deletedAt != nil)
        #expect(try await fetchTune(store, b.tuneID).deletedAt != nil)
        #expect(try await fetchTune(store, kept.tuneID).deletedAt == nil)
        #expect(try await activeItems(store, listID) == [])
        #expect(try await store.read { db in try Recording.fetchOne(db, key: "r1") }?.deletedAt != nil)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") } == nil)
    }

    @Test func queuesOneDeletePerTuneAndNoneForTheRowsThatGoWithIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))

        _ = try await commands.deleteTunes([a.userTuneID])

        let tuneChange = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == a.tuneID })
        #expect(tuneChange.op == .delete)
        #expect(try await store.pendingChanges(limit: 10).first { $0.rowID == a.userTuneID } == nil)
    }

    @Test func countsTwoSelectedUserTunesOfOneTuneOnce() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))

        #expect(try await commands.deleteTunes([a.userTuneID, a.userTuneID]) == 1)
    }

    @Test func rejectsWhenASelectedTuneIsAlreadyGone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))
        try await commands.deleteTune(a.tuneID)

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.deleteTunes([a.userTuneID])
        }
    }
}

@Suite struct AddTunesToListTests {
    @Test func appendsMissingTunesInTheGivenOrderAndSkipsMembers() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let c = try await commands.createTune(TuneInput(title: "C"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        try await commands.addToList(listID, userTuneID: b.userTuneID)

        let result = try await commands.addTunesToList(
            listID: listID, userTuneIDs: [c.userTuneID, b.userTuneID, a.userTuneID])

        #expect(result.added == 2)
        #expect(try await activeItems(store, listID).map(\.userTuneID) == [b.userTuneID, c.userTuneID, a.userTuneID])
    }

    @Test func undoRemovesOnlyTheItemsItAdded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        try await commands.addToList(listID, userTuneID: a.userTuneID)

        let result = try await commands.addTunesToList(listID: listID, userTuneIDs: [a.userTuneID, b.userTuneID])
        _ = try await commands.removeTunesFromList(result.itemIDs)

        #expect(try await activeItems(store, listID).map(\.userTuneID) == [a.userTuneID])
    }

    @Test func writesNothingWhenTheListIsGone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))

        await #expect(throws: CommandError.listNotFound) {
            try await commands.addTunesToList(listID: "missing", userTuneIDs: [a.userTuneID])
        }
    }
}

@Suite struct CreateListWithTunesTests {
    @Test func createsAListHoldingTheTunesAndUndoDeletesIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))

        let listID = try await commands.createListWithTunes(
            name: "  Clifftop  ", userTuneIDs: [a.userTuneID, b.userTuneID])

        let list = try #require(try await store.read { db in try TuneList.fetchOne(db, key: listID) })
        #expect(list.name == "Clifftop")
        #expect(try await activeItems(store, listID).map(\.userTuneID) == [a.userTuneID, b.userTuneID])

        try await commands.deleteList(listID)
        #expect(try await store.read { db in try TuneList.fetchOne(db, key: listID) }?.deletedAt != nil)
    }

    @Test func rejectsABlankNameAndWritesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))

        await #expect(throws: CommandError.listNameRequired) {
            try await commands.createListWithTunes(name: " ", userTuneIDs: [a.userTuneID])
        }
        #expect(try await store.read { db in try TuneList.fetchCount(db) } == 0)
    }

    @Test func writesNothingWhenATuneIsMissing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.createListWithTunes(name: "Tuesday jam", userTuneIDs: [a.userTuneID, "missing"])
        }
        #expect(try await store.read { db in try TuneList.fetchCount(db) } == 0)
        #expect(try await store.read { db in try ListItem.fetchCount(db) } == 0)
    }
}

@Suite struct RemoveTunesFromListTests {
    @Test func removesTheItemsAndUndoPutsThemBackInTheirPlaces() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let c = try await commands.createTune(TuneInput(title: "C"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)
        let ib = try await commands.addToList(listID, userTuneID: b.userTuneID)
        let ic = try await commands.addToList(listID, userTuneID: c.userTuneID)

        let removed = try await commands.removeTunesFromList([ia, ic])
        #expect(try await activeItems(store, listID).map(\.id) == [ib])

        try await commands.restoreListItems(removed)
        #expect(try await activeItems(store, listID).map(\.id) == [ia, ib, ic])
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == ia })
        #expect(queued.op == .upsert)
    }

    @Test func undoDoesNotDuplicateATuneAddedBackToTheListSince() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)

        let removed = try await commands.removeTunesFromList([ia])
        try await commands.addToList(listID, userTuneID: a.userTuneID)
        try await commands.restoreListItems(removed)

        #expect(try await activeItems(store, listID).map(\.userTuneID) == [a.userTuneID])
    }

    @Test func undoSkipsATuneDeletedSince() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)

        let removed = try await commands.removeTunesFromList([ia])
        try await commands.deleteTune(a.tuneID)
        try await commands.restoreListItems(removed)

        #expect(try await activeItems(store, listID) == [])
    }

    @Test func writesNothingWhenAnItemIsAlreadyRemoved() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)
        let ib = try await commands.addToList(listID, userTuneID: b.userTuneID)
        try await commands.removeFromList(ib)

        await #expect(throws: CommandError.tuneNotInList) {
            try await commands.removeTunesFromList([ia, ib])
        }
        #expect(try await activeItems(store, listID).map(\.id) == [ia])
    }

    @Test func undoKeepsPositionsDistinctWhenAnotherTuneTookTheFreedSlot() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)

        let removed = try await commands.removeTunesFromList([ia])
        let ib = try await commands.addToList(listID, userTuneID: b.userTuneID)
        try await commands.restoreListItems(removed)

        let items = try await activeItems(store, listID)
        #expect(items.map(\.id) == [ia, ib])
        #expect(items.map(\.position) == [0, 1])
    }

    @Test func undoKeepsARestoredItemWhenTheListHasAPositionGap() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let c = try await commands.createTune(TuneInput(title: "C"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)
        let ib = try await commands.addToList(listID, userTuneID: b.userTuneID)
        let ic = try await commands.addToList(listID, userTuneID: c.userTuneID)
        try await commands.removeFromList(ia)

        let removed = try await commands.removeTunesFromList([ic])
        try await commands.restoreListItems(removed)

        #expect(try await activeItems(store, listID).map(\.id) == [ib, ic])
        #expect(try await store.read { db in try ListItem.fetchOne(db, key: ic) }?.deletedAt == nil)
    }

    @Test func undoRestoresTheOrderAfterAReorderInBetween() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"))
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"))
        let c = try await commands.createTune(TuneInput(title: "C"), userTune: UserTuneInput(status: "known"))
        let listID = try await commands.createList("Tuesday jam")
        let ia = try await commands.addToList(listID, userTuneID: a.userTuneID)
        let ib = try await commands.addToList(listID, userTuneID: b.userTuneID)
        let ic = try await commands.addToList(listID, userTuneID: c.userTuneID)

        let removed = try await commands.removeTunesFromList([ib])
        try await commands.moveItem(listID: listID, itemID: ic, targetID: ia)
        try await commands.restoreListItems(removed)

        let items = try await activeItems(store, listID)
        // B's old slot went to A once C moved ahead of it, so B restores ahead of A.
        #expect(items.map(\.id) == [ic, ib, ia])
        #expect(items.map(\.position) == [0, 1, 2])
    }
}

@Suite struct RestoreFieldsTests {
    @Test func restoringAnEmptyListQueuesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "Say Old Man"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }

        try await commands.restoreFields([])

        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await fetchTune(store, a.tuneID).key == nil)
    }
}
