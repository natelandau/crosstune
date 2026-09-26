import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

private func threeTunes(_ commands: Commands) async throws -> (a: String, b: String, c: String) {
    let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known")).userTuneID
    let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known")).userTuneID
    let c = try await commands.createTune(TuneInput(title: "C"), userTune: UserTuneInput(status: "known")).userTuneID
    return (a, b, c)
}

@Suite struct ListsTests {
    @Test func createsListsInPositionOrderAndRenamesThem() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let first = try await commands.createList("Tuesday jam")
        let second = try await commands.createList("Square dance")
        #expect(try await store.read { db in try TuneList.fetchOne(db, key: first) }?.position == 0)
        #expect(try await store.read { db in try TuneList.fetchOne(db, key: second) }?.position == 1)

        try await commands.renameList(first, name: "Thursday jam")
        #expect(try await store.read { db in try TuneList.fetchOne(db, key: first) }?.name == "Thursday jam")
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == first })
        #expect(queued.op == .upsert)
    }

    @Test func addsItemsOnceInOrderAndRemovesThem() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, _) = try await threeTunes(commands)
        let listID = try await commands.createList("L")

        let itemA = try await commands.addToList(listID, userTuneID: a)
        let itemB = try await commands.addToList(listID, userTuneID: b)
        #expect(try await commands.addToList(listID, userTuneID: a) == itemA)
        var active = try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) }
        #expect(activeByPosition(active).map(\.id) == [itemA, itemB])

        try await commands.removeFromList(itemA)
        active = try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) }
        #expect(activeByPosition(active).map(\.id) == [itemB])
        let removed = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == itemA })
        #expect(removed.op == .delete)
    }

    @Test func refusesToAddATuneToAListThatIsMissingOrDeleted() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, _, _) = try await threeTunes(commands)

        await #expect(throws: CommandError.listNotFound) {
            try await commands.addToList("nope", userTuneID: a)
        }
        let listID = try await commands.createList("Gone")
        try await commands.deleteList(listID)
        await #expect(throws: CommandError.listNotFound) {
            try await commands.addToList(listID, userTuneID: a)
        }
        #expect(try await store.read { db in try ListItem.fetchCount(db) } == 0)
    }

    @Test func movesAnItemByRewritingOnlyThePositionsThatChanged() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, c) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let ia = try await commands.addToList(listID, userTuneID: a)
        let ib = try await commands.addToList(listID, userTuneID: b)
        let ic = try await commands.addToList(listID, userTuneID: c)
        let untouched = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == ia }).updatedAt

        try await commands.moveItem(listID: listID, itemID: ic, targetID: ib)

        let active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        #expect(active.map(\.id) == [ia, ic, ib])
        #expect(active.map(\.position) == [0, 1, 2])
        let stillUntouched = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == ia }).updatedAt
        #expect(stillUntouched == untouched)
    }

    @Test func trimsANewListNameAndRefusesAnEmptyOne() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let listID = try await commands.createList("  Tuesday jam  ")
        #expect(try await store.read { db in try TuneList.fetchOne(db, key: listID) }?.name == "Tuesday jam")
        await #expect(throws: CommandError.listNameRequired) {
            try await commands.createList("   ")
        }
    }

    @Test(
        arguments: [
            ("a", "b", ["b", "a", "c"]),
            ("c", "b", ["a", "c", "b"]),
            ("a", "c", ["b", "c", "a"]),
            ("c", "a", ["c", "a", "b"]),
        ])
    func movesAnItem(moved: String, target: String, expected: [String]) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, c) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let ids = [
            "a": try await commands.addToList(listID, userTuneID: a),
            "b": try await commands.addToList(listID, userTuneID: b),
            "c": try await commands.addToList(listID, userTuneID: c),
        ]

        try await commands.moveItem(listID: listID, itemID: ids[moved]!, targetID: ids[target]!)

        let active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        #expect(active.map(\.id) == expected.map { ids[$0]! })
    }

    @Test func movesPastAnItemBetweenItAndTheTargetLandingBesideTheTarget() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, c) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let ia = try await commands.addToList(listID, userTuneID: a)
        let ib = try await commands.addToList(listID, userTuneID: b)
        let ic = try await commands.addToList(listID, userTuneID: c)

        try await commands.moveItem(listID: listID, itemID: ia, targetID: ic)
        var active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        #expect(active.map(\.id) == [ib, ic, ia])

        try await commands.moveItem(listID: listID, itemID: ia, targetID: ib)
        active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        #expect(active.map(\.id) == [ia, ib, ic])
    }

    @Test func movesNothingForAMissingTargetOrTheItemItself() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, _) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let ia = try await commands.addToList(listID, userTuneID: a)
        let ib = try await commands.addToList(listID, userTuneID: b)

        try await commands.moveItem(listID: listID, itemID: ia, targetID: "missing")
        try await commands.moveItem(listID: listID, itemID: ia, targetID: ia)
        try await commands.moveItem(listID: listID, itemID: "missing", targetID: ib)

        let active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        #expect(active.map(\.id) == [ia, ib])
    }

    @Test func deletesAListAndTombstonesItsItemsWithoutQueuingThem() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, _, _) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let item = try await commands.addToList(listID, userTuneID: a)

        try await commands.deleteList(listID)

        #expect(try await store.read { db in try TuneList.fetchOne(db, key: listID) }?.deletedAt != nil)
        #expect(try await store.read { db in try ListItem.fetchOne(db, key: item) }?.deletedAt != nil)
        let ops = try await store.pendingChanges(limit: 10).filter {
            $0.tableName != .tunes && $0.tableName != .userTunes
        }
        #expect(ops.map { ($0.tableName, $0.op) }.map(QueuedOp.init) == [QueuedOp(table: .lists, op: .delete)])
    }

    @Test func givesANewItemAPositionPastARemovedItemWithNoCollisions() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (a, b, c) = try await threeTunes(commands)
        let listID = try await commands.createList("L")
        let itemA = try await commands.addToList(listID, userTuneID: a)
        _ = try await commands.addToList(listID, userTuneID: b)
        try await commands.removeFromList(itemA)
        let itemC = try await commands.addToList(listID, userTuneID: c)

        let active = activeByPosition(
            try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) })
        let positions = active.map(\.position)
        #expect(Set(positions).count == positions.count)
        let newItem = try #require(active.first { $0.id == itemC })
        for item in active where item.id != itemC {
            #expect(newItem.position > item.position)
        }
    }
}
