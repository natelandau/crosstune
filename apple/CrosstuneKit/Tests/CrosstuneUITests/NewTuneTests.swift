import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Observation
import SwiftUI
import Testing

@testable import CrosstuneUI

/// The new-tune draft: a title alone makes the tune, Return opens it, leaving the page with a
/// title makes it without opening it, and a draft left blank makes nothing.
@MainActor
@Suite struct NewTuneTests {
    private let sink = RecordingAnalyticsSink()
    /// Held for the test, since the store's folder goes with it.
    private let root = TemporaryRoot()

    private func opened() async throws -> (CrosstuneStore, AddedTuneOffer) {
        let store = try root.open()
        try await store.write { writer in
            try writer.put(
                UserSettings(
                    id: settingsID(clerkUserID: store.userID), createdAt: noon, audioQuality: "standard",
                    instruments: ["violin"]), at: noon)
        }
        return (store, AddedTuneOffer(store: store, analytics: sink.client))
    }

    private func draft(_ added: AddedTuneOffer, source: ActionSource = .catalog) -> NewTuneDraft {
        NewTuneDraft(source: source) { title, source in await added.addAfterAnyRunning(title: title, source: source) }
    }

    private func liveTitles(_ store: CrosstuneStore) async throws -> [String] {
        try await store.read { db in
            try Tune.filter(Tune.CodingKeys.deletedAt == nil).order(Tune.CodingKeys.title).fetchAll(db).map(\.title)
        }
    }

    // MARK: Creating

    @Test func returnCreatesTheTuneOpensItAndOffersItsUndo() async throws {
        let (store, added) = try await opened()
        let draft = draft(added)
        draft.title = "  Angeline "

        let created = try #require(await draft.submit())

        #expect(created.title == "Angeline")
        #expect(created.byReturn)
        #expect(try await liveTitles(store) == ["Angeline"])
        #expect(added.offer?.message == AddedTuneOffer.added("Angeline"))
        #expect(added.offer?.undo != nil)
        #expect(sink.captures.map(\.name) == ["tune_created"])
        #expect(sink.captures.first?.properties["tune_id"] == .string(created.tuneID))
    }

    @Test func leavingWithATitleCreatesTheTuneWithoutMovingFocus() async throws {
        let (store, added) = try await opened()
        let draft = draft(added)
        draft.title = "Angeline"

        let created = try #require(await draft.leave())

        #expect(!created.byReturn)
        #expect(try await liveTitles(store) == ["Angeline"])
        #expect(added.offer?.message == AddedTuneOffer.added("Angeline"))
    }

    @Test func theDraftTellsItsPageTheTuneHoweverItEnds() async throws {
        let (_, added) = try await opened()
        let draft = draft(added)
        var told: [NewTuneDraft.Created] = []
        draft.onCreated = { told.append($0) }
        draft.title = "Angeline"

        let created = await draft.leave()

        #expect(told == [created].compactMap(\.self))
    }

    @Test(arguments: ["", "   ", " \n "])
    func aBlankDraftCreatesNothingByReturnOrLeaving(_ typed: String) async throws {
        let (store, added) = try await opened()
        let draft = draft(added)
        draft.title = typed

        #expect(await draft.submit() == nil)
        #expect(await draft.leave() == nil)

        #expect(try await liveTitles(store).isEmpty)
        // Blank is a discard, not a refusal: the banner says nothing.
        #expect(added.offer == nil)
        #expect(sink.captures.isEmpty)
    }

    /// The iPhone app going to the background and the Mac window closing both leave the page,
    /// so a blank draft makes nothing there either.
    @Test func backgroundingOrClosingTheWindowOnABlankDraftCreatesNothing() async throws {
        let (store, added) = try await opened()
        let draft = draft(added)

        #expect(await draft.leave() == nil)
        draft.title = "  "
        #expect(await draft.leave() == nil)

        #expect(try await liveTitles(store).isEmpty)
        #expect(sink.captures.isEmpty)
    }

    @Test func aDraftCreatesOnceHoweverItEnds() async throws {
        let (store, added) = try await opened()
        let draft = draft(added)
        draft.title = "Angeline"

        let created = try #require(await draft.submit())
        // The page going as the tune replaces it, then the window closing.
        #expect(await draft.leave() == nil)
        #expect(await draft.leave() == nil)
        #expect(await draft.submit() == nil)

        #expect(try await liveTitles(store) == ["Angeline"])
        #expect(sink.captures.map(\.name) == ["tune_created"])
        #expect(draft.created == created)
    }

    @Test func leavingWhileReturnIsCreatingCreatesNothingMore() async throws {
        let (store, added) = try await opened()
        let draft = draft(added)
        draft.title = "Angeline"

        async let submitted = draft.submit()
        async let left = draft.leave()
        let (opened, alsoLeft) = await (submitted, left)

        #expect([opened, alsoLeft].compactMap(\.self).count == 1)
        #expect(try await liveTitles(store) == ["Angeline"])
    }

    @Test func leavingWhileAnotherAddRunsWaitsAndKeepsTheTitle() async throws {
        let (store, _) = try await opened()
        var landSearch: CheckedContinuation<Void, Never>?
        // The catalog's search makes a tune at the same moment, held here until the draft waits.
        let added = AddedTuneOffer(store: store, analytics: sink.client) { title, source in
            if title == "Rove Riley" { await withCheckedContinuation { landSearch = $0 } }
            return try await CrosstuneCommands.Commands(store: store).createTitleOnly(title: title, source: source)
        }
        let draft = draft(added)
        draft.title = "Angeline"

        let searched = Task { await added.add(title: "Rove Riley", source: .searchOffer) }
        #expect(try await poll { landSearch != nil })
        #expect(added.isAddRunning)
        let leaving = Task { await draft.leave() }
        #expect(try await poll { added.waitingAddCount == 1 })
        #expect(try await liveTitles(store).isEmpty)

        landSearch?.resume()
        #expect(await searched.value != nil)
        #expect(await leaving.value != nil)
        #expect(try await liveTitles(store) == ["Angeline", "Rove Riley"])
    }

    @Test func leavingTriesAgainAfterAReturnThatFailed() async throws {
        var calls = 0
        let draft = NewTuneDraft(source: .catalog) { _, _ in
            calls += 1
            return calls == 1 ? nil : "t1"
        }
        draft.title = "Angeline"

        #expect(await draft.submit() == nil)
        let created = try #require(await draft.leave())

        #expect(created.tuneID == "t1")
        #expect(calls == 2)
    }

    @Test(arguments: [ActionSource.catalog, .menu])
    func reportsTheEntryPointItOpenedFrom(_ source: ActionSource) async throws {
        let (_, added) = try await opened()
        let draft = draft(added, source: source)
        draft.title = "Angeline"

        _ = await draft.submit()

        #expect(sink.captures.first?.properties["source"] == .string(source.rawValue))
    }

    // MARK: Quitting

    @Test func aQuitWaitsForATitledDraftToMakeItsTune() async throws {
        let (store, added) = try await opened()
        let drafts = OpenDrafts()
        let titled = draft(added, source: .menu)
        titled.title = "Angeline"
        let blank = draft(added)
        drafts.opened(titled)
        drafts.opened(blank)
        var replied = false

        #expect(drafts.holdsQuit { replied = true })

        #expect(try await poll { replied })
        #expect(try await liveTitles(store) == ["Angeline"])
        #expect(sink.captures.first?.properties["source"] == .string("menu"))
    }

    @Test func aQuitGoesAtItsDeadlineThoughADraftHasNotLanded() async throws {
        var passDeadline: CheckedContinuation<Void, Never>?
        var landAdd: CheckedContinuation<String?, Never>?
        let drafts = OpenDrafts { await withCheckedContinuation { passDeadline = $0 } }
        let stuck = NewTuneDraft(source: .menu) { _, _ in await withCheckedContinuation { landAdd = $0 } }
        stuck.title = "Angeline"
        drafts.opened(stuck)
        var replies = 0

        #expect(drafts.holdsQuit { replies += 1 })
        #expect(try await poll { passDeadline != nil && landAdd != nil })
        passDeadline?.resume()

        #expect(try await poll { replies == 1 })
        // The draft landing late replies nothing more.
        landAdd?.resume(returning: "t1")
        await drafts.quitting?.value
        #expect(stuck.created != nil)
        #expect(replies == 1)
    }

    @Test func aDraftShownAgainBeforeItsLastPageLeftStaysOpen() async throws {
        let (_, added) = try await opened()
        let drafts = OpenDrafts()
        let draft = draft(added)

        drafts.opened(draft)
        // The page comes back before the leave of its last showing lands.
        drafts.opened(draft)
        #expect(!drafts.closed(draft))
        #expect(drafts.open.count == 1)

        #expect(drafts.closed(draft))
        #expect(drafts.isEmpty)
    }

    @Test func aQuitWithNoDraftOpenGoesAtOnce() {
        #expect(!OpenDrafts().holdsQuit {})
    }

    // MARK: Where the draft opens

    @Test(arguments: [ActionSource.catalog, .menu])
    func aDraftsPlaceNamesItsSource(_ source: ActionSource) {
        let id = NewTuneDraft.id(source: source)
        #expect(NewTuneDraft.source(of: id) == source)
        #expect(id != NewTuneDraft.id(source: source == .menu ? .catalog : .menu))
    }

    @Test func aTunesPlaceIsNoDraft() {
        #expect(NewTuneDraft.source(of: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b") == nil)
        #expect(NewTuneDraft.source(of: nil) == nil)
    }

    @Test func theCreatedTuneTakesTheDraftsPlaceOnlyWhileTheDraftHoldsIt() {
        let draft = NewTuneDraft.id(source: .catalog)
        #expect(NewTuneDraft.placeAfterCreate(shown: draft, draft: draft, created: "t1") == "t1")
        // Back, or another tune chosen, as the page went: that navigation is kept.
        #expect(NewTuneDraft.placeAfterCreate(shown: nil, draft: draft, created: "t1") == nil)
        #expect(NewTuneDraft.placeAfterCreate(shown: "t2", draft: draft, created: "t1") == "t2")
    }

    @Test func theHeldDraftLastsOnlyWhileItsTuneShows() {
        let held = HeldDraft(
            created: NewTuneDraft.Created(tuneID: "t1", title: "Angeline", byReturn: true), attributesLayout: .column)
        #expect(TuneScreen.keptHeld(held, showing: "t1") == held)
        // Another tune, then the made tune again: it arrives as any page does.
        #expect(TuneScreen.keptHeld(held, showing: "t2") == nil)
        #expect(TuneScreen.keptHeld(nil, showing: "t1") == nil)
    }

    #if os(iOS)
        @Test func aNewTuneOpensOnTheCatalogTab() {
            let place = ShellPlace()
            place.tab = .lists
            place.tabList = "l1"
            place.tabTunes[.catalog] = "t1"

            place.openNewTune(source: .menu)

            #expect(place.tab == .catalog)
            #expect(place.tabTunes[.catalog] == NewTuneDraft.id(source: .menu))
            #expect(place.tabList == "l1")
        }
    #else
        @Test func aNewTuneOpensInTheDetailColumnBesideACatalogWhereTheTunerFillsIt() {
            let place = ShellPlace()
            place.sidebar = .recordings
            place.detailTune = "t1"
            place.openNewTune(source: .menu)
            #expect(place.sidebar == .recordings)
            #expect(place.detailTune == NewTuneDraft.id(source: .menu))

            place.sidebar = .tuner
            place.openNewTune(source: .catalog)
            #expect(place.sidebar == .catalog)
            #expect(place.detailTune == NewTuneDraft.id(source: .catalog))
        }
    #endif
}

#if os(macOS)
    /// The detail column's tune, as the shell keeps it.
    @MainActor @Observable private final class Column {
        var tuneID: String?
        @ObservationIgnored lazy var value = ShellValue { [unowned self] in
            tuneID
        } set: { [unowned self] in
            tuneID = $0
        }

        init(_ tuneID: String) {
            self.tuneID = tuneID
        }
    }

    /// The draft as the detail column shows it, through `TuneScreen`.
    @MainActor
    @Suite(.enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct NewTuneScreenTests {
        private let root = TemporaryRoot()

        private struct Host: View {
            let column: Column

            var body: some View {
                if let tuneID = column.tuneID {
                    TuneScreen(tuneID: tuneID)
                } else {
                    Color.clear
                }
            }
        }

        private func host(
            _ column: Column, store: CrosstuneStore, drafts: OpenDrafts,
            heldChanged: @escaping @MainActor (HeldDraft?) -> Void = { _ in }
        ) -> NSWindow {
            let window = hiddenWindow(
                size: CGSize(width: 700, height: 500), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(
                rootView: Host(column: column)
                    .environment(\.heldDraftChanged, HeldDraftWatch(heldChanged))
                    .environment(\.detailTune, column.value)
                    .environment(\.store, store)
                    .environment(AddedTuneOffer(store: store))
                    .environment(\.openDrafts, drafts))
            window.orderFrontRegardless()
            return window
        }

        @Test func eachDraftStartsAfreshWithItsOwnSource() async throws {
            let store = try root.open()
            let drafts = OpenDrafts()
            let column = Column(NewTuneDraft.id(source: .catalog))
            let window = host(column, store: store, drafts: drafts)
            defer { window.close() }
            #expect(try await poll { drafts.open.map(\.source) == [.catalog] })
            drafts.open.first?.title = "Angel"

            column.tuneID = NewTuneDraft.id(source: .menu)

            #expect(try await poll { drafts.open.map(\.source) == [.menu] })
            #expect(drafts.open.first?.title == "")
            // The catalog's draft, left with a title, made its tune and left the menu's draft be.
            #expect(try await poll { try await store.read { db in try Tune.fetchCount(db) } == 1 })
            #expect(column.tuneID == NewTuneDraft.id(source: .menu))
        }

        @Test func aTuneOpenedAgainHoldsNoDraftTitle() async throws {
            let store = try root.open()
            let drafts = OpenDrafts()
            let column = Column(NewTuneDraft.id(source: .catalog))
            var held: [HeldDraft?] = []
            let window = host(column, store: store, drafts: drafts) { held.append($0) }
            defer { window.close() }
            let draft = try #require(try await poll { drafts.open.count == 1 } ? drafts.open.first : nil)
            draft.title = "Angeline"
            let created = try #require(await draft.submit())
            #expect(try await poll { column.tuneID == created.tuneID && held.last??.tuneID == created.tuneID })

            column.tuneID = "another-tune"
            #expect(try await poll { held.last == .some(nil) })
            column.tuneID = created.tuneID

            #expect(try await poll { held.last == .some(nil) })
        }

        @Test func returnPutsTheTuneInTheDraftsPlace() async throws {
            let store = try root.open()
            let drafts = OpenDrafts()
            let column = Column(NewTuneDraft.id(source: .catalog))
            let window = host(column, store: store, drafts: drafts)
            defer { window.close() }
            let draft = try #require(try await poll { drafts.open.count == 1 } ? drafts.open.first : nil)
            draft.title = "Angeline"

            let created = try #require(await draft.submit())

            #expect(try await poll { column.tuneID == created.tuneID })
            #expect(try await poll { drafts.isEmpty })
            #expect(try await store.read { db in try Tune.fetchCount(db) } == 1)
        }
    }
#endif
