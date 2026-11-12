import CrosstuneAudio
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import SwiftUI
import Testing

@testable import CrosstuneUI

private let session = SampleCatalog.lists[0]
private let waltzes = SampleCatalog.lists[1]
/// The session list's tunes, in stored order.
private let sessionTitles = ["Soldier's Joy", "Cluck Old Hen", "Kitchen Girl", "Tam Lin", "Blackberry Blossom"]

private func sample(_ title: String) -> SampleCatalog.Entry {
    SampleCatalog.entries.first { $0.tune.title == title }!
}

private func catalogEntry(_ title: String) -> CatalogEntry {
    let entry = sample(title)
    return CatalogEntry(tune: entry.tune, userTune: entry.userTune)
}

struct ListMoveTests {
    private let ids = ["a", "b", "c", "d", "e"]

    @Test func sendsARowAfterATargetBelowAndBeforeATargetAbove() {
        let down = ListMove(ids: ids, from: 1, to: 2)
        #expect(down?.side == .after)
        #expect(down?.apply(to: ids) == ["a", "c", "b", "d", "e"])
        let up = ListMove(ids: ids, from: 4, to: 0)
        #expect(up?.side == .before)
        #expect(up?.apply(to: ids) == ["e", "a", "b", "c", "d"])
    }

    @Test func refusesAMoveThatGoesNowhere() {
        #expect(ListMove(ids: ids, from: 2, to: 2) == nil)
        #expect(ListMove(ids: ids, from: 0, to: 5) == nil)
        #expect(ListMove(ids: ids, from: -1, to: 0) == nil)
    }

    @Test func movesPastAHiddenItemAndKeepsItsPlace() {
        // "b" is hidden: the rows show a, c, d. Moving a below c lands it after c, not after b.
        let move = ListMove(ids: ["a", "c", "d"], from: 0, to: 1)
        #expect(move?.apply(to: ids) == ["b", "c", "a", "d", "e"])
    }

    @Test func replaysIdempotently() throws {
        let move = try #require(ListMove(ids: ids, from: 0, to: 4))
        let once = move.apply(to: ids)
        #expect(move.apply(to: once) == once)
    }

    @Test func readsADragOffsetAsTheRowItLandsOn() {
        // SwiftUI's offset counts the rows before the drag: dropping row 1 at offset 3 puts it
        // after row 2.
        #expect(MovePlace.dropTarget(from: 1, offset: 3) == 2)
        #expect(MovePlace.dropTarget(from: 3, offset: 0) == 0)
        #expect(MovePlace.dropTarget(from: 0, offset: 5) == 4)
    }

    @Test func offersOnlyMovesThatGoSomewhere() {
        #expect(MovePlace.places(at: 0, count: 3) == [.down, .bottom])
        #expect(MovePlace.places(at: 1, count: 3) == [.top, .up, .down, .bottom])
        #expect(MovePlace.places(at: 2, count: 3) == [.top, .up])
        #expect(MovePlace.places(at: 0, count: 1).isEmpty)
    }

    @Test func sendsEachPlaceToItsRow() {
        #expect(MovePlace.top.destination(from: 3, count: 5) == 0)
        #expect(MovePlace.up.destination(from: 3, count: 5) == 2)
        #expect(MovePlace.down.destination(from: 3, count: 5) == 4)
        #expect(MovePlace.bottom.destination(from: 1, count: 5) == 4)
    }
}

struct PendingMovesTests {
    private let stored = ["a", "b", "c", "d"]

    @Test func showsAMoveAtOnceWhileItIsWritten() throws {
        var moves = PendingMoves()
        _ = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        moves.retire(order: stored, revision: 1)
        #expect(moves.apply(to: stored) == ["b", "c", "a", "d"])
    }

    @Test func replaysMovesInTheOrderTheyWereMade() throws {
        var moves = PendingMoves()
        _ = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 3)))
        _ = moves.begin(try #require(ListMove(ids: ["b", "c", "d", "a"], from: 3, to: 0)))
        #expect(moves.apply(to: stored) == stored)
    }

    @Test func retiresASettledMoveAtTheFirstReadAfterIt() throws {
        var moves = PendingMoves()
        let id = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        let written = ["b", "c", "a", "d"]
        moves.settle(id, revision: 1, storedOrder: written)
        moves.retire(order: stored, revision: 1)
        #expect(moves.isEmpty == false, "the read on screen is still the one before the write")
        moves.retire(order: written, revision: 2)
        #expect(moves.isEmpty)
    }

    @Test func retiresAtOnceWhenTheReadLandedBeforeTheWriteSettled() throws {
        var moves = PendingMoves()
        let id = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        let written = ["b", "c", "a", "d"]
        moves.settle(id, revision: 2, storedOrder: written)
        moves.retire(order: written, revision: 2)
        #expect(moves.isEmpty)
    }

    @Test func followsASyncThatReordersTheTuneOnceTheMoveHasSettled() throws {
        var moves = PendingMoves()
        let id = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        moves.settle(id, revision: 1, storedOrder: ["b", "c", "a", "d"])
        let synced = ["a", "d", "b", "c"]
        moves.retire(order: synced, revision: 2)
        #expect(moves.apply(to: synced) == synced)
    }

    @Test func dropsAFailedMove() throws {
        var moves = PendingMoves()
        let id = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        moves.drop(id)
        #expect(moves.apply(to: stored) == stored)
    }

    @Test func stopsAMoveWhoseTuneLeftTheList() throws {
        var moves = PendingMoves()
        _ = moves.begin(try #require(ListMove(ids: stored, from: 0, to: 2)))
        moves.retire(order: ["b", "c", "d"], revision: 2)
        #expect(moves.isEmpty)
    }

    @Test func comparesOrdersOnlyOnTheItemsBothCarry() {
        #expect(PendingMoves.sameOrder(["a", "b", "c"], ["a", "x", "b", "c"]))
        #expect(PendingMoves.sameOrder(["a", "b", "c"], ["b", "a", "c"]) == false)
    }
}

@Suite(.timeLimit(.minutes(1))) struct ListSummaryTests {
    private let root = TemporaryRoot()

    @Test func countsLiveItemsAndDatesTheListByItsNewestEdit() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let edited = later(86_400_000, than: SampleCatalog.now)
        try await Commands(store: store).removeFromList("sample_item_session_0", at: edited)
        let summaries = try await store.read { try ListSummary.fetchAll($0) }
        #expect(summaries.map(\.name) == ["Tuesday session", "Waltzes"])
        #expect(summaries.map(\.count) == [4, 1])
        #expect(summaries[0].lastEditedAt == edited)
        #expect(summaries[1].lastEditedAt == SampleCatalog.now)
    }

    @Test func readsItsSecondLineAsTheWebDoes() {
        let one = ListSummary(list: waltzes, count: 1, lastEditedAt: SampleCatalog.now)
        #expect(one.details(now: SampleCatalog.now.date) == "1 tune · Edited today")
        let many = ListSummary(list: session, count: 5, lastEditedAt: SampleCatalog.now)
        #expect(many.details(now: SampleCatalog.now.date) == "5 tunes · Edited today")
    }

    @Test func listRowSecondLineReadsCountAndEdited() throws {
        let now = try #require(Timestamp(iso: "2026-10-05T12:00:00Z")).date
        let today = try #require(Timestamp(iso: "2026-10-05T09:00:00Z"))
        #expect(ListRow.detail(count: 12, edited: today, now: now) == "12 tunes · Edited today")
        let earlier = try #require(Timestamp(iso: "2026-03-04T12:00:00Z"))
        #expect(ListRow.detail(count: 1, edited: earlier, now: now) == "1 tune · Edited Mar 4")
        let lastYear = try #require(Timestamp(iso: "2025-03-04T12:00:00Z"))
        #expect(ListRow.detail(count: 2, edited: lastYear, now: now) == "2 tunes · Edited Mar 4, 2025")
    }

    @Test func wordsTheDeleteConfirmationAsTheWebDoes() {
        #expect(DeleteListMessage.title("Waltzes") == "Delete \"Waltzes\"?")
    }
}

@MainActor @Suite(.timeLimit(.minutes(1))) struct ListModelTests {
    private let root = TemporaryRoot()

    private func model(
        _ store: CrosstuneStore, _ listID: String = session.id, sourceLocation: SourceLocation = #_sourceLocation
    ) async throws -> ListModel {
        let model = ListModel(store: store, listID: listID)
        try await eventually(sourceLocation: sourceLocation) { model.list != nil && model.showArchived != nil }
        return model
    }

    private func storedTitles(_ store: CrosstuneStore) async throws -> [String] {
        try await store.read { db in try ListContents.fetch(db, listID: session.id)?.entries.map(\.tune.title) ?? [] }
    }

    @Test func showsTheListsTunesInStoredOrder() async throws {
        let model = try await model(try await SampleCatalog.copiedStore(root: root.url))
        #expect(model.rows.map(\.tune.title) == sessionTitles)
    }

    @Test func movesATuneFromTheMenuStoresItAndSaysWhereItLanded() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        model.move(model.rows[0], to: .down)
        #expect(model.rows.first?.tune.title == "Cluck Old Hen", "shown before the write lands")
        #expect(model.announcement?.text == "Moved Soldier's Joy to position 2 of 5")
        try await eventually {
            model.rows.map(\.tune.title) == ["Cluck Old Hen", "Soldier's Joy"] + sessionTitles[2...]
        }
        try await eventually {
            try await storedTitles(store) == ["Cluck Old Hen", "Soldier's Joy"] + sessionTitles[2...]
        }
    }

    @Test func dragsATuneToTheBottom() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        model.move(from: 0, to: MovePlace.dropTarget(from: 0, offset: 5))
        let expected = Array(sessionTitles[1...]) + ["Soldier's Joy"]
        #expect(model.rows.map(\.tune.title) == expected)
        try await eventually { try await storedTitles(store) == expected }
    }

    @Test func keepsEveryMoveOfAQuickRun() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        model.move(from: 0, to: 4)
        model.move(from: 0, to: 4)
        let expected = Array(sessionTitles[2...]) + ["Soldier's Joy", "Cluck Old Hen"]
        #expect(model.rows.map(\.tune.title) == expected)
        try await eventually { try await storedTitles(store) == expected }
        try await eventually { model.rows.map(\.tune.title) == expected }
    }

    @Test func hidesArchivedTunesUntilShownAndMovesPastAHiddenOne() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        try await Commands(store: store).setArchived(sample("Cluck Old Hen").userTune.id, archived: true)
        let model = try await model(store)
        try await eventually { model.rows.count == 4 }
        #expect(model.rows.contains { $0.tune.title == "Cluck Old Hen" } == false)

        model.move(from: 0, to: 1)
        try await eventually {
            model.entries.map(\.tune.title) == [
                "Cluck Old Hen", "Kitchen Girl", "Soldier's Joy", "Tam Lin", "Blackberry Blossom",
            ]
        }

        await model.setShowArchived(true)
        try await eventually { model.rows.count == 5 }
        #expect(try await store.meta(.listShowArchived, as: Bool.self) == true)
    }

    @Test func takesAFailedMoveBackAndSaysWhy() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        try await store.write { writer in
            try writer.db.execute(
                sql: "CREATE TRIGGER refuse_moves BEFORE UPDATE ON list_items BEGIN SELECT RAISE(ABORT, 'refused'); END"
            )
        }
        model.move(from: 0, to: 1)
        #expect(model.rows.first?.tune.title == "Cluck Old Hen", "shown before the write fails")
        try await eventually { model.failure != nil }
        #expect(model.rows.map(\.tune.title) == sessionTitles)
        #expect(model.announcement == nil)
        #expect(try await storedTitles(store) == sessionTitles)
    }

    @Test func removesATuneFromTheList() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        await model.remove(model.rows[0])
        try await eventually { model.rows.count == 4 }
        #expect(model.failure == nil)
    }

    @Test func deletesTheListAndHoldsItsNameWhileLeaving() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await model(store)
        #expect(await model.delete())
        try await eventually { model.phase == .deleting(name: "Tuesday session") }
        let remaining = try await store.read { try ListSummary.fetchAll($0).map(\.id) }
        #expect(remaining == [waltzes.id])
    }

    @Test func saysAMissingListIsGone() async throws {
        let model = ListModel(store: try await SampleCatalog.copiedStore(root: root.url), listID: "no_such_list")
        try await eventually { model.phase == .gone }
    }
}

@MainActor @Suite(.timeLimit(.minutes(1))) struct TunePickerModelTests {
    private let root = TemporaryRoot()

    private func picker(
        _ store: CrosstuneStore, listID: String = session.id, sourceLocation: SourceLocation = #_sourceLocation
    ) async throws -> TunePickerModel {
        let model = TunePickerModel(store: store, listID: listID)
        try await eventually(sourceLocation: sourceLocation) { model.results != nil }
        return model
    }

    @Test func showsNothingUntilSomethingIsTyped() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        #expect(model.isIdle)
        #expect(model.results?.rows.isEmpty == true)
        #expect(model.results?.outcome == SearchOutcome.none)
    }

    @Test func idlePickerListsEveryTuneAToZ() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store)
        let catalog = try await store.read { try CatalogModel.fetchEntries($0) }
        let expected = CatalogSearch.sorted(catalog, by: .default, lastPlayed: [:]).map(\.tune.title)
        let rows = try #require(model.idleResults)
        #expect(rows.map(\.entry.tune.title) == expected)
        #expect(rows.contains { $0.entry.isArchived }, "archived tunes show")
        #expect(rows.contains { $0.isTaken }, "a tune in the list shows, marked")
        model.query = "soldier"
        #expect(model.idleResults?.isEmpty == true, "typing hands the rows to the search")
    }

    @Test func tunePickerSaysWhatItIsForOnlyWhileTheCatalogIsEmpty() async throws {
        let empty = try root.open()
        let bare = TunePickerModel(store: empty, listID: "no_such_list")
        try await eventually { bare.idleResults != nil }
        #expect(bare.showsHint, "an empty catalog shows the hint")
        let full = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        #expect(full.showsHint == false)
        full.query = "soldier"
        #expect(full.showsHint == false, "typing hands the screen to the search")
    }

    @Test func idleListingOrdersByTitleAToZAndIncludesArchived() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        let titles = try #require(model.idleResults).map(\.entry.tune.title)
        #expect(
            titles == [
                "A tune with no key yet", "Ashokan Farewell", "Big Scioty", "Blackberry Blossom", "Cluck Old Hen",
                "Elzic's Farewell", "Kitchen Girl", "Say Old Man", "Soldier's Joy", "Tam Lin", "The Butterfly",
            ])
    }

    @Test func offersNothingWhileTheCatalogIsUnread() async throws {
        let model = TunePickerModel(store: try await SampleCatalog.copiedStore(root: root.url), listID: session.id)
        model.query = "Soldier"
        #expect(model.results == nil)
        #expect(await model.submit() == .nothing)
    }

    @Test func marksATuneAlreadyInTheListAndKeepsItInert() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store)
        model.query = "soldier"
        let row = try #require(model.results?.rows.first)
        #expect(row.entry.tune.title == "Soldier's Joy")
        #expect(row.isTaken)
        await model.pick(row.entry)
        #expect(model.query == "soldier", "an inert row changes nothing")
    }

    /// A row names its action, then reads the whole row, so an archived tune says so and two
    /// tunes with one title sound apart.
    @Test func findsArchivedTunesAndReadsTheWholeRowAloud() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        model.query = "say old"
        let row = try #require(model.results?.rows.first)
        #expect(row.entry.tune.title == "Say Old Man")
        #expect(row.isTaken == false)
        let spoken = TuneRowText(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
        #expect(row.name == "Add \(spoken.accessibilityLabel(position: nil))")
        #expect(row.name.hasSuffix(TuneRowText.archived))
    }

    @Test func addsAPickedTuneAndClearsTheSearchForTheNext() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store)
        model.query = "butterfly"
        await model.pick(catalogEntry("The Butterfly"))
        #expect(model.query.isEmpty)
        let members = try await store.read { db in
            try ListContents.fetch(db, listID: session.id)?.entries.map(\.tune.title)
        }
        #expect(members?.last == "The Butterfly")
        model.query = "butterfly"
        try await eventually { model.results?.rows.first?.isTaken == true }
    }

    @Test func addsATuneOnceFromTwoTapsAtOnce() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store)
        let entry = catalogEntry("The Butterfly")
        async let first: Void = model.pick(entry)
        async let second: Void = model.pick(entry)
        _ = await (first, second)
        let count = try await store.read { db in
            try ListItem.filter(ListItem.CodingKeys.listID == session.id).filter(ListItem.CodingKeys.deletedAt == nil)
                .fetchCount(db)
        }
        #expect(count == 6)
    }

    @Test func offersToCreateTheTypedTitleAndSaysNoTuneHasIt() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        model.query = "Rove Riley"
        let results = try #require(model.results)
        #expect(results.rows.isEmpty)
        #expect(results.noTuneCalled == "No tune called \"Rove Riley\"")
        #expect(results.outcome.addTypedTitleLabel == "Add \"Rove Riley\"")
        #expect(await model.submit() == .create(title: "Rove Riley"))
    }

    @Test func offersAnotherTuneWhenTheTitleExists() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        model.query = "tam lin"
        let results = try #require(model.results)
        #expect(results.noTuneCalled == nil)
        #expect(results.outcome.addTypedTitleLabel == "Add another \"tam lin\"")
    }

    @Test func returnAddsTheOnlyMatchAndDoesNothingForALoneTakenOne() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store)
        model.query = "Ashokan"
        #expect(await model.submit() == .picked)
        #expect(model.query.isEmpty)
        let titles = try await store.read { db in
            try ListContents.fetch(db, listID: session.id)?.entries.map(\.tune.title)
        }
        #expect(titles?.last == "Ashokan Farewell")
        model.query = "Tam Lin"
        #expect(await model.submit() == .nothing)
        #expect(model.query == "Tam Lin")
    }

    @Test func returnOnlyClosesTheKeyboardOverSeveralMatches() async throws {
        let model = try await picker(try await SampleCatalog.copiedStore(root: root.url))
        model.query = "farewell"
        #expect(model.results?.rows.count == 2)
        #expect(await model.submit() == .dismissKeyboard)
    }

    @Test func showsAtMostEightResults() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let commands = Commands(store: store)
        for index in 0..<10 {
            _ = try await commands.createTune(
                TuneInput(title: "Reel \(index)"), userTune: UserTuneInput(status: "known"))
        }
        let model = try await picker(store)
        model.query = "Reel "
        #expect(model.results?.rows.count == TunePickerModel.maxResults)
        #expect(model.results?.matches.count == 10)
    }

    @Test func reportsAFailureAfterTheSheetClosesToTheScreen() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        var late: String?
        let model = TunePickerModel(store: store, listID: session.id) { late = $0 }
        try await eventually { model.results != nil }
        try await Commands(store: store).deleteList(session.id)
        model.close()
        await model.pick(catalogEntry("The Butterfly"))
        #expect(late == CommandError.listNotFoundMessage)
        #expect(model.failure == nil)
    }
}

@MainActor @Suite(.timeLimit(.minutes(1))) struct ListPickerModelTests {
    private let root = TemporaryRoot()

    private func picker(
        _ store: CrosstuneStore, titles: [String], excluding: String? = nil,
        sourceLocation: SourceLocation = #_sourceLocation
    ) async throws
        -> ListPickerModel
    {
        let model = ListPickerModel(
            store: store, userTuneIDs: titles.map { sample($0).userTune.id }, excludeListID: excluding)
        try await eventually(sourceLocation: sourceLocation) {
            model.isLoaded && model.rows.allSatisfy { $0.isOffered || $0.note != nil }
        }
        return model
    }

    @Test func titlesItselfByTheNumberOfTunes() {
        #expect(ListPickerModel.title(count: 1) == "Add 1 tune to a list")
        #expect(ListPickerModel.title(count: 3) == "Add 3 tunes to a list")
    }

    @Test func readsHowMuchOfTheSelectionEachListHolds() {
        #expect(ListPickerModel.note(inList: 0, total: 1) == nil)
        #expect(ListPickerModel.note(inList: 1, total: 1) == TunePickerModel.inThisList)
        #expect(ListPickerModel.note(inList: 0, total: 2) == nil)
        #expect(ListPickerModel.note(inList: 1, total: 2) == ListPickerModel.someAlreadyIn(1, of: 2))
        #expect(ListPickerModel.note(inList: 2, total: 2) == ListPickerModel.allAlreadyIn)
    }

    @Test func neitherOffersNorNotesARowBeforeMembershipLoads() {
        let row = ListPickerModel.Row(id: "l", name: "Tuesday session", holding: nil, total: 2)
        #expect(row.note == nil)
        #expect(row.isOffered == false)
    }

    @Test func closesAListHoldingBothTunesOfASelection() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "Cluck Old Hen"])
        let row = try #require(model.rows.first { $0.name == "Tuesday session" })
        #expect(row.note == ListPickerModel.allAlreadyIn)
        #expect(row.isOffered == false)
    }

    @Test func offersEveryListButAFullOne() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy"])
        #expect(model.rows.map(\.name) == ["Tuesday session", "Waltzes"])
        #expect(model.rows.map(\.note) == [TunePickerModel.inThisList, nil])
        #expect(model.rows.map(\.isOffered) == [false, true])
        #expect(await model.add(to: model.rows[0]) == nil)
    }

    @Test func leavesOutTheExcludedList() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy"], excluding: session.id)
        #expect(model.rows.map(\.name) == ["Waltzes"])
    }

    @Test func addsOnlyTheTunesAListLacks() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "The Butterfly"])
        #expect(model.rows[0].note == ListPickerModel.someAlreadyIn(1, of: 2))
        let addition = try #require(await model.add(to: model.rows[0]))
        #expect(addition.added == 1)
        #expect(addition.created == false)
        #expect(addition.listName == "Tuesday session")
        #expect(await model.add(to: model.rows[1]) == nil, "the picker adds once")

        try await addition.undo(with: Commands(store: store))
        let count = try await store.read { try ListSummary.fetchAll($0).first?.count }
        #expect(count == 5)
    }

    @Test func createsAListHoldingEveryTune() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "The Butterfly"])
        model.newName = "   "
        #expect(await model.create() == nil)
        model.newName = "  Jam night "
        let addition = try #require(await model.create())
        #expect(addition.created)
        #expect(addition.added == 2)
        let summaries = try await store.read { try ListSummary.fetchAll($0) }
        #expect(summaries.last?.name == "Jam night")
        #expect(summaries.last?.count == 2)

        try await addition.undo(with: Commands(store: store))
        #expect(try await store.read { try ListSummary.fetchAll($0).count } == 2)
    }

    @Test func letsAFailedAddBeTriedAgain() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = try await picker(store, titles: ["The Butterfly"])
        let row = model.rows[1]
        try await Commands(store: store).deleteList(waltzes.id)
        #expect(await model.add(to: row) == nil)
        #expect(model.failure == CommandError.listNotFoundMessage)
        #expect(model.isDone == false)
    }
}

@MainActor @Suite(.timeLimit(.minutes(1))) struct ListNameModelTests {
    private let root = TemporaryRoot()

    @Test func createsAListWithATrimmedName() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = ListNameModel(store: store, target: .new)
        model.setName("  Jam night ")
        let id = try #require(await model.save())
        #expect(try await store.read { try TuneList.fetchOne($0, key: id)?.name } == "Jam night")
        #expect(await model.save() == nil, "a second press makes no second list")
    }

    @Test func requiresAName() async throws {
        let model = ListNameModel(store: try await SampleCatalog.copiedStore(root: root.url), target: .new)
        #expect(model.hasName == false, "Create opens disabled on a new list")
        model.setName("   ")
        #expect(model.hasName == false)
        #expect(await model.save() == nil)
        #expect(model.validation == "A list needs a name")
        model.setName("J")
        #expect(model.hasName)
        #expect(model.validation == nil)
    }

    @Test func renamesWithTheCurrentNameFilledIn() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = ListNameModel(store: store, target: .rename(listID: waltzes.id, name: waltzes.name))
        #expect(model.name == "Waltzes")
        #expect(model.isEdited == false)
        model.setName("Slow waltzes")
        #expect(model.isEdited)
        #expect(await model.save() == waltzes.id)
        #expect(try await store.read { try TuneList.fetchOne($0, key: waltzes.id)?.name } == "Slow waltzes")
    }
}

@Suite(.timeLimit(.minutes(1))) struct ListRowPlayTests {
    private let root = TemporaryRoot()
    private let now = SampleCatalog.now

    private func entry(_ title: String, in store: CrosstuneStore) async throws -> ListEntry {
        let contents = try #require(try await store.read { db in try ListContents.fetch(db, listID: session.id) })
        return try #require(contents.entries.first { $0.tune.title == title })
    }

    @Test func fetchesTheLiveRecordingsAndLinksOfEachTune() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let joy = try await entry("Soldier's Joy", in: store)
        #expect(joy.links.map(\.id) == ["sample_link_youtube", "sample_link_spotify"])
        #expect(joy.recordings.map(\.tuneID) == [joy.tune.id])
        try await Commands(store: store).removeLink("sample_link_youtube", at: later(1000, than: now))
        let after = try await entry("Soldier's Joy", in: store)
        #expect(after.links.map(\.id) == ["sample_link_spotify"])
    }

    @Test func playsAPinnedLinkInTheItemTheTuneScreenLoads() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let joy = try await entry("Soldier's Joy", in: store)
        let pinned = joy.links[0]
        try await Commands(store: store).setPlaySource(joy.userTune.id, to: .link(id: pinned.id))
        let pinnedEntry = try await entry("Soldier's Joy", in: store)
        #expect(
            ListRowPlay.action(for: pinnedEntry, playFirst: UserSettings.playFirstRecordings)
                == .play(try #require(PlayerItem.link(pinned))))
    }

    @Test func leavesATuneWithOnlyRecordingsInertWhileRecordingsCannotPlay() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let joy = try await entry("Soldier's Joy", in: store)
        let recordingsOnly = ListEntry(
            item: joy.item, tune: joy.tune, userTune: joy.userTune, recordings: joy.recordings, files: joy.files,
            links: [])
        #expect(recordingsOnly.recordings.isEmpty == false)
        #expect(
            ListRowPlay.action(for: recordingsOnly, playFirst: UserSettings.playFirstRecordings, recordingsPlay: false)
                == .inert)
    }

    @Test func playsTheFirstRecordingByDefault() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let joy = try await entry("Soldier's Joy", in: store)
        let recording = try #require(joy.recordings.first)
        #expect(
            ListRowPlay.action(for: joy, playFirst: UserSettings.playFirstRecordings)
                == .play(PlayerItem.recording(recording, tuneTitle: joy.tune.title)))
    }

    @Test func opensALinkThatHasNoPlayer() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let hen = try await entry("Cluck Old Hen", in: store)
        let linkOnly = ListEntry(
            item: hen.item, tune: hen.tune, userTune: hen.userTune, recordings: [], files: [:], links: hen.links)
        let url = try #require(LinkText.outboundURL(hen.links[0].url))
        let action = ListRowPlay.action(for: linkOnly, playFirst: UserSettings.playFirstRecordings)
        #expect(action == .open(url, linkTitle: LinkText.title(hen.links[0])))
        let open = try #require(action)
        #expect(
            ListRowText.label(for: open, tuneTitle: hen.tune.title, loaded: false)
                == "\(LinkText.open) \(LinkText.title(hen.links[0]))")
    }

    @Test func leavesAChosenLinkThatCanNeitherPlayNorOpenInert() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let hen = try await entry("Cluck Old Hen", in: store)
        var link = hen.links[0]
        link.url = "javascript:alert(1)"
        link.provider = "other"
        #expect(LinkText.outboundURL(link.url) == nil)
        let inertLink = ListEntry(
            item: hen.item, tune: hen.tune, userTune: hen.userTune, recordings: [], files: [:], links: [link])
        #expect(ListRowPlay.action(for: inertLink, playFirst: UserSettings.playFirstRecordings) == .inert)
    }

    @Test func playsADownloadedRecordingAndFetchesOneOnlyTheServerHolds() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let joy = try await entry("Soldier's Joy", in: store)
        #expect(joy.files[joy.recordings[0].id] != nil)
        let hen = try await entry("Cluck Old Hen", in: store)
        let serverOnly = try #require(hen.recordings.first)
        #expect(hen.files[serverOnly.id] == nil)
        #expect(
            ListRowPlay.action(for: hen, playFirst: UserSettings.playFirstRecordings)
                == .play(PlayerItem.recording(serverOnly, tuneTitle: hen.tune.title)))
    }

    @Test func leavesARecordingOnlyTheServerHoldsInertWhileOffline() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let hen = try await entry("Cluck Old Hen", in: store)
        let recordingsOnly = ListEntry(
            item: hen.item, tune: hen.tune, userTune: hen.userTune, recordings: hen.recordings, files: hen.files,
            links: [])
        #expect(
            ListRowPlay.action(for: recordingsOnly, playFirst: UserSettings.playFirstRecordings, online: false)
                == .inert)
        let joy = try await entry("Soldier's Joy", in: store)
        let held = try #require(joy.recordings.first)
        #expect(
            ListRowPlay.action(for: joy, playFirst: UserSettings.playFirstRecordings, online: false)
                == .play(PlayerItem.recording(held, tuneTitle: joy.tune.title)))
    }

    @Test func showsASpinnerWhileTheChosenRecordingDownloads() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let hen = try await entry("Cluck Old Hen", in: store)
        let serverOnly = try #require(hen.recordings.first)
        #expect(
            ListRowPlay.action(
                for: hen, playFirst: UserSettings.playFirstRecordings, downloading: { $0 == serverOnly.id })
                == .downloading)
    }

    @Test func keepsStopForTheLoadedRecordingWhileThePlayerFetchesIt() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let hen = try await entry("Cluck Old Hen", in: store)
        let serverOnly = try #require(hen.recordings.first)
        #expect(
            ListRowPlay.action(
                for: hen, playFirst: UserSettings.playFirstRecordings, loaded: { $0 == serverOnly.id },
                downloading: { $0 == serverOnly.id })
                == .play(PlayerItem.recording(serverOnly, tuneTitle: hen.tune.title)))
    }

    @Test func leavesARecordingWithNoAudioAnywhereInert() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let tam = try await entry("Tam Lin", in: store)
        let processing = Recording(
            id: "r_processing", tuneID: tam.tune.id, source: "upload", addedAt: now, state: "processing")
        let silent = ListEntry(
            item: tam.item, tune: tam.tune, userTune: tam.userTune, recordings: [processing], files: [:],
            links: [])
        #expect(ListRowPlay.action(for: silent, playFirst: UserSettings.playFirstRecordings) == .inert)
    }

    @Test func passesOverARecordingThatCannotPlayToALink() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let tam = try await entry("Tam Lin", in: store)
        let processing = Recording(
            id: "r_processing", tuneID: tam.tune.id, source: "upload", addedAt: now, state: "processing")
        let serverOnly = Recording(id: "r_server", tuneID: tam.tune.id, source: "upload", addedAt: now, state: "ready")
        let link = RecordingLink(id: "l1", tuneID: tam.tune.id, url: "https://example.com/tune", provider: "other")
        var pinned = tam.userTune
        pinned.playRecordingID = processing.id
        let processingEntry = ListEntry(
            item: tam.item, tune: tam.tune, userTune: pinned, recordings: [processing], files: [:], links: [link])
        let url = try #require(LinkText.outboundURL(link.url))
        let opens = ListRowPlay.Action.open(url, linkTitle: LinkText.title(link))
        #expect(ListRowPlay.action(for: processingEntry, playFirst: UserSettings.playFirstRecordings) == opens)
        let serverEntry = ListEntry(
            item: tam.item, tune: tam.tune, userTune: tam.userTune, recordings: [serverOnly], files: [:],
            links: [link])
        #expect(
            ListRowPlay.action(for: serverEntry, playFirst: UserSettings.playFirstRecordings, online: false) == opens)
    }

    @Test func blocksOnlyPlayWhileARecordingIsRecorded() {
        let item = PlayerItem(kind: .recording, id: "r1", title: "x")
        let url = URL(string: "https://example.com")!
        #expect(ListRowPlay.isBlocked(.play(item), capturing: true))
        #expect(ListRowPlay.isBlocked(.play(item), capturing: false) == false)
        #expect(ListRowPlay.isBlocked(.open(url, linkTitle: "x"), capturing: true) == false)
    }

    @Test func offersNothingForATuneWithNoSources() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let tam = try await entry("Tam Lin", in: store)
        #expect(tam.recordings.isEmpty && tam.links.isEmpty)
        #expect(ListRowPlay.action(for: tam, playFirst: UserSettings.playFirstRecordings) == nil)
    }

    @Test func namesTheButtonAfterTheTune() {
        #expect(ListRowText.playLabel(tuneTitle: "Tam Lin", loaded: false) == "\(MediaText.play) Tam Lin")
        #expect(ListRowText.playLabel(tuneTitle: "Tam Lin", loaded: true).contains("Tam Lin"))
        #expect(ListRowText.playLabel(tuneTitle: "Tam Lin", loaded: true).hasPrefix(MediaText.closePlayer))
    }

    @Test func showsStopForTheLoadedItem() {
        let item = PlayerItem(kind: .recording, id: "r1", title: "x")
        #expect(ListRowPlay.isLoaded(.play(item), holds: { $0 == .recording && $1 == "r1" }))
        #expect(ListRowPlay.isLoaded(.play(item), holds: { _, _ in false }) == false)
        #expect(
            ListRowPlay.isLoaded(.open(URL(string: "https://example.com")!, linkTitle: "x"), holds: { _, _ in true })
                == false)
    }
}

struct PlaylistRecordingsTests {
    private func recording(_ id: String, state: String = "ready") -> Recording {
        Recording(id: id, tuneID: "t", source: "microphone", addedAt: noon, state: state)
    }

    private func file(_ id: String, _ state: LocalFileState, name: String? = "a.m4a") -> RecordingFile {
        RecordingFile(id: id, localState: state, fileName: name)
    }

    @Test func keepsARecordingWithAudioOnThisDeviceEvenOffline() {
        let local = recording("a", state: "pending")
        let kept = RecordingText.playlistCapable(
            [local], files: ["a": file("a", .downloaded)], online: false)
        #expect(kept == [local])
    }

    @Test func keepsAReadyServerCopyOnlyWhileOnline() {
        let ready = recording("a")
        #expect(RecordingText.playlistCapable([ready], files: [:], online: true) == [ready])
        #expect(RecordingText.playlistCapable([ready], files: [:], online: false).isEmpty)
    }

    @Test func dropsARecordingWithNoAudioAnywhere() {
        let silent = recording("a", state: "pending")
        #expect(RecordingText.playlistCapable([silent], files: [:], online: true).isEmpty)
        // A capture still being written is not playable.
        let capturing = recording("b", state: "pending")
        #expect(
            RecordingText.playlistCapable([capturing], files: ["b": file("b", .capturing)], online: true).isEmpty)
    }

    @Test func keepsTheOrderOfWhatRemains() {
        let kept = RecordingText.playlistCapable(
            [recording("a"), recording("b", state: "pending"), recording("c")], files: [:], online: true)
        #expect(kept.map(\.id) == ["a", "c"])
    }
}

struct ListPlayTextTests {
    @Test func countsTheTunesThatWillPlay() {
        #expect(ListPlayText.count(playable: 14, total: 20) == "14 of 20 tunes will play")
    }

    @Test func saysWhenNothingCanPlay() {
        let none = PlaylistReport(playable: [], total: 1)
        #expect(ListPlayText.line(for: none) == "No tunes in this list can play")
        let one = PlaylistReport(playable: ["a"], total: 1)
        #expect(ListPlayText.line(for: one) == "1 of 1 tunes will play")
    }
}

struct ListPlayOfferTests {
    private func offer(
        report: PlaylistReport = PlaylistReport(playable: ["a"], total: 1), canStart: Bool = true,
        playing: ListPlayAvailability.Playing? = nil
    ) -> ListPlayAvailability {
        ListPlayAvailability(
            report: report, canStart: canStart, playing: playing, onPlay: {}, onShuffle: {})
    }

    @Test func offersPlayWhileTheListIsStopped() {
        let stopped = offer()
        #expect(stopped.playLabel == ListPlayText.play)
        #expect(stopped.isPlayDisabled == false)
    }

    @Test func offersPauseWhileTheListPlaysAndPlayWhilePaused() {
        let playing = offer(playing: .init(isPlaying: true, isSettled: true))
        #expect(playing.playLabel == ListPlayText.pause)
        let paused = offer(playing: .init(isPlaying: false, isSettled: true))
        #expect(paused.playLabel == ListPlayText.play)
        #expect(paused.isPlayDisabled == false)
    }

    @Test func holdsPlayWhileTheNextTuneLoads() {
        let loading = offer(playing: .init(isPlaying: false, isSettled: false))
        #expect(loading.isPlayDisabled)
        #expect(loading.isShuffleDisabled == false)
    }

    @Test func leavesOutTheButtonsWhenNothingCanPlay() {
        let none = PlaylistReport(playable: [], total: 1)
        #expect(offer(report: none).showsButtons == false)
        #expect(offer().showsButtons)
    }

    /// A playing list's tunes can stop being playable, such as when their recordings are
    /// deleted, and Play must still pause what plays.
    @Test func pausesAPlayingListWithNothingLeftToStart() {
        let none = PlaylistReport(playable: [], total: 1)
        let playing = offer(report: none, playing: .init(isPlaying: true, isSettled: true))
        #expect(playing.showsButtons)
        #expect(playing.isPlayDisabled == false)
        #expect(playing.isShuffleDisabled)
    }

    @Test func holdsBothWhileARecordingIsUnderWay() {
        let recording = offer(canStart: false, playing: .init(isPlaying: true, isSettled: true))
        #expect(recording.isPlayDisabled)
        #expect(recording.isShuffleDisabled)
    }
}

struct ListRowTapTests {
    @Test func jumpsWithinThePlayingListAndPlaysAloneOtherwise() {
        #expect(ListRowPlay.tap(listPlaying: true) == .jump)
        #expect(ListRowPlay.tap(listPlaying: false) == .single)
    }

    @Test func neverCallsThePlayingRowNotPlayable() {
        #expect(ListRowText.note(hasAction: false, isCurrent: false) == ListRowText.notPlayable)
        #expect(ListRowText.note(hasAction: false, isCurrent: true) == nil)
        #expect(ListRowText.note(hasAction: true, isCurrent: false) == nil)
    }

    @Test func marksTheCurrentTuneOfThePlayingListWhateverItsRowActionIs() {
        func now(_ list: String?, _ tune: String?) -> Bool {
            ListRowPlay.isNowPlaying(listID: "l1", playingListID: list, currentTuneID: tune, tuneID: "t1")
        }
        #expect(now("l1", "t1"))
        #expect(now("l1", "t2") == false)
        #expect(now("l2", "t1") == false)
        #expect(now(nil, nil) == false)
    }
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct PlaylistResolverTests {
    private let root = TemporaryRoot()
    private let session = "sample_list_session"

    private func tamLin(_ store: CrosstuneStore) async throws -> String {
        try #require(try await store.read { db in try Tune.filter(Tune.CodingKeys.title == "Tam Lin").fetchOne(db) }).id
    }

    private func resolve(
        _ store: CrosstuneStore, listID: String? = nil, tuneID: String, access: AppleMusicAccessState = .fullTracks,
        online: Bool = true
    ) async -> ListPlayback.Turn? {
        let resolver = ListPlayback.resolver(
            store: store, access: FakeAccess(access), online: { online },
            playFirst: { UserSettings.playFirstRecordings })
        return await resolver(listID ?? session, tuneID)
    }

    private func putLocalRecording(_ store: CrosstuneStore, tuneID: String) async throws {
        try await store.write { writer in
            try writer.put(
                Recording(id: "local", tuneID: tuneID, source: "microphone", addedAt: noon, state: "pending"),
                at: noon)
            try RecordingFile(id: "local", localState: .captured, fileName: "local.m4a").upsert(writer.db)
        }
    }

    @Test func passesOverARecordingWithNoAudio() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        try await store.write { writer in
            try writer.put(
                Recording(id: "silent", tuneID: id, source: "microphone", addedAt: noon, state: "pending"),
                at: noon)
        }
        #expect(await resolve(store, tuneID: id) == nil)
    }

    @Test func playsTheSongWhenTheOnlyRecordingHasNoAudio() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        let song = RecordingLink(
            id: "song", tuneID: id, url: "https://music.apple.com/us/song/x/1", provider: "apple_music")
        try await store.write { writer in
            try writer.put(
                Recording(id: "silent", tuneID: id, source: "microphone", addedAt: noon, state: "pending"),
                at: noon)
            try writer.put(song, at: noon)
        }
        let turn = await resolve(store, tuneID: id)
        #expect(turn?.item == PlayerItem.link(song))
        #expect(turn?.title == "Tam Lin")
    }

    @Test func playsARecordingWithAudioOnThisDevice() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        try await putLocalRecording(store, tuneID: id)
        let turn = await resolve(store, tuneID: id, online: false)
        #expect(turn?.item.id == "local")
        #expect(turn?.title == "Tam Lin")
    }

    @Test func skipsATuneRemovedFromTheList() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        try await putLocalRecording(store, tuneID: id)
        #expect(await resolve(store, tuneID: id) != nil)
        let itemID = try await store.read { db in
            try ListItem.filter(ListItem.CodingKeys.listID == session).fetchAll(db).first {
                try UserTune.fetchOne(db, key: $0.userTuneID)?.tuneID == id
            }!.id
        }
        try await store.write { writer in try writer.removeFromList(itemID, at: noon) }
        #expect(await resolve(store, tuneID: id) == nil)
    }

    @Test func skipsATuneThatIsNotInThePlayingList() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        try await putLocalRecording(store, tuneID: id)
        #expect(await resolve(store, listID: "sample_list_waltzes", tuneID: id) == nil)
    }

    @Test(arguments: [true, false])
    func playsExactlyTheTunesTheReportSaysWillPlay(online: Bool) async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let id = try await tamLin(store)
        try await store.write { writer in
            try writer.put(
                Recording(id: "silent", tuneID: id, source: "microphone", addedAt: noon, state: "pending"),
                at: noon)
            try writer.put(
                RecordingLink(id: "spotify", tuneID: id, url: "https://open.spotify.com/track/x", provider: "spotify"),
                at: noon)
        }
        let contents = try #require(
            try await store.read { db in try ListContents.fetch(db, listID: session) })
        let report = playlistReport(
            entries: contents.entries.map { $0.playlistEntry(online: online) },
            playFirst: UserSettings.playFirstRecordings, fullTracks: true, online: online)
        #expect(report.playable.contains(id) == false)
        for entry in contents.entries {
            let turn = await resolve(store, tuneID: entry.tune.id, online: online)
            #expect((turn != nil) == report.playable.contains(entry.tune.id), "\(entry.tune.title)")
        }
    }
}

@Suite(.timeLimit(.minutes(1))) struct ListsPlayabilityTests {
    private let root = TemporaryRoot()

    private func reports(
        _ store: CrosstuneStore, online: Bool = false
    ) async throws -> [String: PlaylistReport] {
        let snapshot = try await store.read { db in
            try ListsPlayability.Snapshot.fetch(db, settingsID: settingsID(clerkUserID: store.userID))
        }
        return ListsPlayability.reports(snapshot, canStart: true, fullTracks: false, online: online)
    }

    @Test func reportsNothingUntilReadOrWhilePlayingCannotStart() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let snapshot = try await store.read { db in
            try ListsPlayability.Snapshot.fetch(db, settingsID: settingsID(clerkUserID: store.userID))
        }
        #expect(ListsPlayability.reports(snapshot, canStart: true, fullTracks: false, online: false).isEmpty == false)
        // A recording is under way, or no playlist player is there.
        #expect(ListsPlayability.reports(snapshot, canStart: false, fullTracks: false, online: false).isEmpty)
        // The Apple Music access has not read, so a song's count would flash wrong.
        #expect(ListsPlayability.reports(snapshot, canStart: true, fullTracks: nil, online: false).isEmpty)
        #expect(ListsPlayability.reports(nil, canStart: true, fullTracks: false, online: false).isEmpty)
    }

    @Test func reportsOnlyTheListsWithATuneThatPlays() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let commands = Commands(store: store)
        let empty = try await commands.createList("Empty")
        let silent = try await commands.createList("Nothing to hear")
        _ = try await commands.addToList(silent, userTuneID: sample("The Butterfly").userTune.id)
        let reports = try await reports(store)
        #expect(reports[session.id]?.playable.contains(sample("Soldier's Joy").tune.id) == true)
        #expect(reports[empty] == nil)
        #expect(reports[silent] == nil)
    }

    @Test func countsAnArchivedTuneOnlyWhileListsShowArchivedTunes() async throws {
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let commands = Commands(store: store)
        let list = try await commands.createList("Archived only")
        let joy = sample("Soldier's Joy").userTune.id
        _ = try await commands.addToList(list, userTuneID: joy)
        try await commands.setArchived(joy, archived: true)
        #expect(try await reports(store)[list] == nil)
        try await store.write { writer in try writer.setMeta(.listShowArchived, to: true) }
        #expect(try await reports(store)[list] != nil)
    }

    @Test func namesTheRowControlForTheList() {
        #expect(ListsPlayability.playLabel(listName: "Waltzes") == "Play Waltzes")
        #expect(ListsPlayability.pauseLabel(listName: "Waltzes") == "Pause Waltzes")
    }
}

@MainActor
struct ListRowLayoutTests {
    private let tune = Tune(createdAt: noon, title: "Soldier's Joy", key: "D")
    private var userTune: UserTune { UserTune(createdAt: noon, tuneID: tune.id, status: "learning") }

    @Test func speaksItsPosition() {
        let text = TuneRowText(tune: tune, userTune: userTune, instruments: [])
        #expect(text.accessibilityLabel(position: 3).hasPrefix("3, "))
    }

    /// The row's note, as the list page gives it for a tune with nothing to play.
    private func noted(
        tune: Tune? = nil, hasAction: Bool = false, isCurrent: Bool = false
    ) -> TuneRowText {
        let tune = tune ?? self.tune
        return TuneRowText(
            tune: tune, userTune: UserTune(createdAt: noon, tuneID: tune.id, status: "learning"),
            instruments: ["violin"],
            note: ListRowText.note(hasAction: hasAction, isCurrent: isCurrent))
    }

    @Test func saysNothingToPlayInItsSecondLineAndSpokenName() {
        let row = noted()
        #expect(row.secondLine == "Nothing to play")
        #expect(row.accessibilityLabel(position: 2) == "2, Soldier's Joy, Key D, Learning, Nothing to play")
        let tuned = Tune(
            createdAt: noon, title: "Bonaparte's Retreat", key: "D",
            tunings: ["violin": .object(["tuning": .string("Cross D (DADD)")])])
        #expect(noted(tune: tuned).secondLine == "Cross D (DADD) · \(ListRowText.notPlayable)")
    }

    @Test(arguments: [(true, false), (false, true)])
    func saysNothingToPlayOnlyForARowWithNothingToPlay(hasAction: Bool, isCurrent: Bool) {
        let row = noted(hasAction: hasAction, isCurrent: isCurrent)
        #expect(row.secondLine == nil)
        #expect(row.accessibilityLabel().contains(ListRowText.notPlayable) == false)
    }

    #if os(macOS)
        @Test func drawsNoPosition() {
            let plain = TuneRow(tune: tune, userTune: userTune, instruments: [], stacked: true)
            let placed = TuneRow(tune: tune, userTune: userTune, instruments: [], position: 12, stacked: true)
            #expect(hostedSize(placed).width == hostedSize(plain).width)
        }

        @Test func macRowDrawsNoPosition() {
            let text = TuneRowText(tune: tune, userTune: userTune, instruments: [])
            let placed = hostedSize(MacTuneRow(text: text, position: 12))
            #expect(placed.width == hostedSize(MacTuneRow(text: text, position: nil)).width)
        }

        @Test(arguments: [DynamicTypeSize.large, .accessibility3])
        func listPageRowMatchesCatalogRowHeight(textSize: DynamicTypeSize) {
            let catalog = TuneRow(tune: tune, userTune: userTune, instruments: [], stacked: true)
            let entry = bareListEntry(tune: tune, userTune: userTune)
            let item = sampleRecordingItem()
            let listRow = HStack {
                TuneRow(tune: tune, userTune: userTune, instruments: [], position: 1, stacked: true)
                ListRowPlayButton(entry: entry, action: .play(item), listID: "l1")
            }
            let listHeight = hostedSize(listRow, width: 375, textSize: textSize).height
            #expect(listHeight == hostedSize(catalog, width: 375, textSize: textSize).height)
        }

        /// A row with nothing to play keeps its slot's width, so its key lines up with the keys
        /// of rows that play, and its second line makes it no taller than a catalog row with one.
        @Test(arguments: [DynamicTypeSize.large, .accessibility3])
        func nothingToPlayRowKeepsTheColumnAndTheCatalogHeight(textSize: DynamicTypeSize) {
            let tuned = Tune(
                createdAt: noon, title: "Bonaparte's Retreat", key: "D",
                tunings: ["violin": .object(["tuning": .string("Cross D (DADD)")])])
            let catalog = TuneRow(
                tune: tuned, userTune: UserTune(createdAt: noon, tuneID: tuned.id, status: "learning"),
                instruments: ["violin"], stacked: true)
            let entry = bareListEntry(tune: tune, userTune: userTune)
            let item = sampleRecordingItem()
            let empty = ListRowPlayButton(entry: entry, action: nil, listID: "l1")
            let listRow = HStack {
                TuneRow(
                    tune: tune, userTune: userTune, instruments: [], position: 1, stacked: true,
                    note: ListRowText.note(hasAction: false, isCurrent: false))
                empty
            }
            let listHeight = hostedSize(listRow, width: 375, textSize: textSize).height
            #expect(listHeight == hostedSize(catalog, width: 375, textSize: textSize).height)
            let playWidth = hostedSize(
                ListRowPlayButton(entry: entry, action: .play(item), listID: "l1"), textSize: textSize
            )
            .width
            #expect(hostedSize(empty, textSize: textSize).width == playWidth)
            #expect(playWidth > 0)
        }

        @Test func macRowShowsItsNote() {
            let plain = TuneRowText(tune: tune, userTune: userTune, instruments: [])
            let noted = TuneRowText(
                tune: tune, userTune: userTune, instruments: [], note: ListRowText.notPlayable)
            #expect(
                hostedSize(MacTuneRow(text: noted, position: 1)).width
                    > hostedSize(MacTuneRow(text: plain, position: 1)).width)
        }
    #endif
}

struct ListsScreenRowTests {
    @Test func listsScreenRowsHaveNoChevronOrSeparator() throws {
        let source = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Lists/ListsScreen.swift")))
        #expect(source.contains("NavigationLink") == false)
        #expect(source.contains(".listItemRow()"))
    }
}
