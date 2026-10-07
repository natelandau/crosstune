import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func at(_ iso: String) -> Timestamp { Timestamp(iso: iso)! }

private func entry(
    _ id: String, _ title: String, added: String? = nil, tuneEdited: String? = nil, userEdited: String? = nil
) -> CatalogEntry {
    CatalogEntry(
        tune: Tune(id: id, createdAt: noon, updatedAt: tuneEdited.map(at), title: title),
        userTune: UserTune(
            id: "u-\(id)", createdAt: added.map(at) ?? noon, updatedAt: userEdited.map(at), tuneID: id,
            status: "known"))
}

private func titles(_ entries: [CatalogEntry]) -> [String] { entries.map(\.tune.title) }
private func choice(_ sort: CatalogSort, _ descending: Bool) -> CatalogSortChoice {
    CatalogSortChoice(sort: sort, descending: descending)
}

@Suite struct CatalogSortChoiceTests {
    @Test func offersTitleThenTheThreeDatesWithTitleCheckedAToZ() {
        let items = SortChoices<CatalogSort>.items(for: .default)
        #expect(items.map(\.label) == ["Title", "Date added", "Date modified", "Last played"])
        #expect(items.map(\.isChecked) == [true, false, false, false])
        #expect(items.map(\.direction) == [SortText.aToZ, nil, nil, nil])
    }

    @Test func namesTheListHeaderButtonForItsSortAndDirection() {
        #expect(SortText.buttonLabel(CatalogSortChoice.default) == "Sort by Title, A to Z")
        #expect(SortText.buttonLabel(choice(.added, true)) == "Sort by Date added, Newest first")
        #expect(SortText.buttonLabel(choice(.played, false)) == "Sort by Last played, Oldest first")
    }

    @Test func keepsItsChoiceApartFromTheRecordingsScreen() {
        #expect(CatalogSortChoice.storageKey != RecordingSortChoice.storageKey)
    }

    @Test func startsEveryDateSortNewestFirst() {
        for sort in [CatalogSort.added, .modified, .played] {
            #expect(CatalogSortChoice.default.picking(sort) == choice(sort, true))
            #expect(SortText.direction(choice(sort, true)) == SortText.newestFirst)
        }
        #expect(choice(.played, true).picking(.title) == .default)
    }
}

@Suite struct CatalogSortingTests {
    private let none: [String: Timestamp] = [:]

    @Test func sortsByTitleIgnoringCaseAndAccentsAndReversesForZToA() {
        let entries = [entry("a", "cluck old hen"), entry("b", "Ángeline"), entry("c", "Bonaparte")]
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.title, false), lastPlayed: none)) == [
                "Ángeline", "Bonaparte", "cluck old hen",
            ])
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.title, true), lastPlayed: none)) == [
                "cluck old hen", "Bonaparte", "Ángeline",
            ])
    }

    @Test func breaksATitleTieByID() {
        let entries = [entry("z", "Sally Ann"), entry("m", "Sally Ann")]
        #expect(
            CatalogSearch.sorted(entries, by: choice(.title, false), lastPlayed: none).map(\.tune.id) == ["m", "z"])
    }

    @Test func sortsByWhenTheTuneJoinedTheCatalog() {
        let entries = [
            entry("a", "Middle", added: "2026-03-01T00:00:00Z"),
            entry("b", "Newest", added: "2026-05-01T00:00:00Z"),
            entry("c", "Oldest", added: "2026-01-01T00:00:00Z"),
        ]
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.added, true), lastPlayed: none)) == [
                "Newest", "Middle", "Oldest",
            ])
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.added, false), lastPlayed: none)) == [
                "Oldest", "Middle", "Newest",
            ])
    }

    @Test func sortsByTheLaterOfTheTunesAndTheMusiciansOwnLastEdit() {
        let entries = [
            entry("a", "Tune edited last", tuneEdited: "2026-06-01T00:00:00Z", userEdited: "2026-02-01T00:00:00Z"),
            entry("b", "Own row edited last", tuneEdited: "2026-01-01T00:00:00Z", userEdited: "2026-07-01T00:00:00Z"),
            entry("c", "Untouched", tuneEdited: "2026-03-01T00:00:00Z", userEdited: "2026-03-01T00:00:00Z"),
        ]
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.modified, true), lastPlayed: none)) == [
                "Own row edited last", "Tune edited last", "Untouched",
            ])
    }

    @Test func breaksADateTieByTitleAToZInEitherDirection() {
        let entries = [
            entry("a", "Cotton Eyed Joe", added: "2026-03-01T00:00:00Z"),
            entry("b", "Arkansas Traveler", added: "2026-03-01T00:00:00Z"),
        ]
        for descending in [true, false] {
            #expect(
                titles(CatalogSearch.sorted(entries, by: choice(.added, descending), lastPlayed: none)) == [
                    "Arkansas Traveler", "Cotton Eyed Joe",
                ])
        }
    }

    @Test func sortsByLastPlayedWithNeverPlayedTunesLastInEitherDirection() {
        let entries = [
            entry("a", "Played long ago"), entry("b", "Never played"), entry("c", "Played today"),
            entry("d", "Also never played"),
        ]
        let played = ["a": at("2026-01-01T00:00:00Z"), "c": at("2026-10-04T00:00:00Z")]
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.played, true), lastPlayed: played)) == [
                "Played today", "Played long ago", "Also never played", "Never played",
            ])
        #expect(
            titles(CatalogSearch.sorted(entries, by: choice(.played, false), lastPlayed: played)) == [
                "Played long ago", "Played today", "Also never played", "Never played",
            ])
    }

    @Test func keepsEachTuneItsLatestPlayOrPracticeSession() async throws {
        let plays = [
            PlayEvent(context: "row", startedAt: at("2026-02-01T10:00:00Z"), listenedMs: 1, tuneID: "t1"),
            PlayEvent(context: "row", startedAt: at("2026-04-01T10:00:00Z"), listenedMs: 1, tuneID: "t1"),
            PlayEvent(context: "row", startedAt: at("2026-09-01T10:00:00Z"), listenedMs: 1, recordingID: "r"),
        ]
        let sessions = [
            PracticeSession(
                recordingID: "r", tuneID: "t1", startedAt: at("2026-03-01T10:00:00Z"), durationMs: 1,
                speedPercent: 100, pitchCents: 0),
            PracticeSession(
                recordingID: "r", tuneID: "t2", startedAt: at("2026-05-01T10:00:00Z"), durationMs: 1,
                speedPercent: 100, pitchCents: 0),
        ]
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            for play in plays { try writer.record(play) }
            for session in sessions { try writer.record(session) }
        }
        #expect(
            try await store.read { db in try CatalogSearch.lastPlayed(db) } == [
                "t1": at("2026-04-01T10:00:00Z"), "t2": at("2026-05-01T10:00:00Z"),
            ])
    }
}

@MainActor
@Suite struct CatalogModelSortTests {
    /// Waits for the model's live queries to catch up with the store.
    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    @Test func ordersByTitleUntilAnotherSortIsChosen() async throws {
        let root = TemporaryRoot()
        let model = CatalogModel(store: try await SampleCatalog.makeStore(root: root.url))
        try await eventually { model.results != nil }
        let shown = try #require(model.results?.visible.map(\.tune.title))
        #expect(shown == shown.sorted { CatalogSearch.precedes($0, $1) })
    }

    @Test func ordersByLastPlayedFromTheStoredHistoryAndRedrawsAsPlaysLand() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = CatalogModel(store: store)
        try await eventually { model.results != nil }
        let visible = try #require(model.results?.visible)
        // The last two in title order, so only the history can lift them to the top.
        let (first, second) = (visible[visible.count - 1], visible[visible.count - 2])
        try await store.write { writer in
            try writer.record(
                PracticeSession(
                    recordingID: "r", tuneID: first.tune.id, startedAt: later(60_000), durationMs: 1,
                    speedPercent: 100, pitchCents: 0))
        }

        model.sort = CatalogSortChoice(sort: .played, descending: true)
        try await eventually { model.results?.visible.first?.tune.id == first.tune.id }

        // A play pulled from the server after the sort was chosen moves its tune to the top.
        try await store.write { writer in
            try writer.record(
                PlayEvent(context: "row", startedAt: later(120_000), listenedMs: 1, tuneID: second.tune.id))
        }
        try await eventually { model.results?.visible.prefix(2).map(\.tune.id) == [second.tune.id, first.tune.id] }
    }

    @Test func readsTheHistoryWhenLastPlayedIsAlreadyTheSavedSort() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        let titleOrder = CatalogModel(store: store)
        try await eventually { titleOrder.results != nil }
        let last = try #require(titleOrder.results?.visible.last)
        try await store.write { writer in
            try writer.record(PlayEvent(context: "row", startedAt: later(60_000), listenedMs: 1, tuneID: last.tune.id))
        }

        let model = CatalogModel(store: store, sort: CatalogSortChoice(sort: .played, descending: true))
        try await eventually { model.results?.visible.first?.tune.id == last.tune.id }
    }
}
