import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

private func entry(
    _ id: String, key: String? = nil, modes: [String] = [], timeSignature: String? = nil, isCrooked: Bool = false,
    tunings: JSONObject = [:], status: String = "want_to_learn"
) -> CatalogEntry {
    CatalogEntry(
        tune: Tune(
            id: "tune_\(id)", title: id, key: key, modes: modes, timeSignature: timeSignature, isCrooked: isCrooked,
            tunings: tunings),
        userTune: UserTune(id: "user_tune_\(id)", tuneID: "tune_\(id)", status: status))
}

private func tuning(_ instrument: String, _ tuning: String? = nil, capo: Int64? = nil) -> JSONObject {
    var value: JSONObject = [:]
    if let tuning { value["tuning"] = .string(tuning) }
    if let capo { value["capo"] = .integer(capo) }
    return [instrument: .object(value)]
}

private let a = entry(
    "Say Old Man", key: "A", tunings: tuning("violin", "Standard (GDAE)"), status: "known")
private let b = entry(
    "Lost Indian", key: "A", tunings: tuning("violin", "Cross A (AEAE)"), status: "learning")

private func with(_ entry: CatalogEntry, modes: [String]? = nil, timeSignature: String? = nil, status: String? = nil)
    -> CatalogEntry
{
    var tune = entry.tune
    var userTune = entry.userTune
    if let modes { tune.modes = modes }
    if let timeSignature { tune.timeSignature = timeSignature }
    if let status { userTune.status = status }
    return CatalogEntry(tune: tune, userTune: userTune)
}

@Suite struct BatchEditSummaryTests {
    @Test func reportsSharedMixedAndEmptyFields() {
        let summary = BatchEdit.summarize([a, b])
        #expect(summary[.key] == .shared(.text("A")))
        #expect(summary[.tuning("violin")] == .mixed)
        #expect(summary[.genre] == .empty)
        #expect(summary[.status] == .mixed)
        #expect(summary[.isCrooked] == .shared(.flag(false)))
    }

    @Test func treatsAModeThisClientDoesNotKnowAsNoValue() {
        let lydian1 = with(a, modes: ["lydian"])
        let lydian2 = with(b, modes: ["lydian"])
        #expect(BatchEdit.summarize([lydian1, lydian2])[.mode] == .empty)
        let major = with(b, modes: ["major"])
        #expect(BatchEdit.summarize([lydian1, major])[.mode] == .mixed)
    }

    @Test func summarizesPartModesAsOneSharedValueWhenEveryTuneAgrees() {
        let kesh1 = with(a, modes: ["major", "minor"])
        let kesh2 = with(b, modes: ["major", "minor"])
        #expect(BatchEdit.summarize([kesh1, kesh2])[.mode] == .shared(.text("major, minor")))
    }

    @Test func treatsAnUnknownStatusAsNoValue() {
        #expect(BatchEdit.summarize([with(a, status: "retired")])[.status] == .empty)
    }

    @Test func treatsATimeSignatureThisClientDoesNotKnowAsNoValue() {
        #expect(BatchEdit.summarize([with(a, timeSignature: "7/8")])[.timeSignature] == .empty)
        #expect(BatchEdit.summarize([with(a, timeSignature: "3/2")])[.timeSignature] == .shared(.text("3/2")))
    }

    @Test func labelsEachFieldAsTheTuneFormDoes() {
        #expect(EditField.partStructure.label == TuneFieldLabels.partStructure)
        #expect(EditField.mode.label == "Mode")
        #expect(EditField.tuning("violin").label == "Violin tuning")
    }

    @Test func neverOffersAFieldUniqueToOneTune() {
        let labels = EditField.all.map(\.label)
        for unique in [
            TuneFieldLabels.title, TuneFieldLabels.alternateTitles, TuneFieldLabels.composer, TuneFieldLabels.notes,
            TuneFieldLabels.lyrics,
        ] {
            #expect(!labels.contains(unique))
        }
    }
}

@Suite struct BatchEditFieldTests {
    private let violin: Set<String> = ["violin"]

    @Test func showsATuningForAPlayedInstrumentOrOneASelectedTuneHolds() {
        let plain = entry("plain")
        let bouzouki = entry("bouzouki", tunings: tuning("bouzouki", "GDAD"))
        let fields = BatchEdit.visibleFields([plain, bouzouki], instruments: violin)
        #expect(fields.contains(.tuning("violin")))
        #expect(fields.contains(.tuning("bouzouki")))
        #expect(!fields.contains(.tuning("guitar")))
    }

    @Test func doesNotShowATuningFieldForACapoAlone() {
        let capo = entry("capo", tunings: tuning("guitar", capo: 2))
        #expect(!BatchEdit.visibleFields([a, capo], instruments: violin).contains(.tuning("guitar")))
    }

    @Test func treatsAValueEqualToTheSharedOneOrABlankOverEmptyAsUnchanged() {
        #expect(BatchEdit.isUnchanged(.shared(.text("A")), .text("A")))
        #expect(!BatchEdit.isUnchanged(.shared(.text("A")), .text(" A ")))
        #expect(!BatchEdit.isUnchanged(.shared(.text("A")), .text("D")))
        #expect(BatchEdit.isUnchanged(.empty, .text("")))
        #expect(BatchEdit.isUnchanged(.empty, .clear))
        #expect(!BatchEdit.isUnchanged(.mixed, .text("")))
        #expect(BatchEdit.isUnchanged(.shared(.flag(false)), .flag(false)))
    }
}

@Suite struct BatchEditPatchTests {
    @Test func splitsTouchedFieldsBetweenTuneAndUserTuneTrimmingAndClearing() {
        let patch = BatchEdit.patch([
            .tuning("violin"): .text(" Cross A (AEAE) "),
            .genre: .text(""),
            .mode: .clear,
            .isCrooked: .flag(true),
            .status: .text("known"),
            .learnedFrom: .text("Bruce Molsky"),
        ])
        #expect(
            patch
                == BulkPatch(
                    tune: BulkTunePatch(genre: .value(nil), modes: .value([]), isCrooked: .value(true)),
                    userTune: BulkUserTunePatch(status: .value("known"), learnedFrom: .value("Bruce Molsky")),
                    tunings: ["violin": .value("Cross A (AEAE)")]))
    }

    @Test func clearsATuningLeftBlank() {
        #expect(BatchEdit.patch([.tuning("guitar"): .text("  ")]) == BulkPatch(tunings: ["guitar": .value(nil)]))
    }

    @Test func writesAPickedModeAsTheWholeList() {
        #expect(BatchEdit.patch([.mode: .text("dorian")]).tune == BulkTunePatch(modes: .value(["dorian"])))
        #expect(BatchEdit.patch([.mode: .clear]).tune == BulkTunePatch(modes: .value([])))
    }

    @Test func editsTheType() {
        #expect(BatchEdit.patch([.tuneType: .text("Reel")]).tune == BulkTunePatch(tuneType: .value("Reel")))
    }

    @Test func skipsAValueOutsideItsFieldVocabulary() {
        let patch = BatchEdit.patch([
            .status: .text("mastered"), .mode: .text("lydian"), .timeSignature: .text("13/8"), .isCrooked: .clear,
        ])
        #expect(patch == BulkPatch())
        #expect(BatchEdit.patch([.timeSignature: .clear]).tune == BulkTunePatch(timeSignature: .value(nil)))
    }

    @Test func neverClearsStatus() {
        #expect(BatchEdit.patch([.status: .clear]) == BulkPatch())
    }
}

@Suite struct BulkEditFormTests {
    @Test func showsTheSharedValueNotSetOrMixed() {
        let form = BulkEditForm(entries: [a, b], instruments: ["violin"])
        #expect(form.shown(.key) == "A")
        #expect(form.shown(.genre) == "Not set")
        #expect(form.shown(.tuning("violin")) == "Mixed")
        #expect(form.shown(.status) == "Mixed")
        #expect(form.shown(.isCrooked) == "No")
        #expect(BulkEditForm(entries: [a], instruments: []).shown(.status) == "Known")
    }

    @Test func keepsSaveDeadUntilARowChangesSomething() {
        var form = BulkEditForm(entries: [a, b], instruments: ["violin"])
        #expect(!form.isEdited)
        form.touch(.key, .text("A"))
        #expect(!form.isEdited, "picking the shared value changes nothing")
        form.touch(.genre, .clear)
        #expect(!form.isEdited, "clearing an empty field changes nothing")
        form.touch(.key, .text("D"))
        #expect(form.isEdited)
        #expect(form.shown(.key) == "D")
        form.touch(.key, nil)
        #expect(!form.isEdited)
    }

    @Test func clearsAMixedRowAndKeepsAYesOrNoRow() {
        var form = BulkEditForm(entries: [a, b], instruments: ["violin"])
        form.touch(.tuning("violin"), .clear)
        #expect(form.shown(.tuning("violin")) == "Not set")
        #expect(!form.isMixed(.tuning("violin")))
        #expect(form.patch.tunings == ["violin": .value(nil)])
        form.touch(.isCrooked, .flag(true))
        #expect(form.shown(.isCrooked) == "Yes")
        form.touch(.isCrooked, nil)
        #expect(form.patch.tune.isCrooked == .keep)
    }
}

@Suite struct TuneSelectionTests {
    private let visible = ["a", "b", "c", "d", "e"]

    @Test func entersFromARowWithThatRowSelected() {
        var selection = TuneSelection()
        selection.enter(with: "c")
        #expect(selection.isActive)
        #expect(selection.ids == ["c"])
        #expect(selection.origin == "c")
        selection.exit()
        #expect(!selection.isActive)
        #expect(selection.ids.isEmpty)
        #expect(selection.origin == "c", "VoiceOver returns to the row the mode opened from")
    }

    @Test func entersFromTheToolbarWithNothingSelected() {
        var selection = TuneSelection()
        selection.enter()
        #expect(selection.isActive)
        #expect(selection.ids.isEmpty)
    }

    @Test func selectsAllVisibleTunesAndDeselectsThem() {
        var selection = TuneSelection()
        selection.enter()
        selection.toggleAll(visible: visible)
        #expect(selection.ids.count == 5)
        #expect(selection.allSelected(visible: visible))
        selection.toggleAll(visible: visible)
        #expect(selection.ids.isEmpty)
    }

    @Test func isNeverAllSelectedWithNothingVisible() {
        #expect(!TuneSelection().allSelected(visible: []))
    }

    @Test func dropsTunesThatAreNoLongerVisible() {
        var selection = TuneSelection()
        selection.enter()
        selection.selectAll(visible: visible)
        selection.prune(visible: ["a", "c"])
        #expect(selection.ids == ["a", "c"])
        selection.prune(visible: visible)
        #expect(selection.ids == ["a", "c"], "a tune shown again does not come back")
    }

    @Test func keepsOnlyVisibleRowsTheListChooses() {
        var selection = TuneSelection()
        selection.enter()
        selection.set(["a", "z"], visible: visible)
        #expect(selection.ids == ["a"])
    }

    @Test func listsTheSelectedRowsInScreenOrder() {
        var selection = TuneSelection()
        selection.enter(with: "d")
        selection.set(["d", "b"], visible: visible)
        #expect(selection.selected(in: visible) { $0 } == ["b", "d"])
    }

    @Test func entersWhenTheListChoosesSeveralRowsAndShowsOneInTheDetailOtherwise() {
        var selection = TuneSelection()
        var detail: String? = "a"
        selection.choose(["b"], detail: &detail)
        #expect(detail == "b")
        #expect(!selection.isActive)
        selection.choose(["b", "c"], detail: &detail)
        #expect(selection.isActive)
        #expect(selection.ids == ["b", "c"])
        #expect(detail == "b", "the detail column keeps its tune")
    }

    @Test func countsTheSelectionInTheTitle() {
        #expect(TuneSelection.title(1) == "1 tune")
        #expect(TuneSelection.title(3) == "3 tunes")
    }
}

@Suite struct BulkActionTextTests {
    @Test func carriesTheCountInEveryLabelAndMessage() {
        #expect(BulkActionText.archive(true, count: 3) == "Archive 3 tunes")
        #expect(BulkActionText.archive(false, count: 1) == "Unarchive 1 tune")
        #expect(BulkActionText.archived(true, count: 3) == "Archived 3 tunes")
        #expect(BulkActionText.archived(false, count: 2) == "Unarchived 2 tunes")
        #expect(BulkActionText.remove(2) == "Remove 2 from list")
        #expect(BulkActionText.removed(2, from: "Waltzes") == "Removed 2 tunes from Waltzes")
        #expect(BulkActionText.delete(4) == "Delete 4 tunes")
        #expect(BulkActionText.statusSet("want_to_learn", count: 2) == "Set 2 tunes to Unknown")
        #expect(BulkActionText.edited(1) == "Edited 1 tune")
        #expect(BulkActionText.editTitle(3) == "Edit 3 tunes")
    }
}

@Suite @MainActor struct BulkActionsTests {
    private let root = TemporaryRoot()

    private func sample(_ title: String) -> CatalogEntry {
        let entry = SampleCatalog.entries.first { $0.tune.title == title }!
        return CatalogEntry(tune: entry.tune, userTune: entry.userTune)
    }

    private func userTune(_ store: CrosstuneStore, _ title: String) async throws -> UserTune {
        let id = sample(title).userTune.id
        return try #require(try await store.read { try UserTune.fetchOne($0, key: id) })
    }

    private func tune(_ store: CrosstuneStore, _ title: String) async throws -> Tune {
        let id = sample(title).tune.id
        return try #require(try await store.read { try Tune.fetchOne($0, key: id) })
    }

    private func eventually(_ condition: () async throws -> Bool) async throws {
        if try await poll({ try await condition() }) { return }
        Issue.record("Timed out waiting for a condition")
    }

    @Test func setsStatusOffersItsUndoAndTakesItBackFromTheBanner() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager
        let entries = [sample("The Butterfly"), sample("Elzic's Farewell")]
        #expect(await bulk.setStatus("known", of: entries))
        #expect(try await userTune(store, "The Butterfly").status == "known")
        let offer = try #require(bulk.offer)
        #expect(offer.message == "Set 2 tunes to Known")
        #expect(undoManager.canUndo)
        #expect(undoManager.undoActionName == BulkActionText.setStatus)

        offer.undo()
        try await eventually { try await userTune(store, "The Butterfly").status == "want_to_learn" }
        #expect(try await userTune(store, "Elzic's Farewell").status == "want_to_learn")
        #expect(!undoManager.canUndo, "the banner's undo withdraws the system one")
    }

    @Test func systemUndoTakesTheActionBackAndClosesTheBanner() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager
        #expect(await bulk.setArchived(true, [sample("Tam Lin"), sample("Say Old Man")]))
        #expect(bulk.offer?.message == "Archived 1 tune", "only the tune not already archived counts")
        #expect(try await userTune(store, "Tam Lin").archivedAt != nil)

        undoManager.undo()
        #expect(bulk.offer == nil)
        try await eventually { try await userTune(store, "Tam Lin").archivedAt == nil }
        #expect(try await userTune(store, "Say Old Man").archivedAt != nil)
    }

    @Test func systemRedoMakesAnUndoneActionAgainAndStepsBackAndForth() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager
        #expect(await bulk.setStatus("known", of: [sample("The Butterfly")]))

        undoManager.undo()
        try await eventually { try await userTune(store, "The Butterfly").status == "want_to_learn" }
        #expect(undoManager.canRedo)
        #expect(undoManager.redoActionName == BulkActionText.setStatus)

        undoManager.redo()
        try await eventually { try await userTune(store, "The Butterfly").status == "known" }
        #expect(undoManager.canUndo)
        #expect(bulk.offer == nil, "a redo does not bring the banner back")

        // Asked back to back, the writes still land in order.
        undoManager.undo()
        undoManager.redo()
        undoManager.undo()
        try await eventually { try await userTune(store, "The Butterfly").status == "want_to_learn" }
    }

    @Test func systemRedoMakesAnUndoneListAgain() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager
        let picker = ListPickerModel(store: store, userTuneIDs: [sample("Tam Lin").userTune.id])
        picker.newName = "Irish"
        bulk.added(try #require(await picker.create()))
        let names = { try await store.read { try ListSummary.fetchAll($0).map(\.name) } }

        undoManager.undo()
        try await eventually { try await !names().contains("Irish") }
        undoManager.redo()
        try await eventually { try await names().contains("Irish") }
        let remade = try #require(try await store.read { try ListSummary.fetchAll($0) }.first { $0.name == "Irish" })
        #expect(remade.count == 1)

        undoManager.undo()
        try await eventually { try await !names().contains("Irish") }
    }

    @Test func doesNothingWhenNoTuneWouldChange() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        #expect(!(await bulk.setArchived(false, [sample("Tam Lin")])))
        #expect(bulk.offer == nil)
    }

    @Test func keepsTheSelectionWhenAWriteFails() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let gone = entry("gone")
        #expect(!(await bulk.setStatus("known", of: [gone])))
        #expect(bulk.failure != nil)
        #expect(bulk.offer == nil)
        #expect(await bulk.setStatus("known", of: [sample("Tam Lin")]))
        #expect(bulk.failure == nil, "the next action clears the failure")
    }

    @Test func removesTunesFromAListAndPutsThemBack() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let order = { () async throws -> [String] in
            try await store.read { db in
                activeByPosition(
                    try ListItem.filter(ListItem.CodingKeys.listID == SampleCatalog.lists[0].id).fetchAll(db)
                ).map(\.id)
            }
        }
        let before = try await order()
        let items = [before[0], before[2]]
        #expect(await bulk.remove(itemIDs: items, from: "Tuesday session"))
        #expect(bulk.offer?.message == "Removed 2 tunes from Tuesday session")
        #expect(try await order().count == 3)

        bulk.offer?.undo()
        try await eventually { try await order() == before }
    }

    @Test func systemUndoStillWorksAfterTheScreenHasGone() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let undoManager = UndoManager()
        var bulk: BulkActions? = BulkActions(store: store)
        weak let released = bulk
        bulk?.undoManager = undoManager
        #expect(await bulk?.setArchived(true, [sample("Tam Lin")]) == true)
        bulk = nil
        #expect(released == nil)

        undoManager.undo()
        try await eventually { try await userTune(store, "Tam Lin").archivedAt == nil }
    }

    @Test func writesTheEditSheetsPatchAndKeepsAFailureForTheSheet() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        var form = BulkEditForm(entries: [sample("Tam Lin"), sample("Big Scioty")], instruments: [])
        form.touch(.genre, .text("Irish"))
        #expect(await bulk.edit([sample("Tam Lin"), sample("Big Scioty")], patch: form.patch))
        #expect(bulk.offer?.message == "Edited 2 tunes")
        #expect(try await tune(store, "Big Scioty").genre == "Irish")
        #expect(try await tune(store, "Big Scioty").key == "C/G", "an untouched field is not written")

        #expect(!(await bulk.edit([entry("gone")], patch: form.patch)))
        #expect(bulk.editFailure != nil)
        #expect(bulk.failure == nil, "the sheet holds the failure, not the screen")
    }

    @Test func offersTheUndoOfAListPick() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let picker = ListPickerModel(
            store: store, userTuneIDs: [sample("Tam Lin").userTune.id, sample("The Butterfly").userTune.id])
        picker.newName = "Irish"
        let addition = try #require(await picker.create())
        bulk.added(addition)
        #expect(bulk.offer?.message == "Created Irish with 2 tunes")
        #expect(
            BulkActionText.added(
                ListAddition(listID: "l", listName: "Waltzes", added: 3, created: false, itemIDs: []))
                == "Added 3 tunes to Waltzes")

        bulk.offer?.undo()
        try await eventually { try await store.read { try ListSummary.fetchAll($0).count } == 2 }
    }

    @Test func asksBeforeDeletingAndNamesTheRecordingsThatGo() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store)
        let many = try #require(await bulk.deleteQuestion([sample("Soldier's Joy"), sample("Cluck Old Hen")]))
        #expect(many.title == "Delete 2 tunes?")
        #expect(many.message == "Delete 2 tunes? This removes their links, list entries, and 2 recordings.")
        let one = try #require(await bulk.deleteQuestion([sample("Tam Lin")]))
        #expect(one.title == DeleteTuneMessage.title)
        #expect(one.message == "Delete \"Tam Lin\"? This removes its links and list entries.")

        #expect(await bulk.delete(many))
        #expect(bulk.offer == nil, "a delete has nothing to undo")
        let deletedID = sample("Soldier's Joy").tune.id
        #expect(try await store.read { try Tune.fetchOne($0, key: deletedID)?.deletedAt } != nil)
    }
}
