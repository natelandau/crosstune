import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

private func plan(
    _ titles: [String], status: String = "want_to_learn", genre: String? = nil,
    list: ImportListChoice = .none
) -> ImportPlan {
    ImportPlan(titles: titles, status: status, genre: genre, list: list)
}

@Suite struct ImportTunesTests {
    @Test func createsATuneAndUserTunePerTitleWithBatchStatusAndGenre() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        let result = try await commands.importTunes(
            plan(["Soldier’s Joy", "Cluck Old Hen"], status: "known", genre: "Old-time"))

        #expect(result.userTuneIDs.count == 2)
        #expect(result.listID == nil)
        #expect(!result.listCreated)
        let tunes = try await store.read { db in try Tune.fetchAll(db) }
        #expect(tunes.map(\.genre) == ["Old-time", "Old-time"])
        let userTunes = try await store.read { db in try UserTune.fetchAll(db) }
        #expect(userTunes.map(\.status) == ["known", "known"])
        let queued = try await store.pendingChanges(limit: 50)
        for tune in tunes { #expect(queued.contains { $0.rowID == tune.id }) }
        for userTune in userTunes { #expect(queued.contains { $0.rowID == userTune.id }) }
    }

    @Test func addsToANewListInOrder() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let titles = ["One", "Two", "Three"]

        let result = try await commands.importTunes(
            plan(titles, list: .new(name: "Imported 2026-10-09")))

        #expect(result.listCreated)
        let lists = try await store.read { db in try TuneList.fetchAll(db) }
        #expect(lists.map(\.name) == ["Imported 2026-10-09"])
        #expect(result.listID == lists.first?.id)
        let items = try await store.read { db in try ListItem.fetchAll(db) }
        #expect(activeByPosition(items).map(\.userTuneID) == result.userTuneIDs)
        let created = try await store.read { db in
            try result.userTuneIDs.map { id in
                let userTune = try #require(try UserTune.fetchOne(db, key: id))
                return try #require(try Tune.fetchOne(db, key: userTune.tuneID)).title
            }
        }
        #expect(created == titles)
        let queued = try await store.pendingChanges(limit: 50)
        #expect(queued.contains { $0.tableName == .lists && $0.rowID == result.listID })
        for item in items { #expect(queued.contains { $0.tableName == .listItems && $0.rowID == item.id }) }
    }

    @Test func addsToAnExistingListAfterItsItems() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let listID = try await commands.createList("Jam")
        let first = try await commands.createTune(
            TuneInput(title: "Existing"), userTune: UserTuneInput(status: "known")
        ).userTuneID
        try await commands.addToList(listID, userTuneID: first)
        let before = try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) }

        let result = try await commands.importTunes(plan(["A", "B"], list: .existing(listID: listID)))

        #expect(result.listID == listID)
        #expect(!result.listCreated)
        let items = try await store.read { db in try ListItem.filter(Column("list_id") == listID).fetchAll(db) }
        #expect(activeByPosition(items).map(\.userTuneID) == [first] + result.userTuneIDs)
        #expect(items.filter { $0.userTuneID == first } == before)
    }

    @Test func writesNothingWhenTheListIsGone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let goneID = try await commands.createList("Gone")
        try await commands.deleteList(goneID)
        let queuedBefore = try await store.pendingChanges(limit: 50).count

        for choice in [ImportListChoice.existing(listID: "missing"), .existing(listID: goneID)] {
            await #expect(throws: CommandError.listNotFound) {
                try await commands.importTunes(plan(["A"], list: choice))
            }
        }

        #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
        #expect(try await store.read { db in try UserTune.fetchCount(db) } == 0)
        #expect(try await store.pendingChanges(limit: 50).count == queuedBefore)
    }

    @Test func rollsBackTunesWhenTheNewListNameIsBlank() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.listNameRequired) {
            try await commands.importTunes(plan(["A", "B"], list: .new(name: "   ")))
        }

        #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
        #expect(try await store.read { db in try UserTune.fetchCount(db) } == 0)
        #expect(try await store.read { db in try TuneList.fetchCount(db) } == 0)
        #expect(try await store.pendingChanges(limit: 50).isEmpty)
    }

    @Test func addsNothingWhenOneTitleIsBlank() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.tuneTitleRequired) {
            try await commands.importTunes(plan(["A", "   "]))
        }

        #expect(try await store.read { db in try Tune.fetchCount(db) } == 0)
        #expect(try await store.read { db in try UserTune.fetchCount(db) } == 0)
        #expect(try await store.pendingChanges(limit: 50).isEmpty)
    }

    @Test func refusesAnEmptyPlan() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.nothingToImport) {
            try await commands.importTunes(plan([]))
        }
    }
}

@Suite struct ImportTextTests {
    private static let text = "Soldier's Joy\nFête"

    private func utf16(_ text: String, littleEndian: Bool) -> Data {
        var data = Data(littleEndian ? [0xFF, 0xFE] : [0xFE, 0xFF])
        for unit in text.utf16 {
            let bytes = littleEndian ? [UInt8(unit & 0xFF), UInt8(unit >> 8)] : [UInt8(unit >> 8), UInt8(unit & 0xFF)]
            data.append(contentsOf: bytes)
        }
        return data
    }

    @Test func readsUTF8() {
        #expect(ImportText.decode(Data(Self.text.utf8)) == Self.text)
    }

    @Test func dropsAUTF8ByteOrderMark() {
        #expect(ImportText.decode(Data([0xEF, 0xBB, 0xBF]) + Data(Self.text.utf8)) == Self.text)
    }

    @Test func readsUTF16LittleEndianByItsByteOrderMark() {
        #expect(ImportText.decode(utf16(Self.text, littleEndian: true)) == Self.text)
    }

    @Test func readsUTF16BigEndianByItsByteOrderMark() {
        #expect(ImportText.decode(utf16(Self.text, littleEndian: false)) == Self.text)
    }

    @Test func decodesBytesThatAreNotUTF8AsReplacementCharacters() {
        #expect(ImportText.decode(Data([0x41, 0xFF, 0x42])) == "A\u{FFFD}B")
    }

    @Test func endsAnOddLengthUTF16FileWithAReplacementCharacter() {
        #expect(ImportText.decode(utf16("A", littleEndian: true) + Data([0x42])) == "A\u{FFFD}")
        #expect(ImportText.decode(utf16("A", littleEndian: false) + Data([0x42])) == "A\u{FFFD}")
    }

    @Test func readsAnEmptyFileOrOneWithOnlyAByteOrderMarkAsNoText() {
        for bytes: [UInt8] in [[], [0xEF, 0xBB, 0xBF], [0xFF, 0xFE], [0xFE, 0xFF]] {
            #expect(ImportText.decode(Data(bytes)) == "")
        }
    }
}
