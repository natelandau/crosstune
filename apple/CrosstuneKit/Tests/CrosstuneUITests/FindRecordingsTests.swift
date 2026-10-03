import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

/// A search the test answers: at once from ``outcome``, or, while ``holds`` is set, only when
/// the test calls ``answer(_:with:)``.
@MainActor
private final class FakeSearch {
    struct Call: Equatable {
        var q: String
        var providers: [String]
        var country: String
    }

    var outcome = RecordingSearchOutcome.ok([])
    var holds = false
    private(set) var calls: [Call] = []
    private var waiting: [CheckedContinuation<RecordingSearchOutcome, Never>] = []

    var search: FindRecordingsModel.Search {
        { q, providers, country in
            self.calls.append(Call(q: q, providers: providers, country: country))
            guard self.holds else { return self.outcome }
            return await withCheckedContinuation { self.waiting.append($0) }
        }
    }

    var waitingCount: Int { waiting.count }

    /// Answers the `index`th held search.
    func answer(_ index: Int, with outcome: RecordingSearchOutcome) {
        waiting[index].resume(returning: outcome)
    }
}

private let soldiersJoy = SampleCatalog.entries[0].tune
private let elzicsFarewell = SampleCatalog.entries[7].tune

private func result(_ url: String, provider: String = "apple_music", title: String = "Soldier's Joy") -> SearchResult {
    SearchResult(
        url: url, provider: provider, providerRef: provider == "tidal" ? "track:1" : nil, title: title,
        subtitle: "Bruce Molsky · Soldier's Joy", artworkURL: "https://art.test/\(title).jpg")
}

private func group(_ results: [SearchResult], provider: String = "apple_music") -> SearchGroup {
    SearchGroup(provider: provider, status: .results, results: results, searchURL: "https://search.test/\(provider)")
}

private let appleTrack = result("https://music.apple.com/us/album/soldiers-joy/1?i=2")
private let otherAppleTrack = result("https://music.apple.com/us/album/soldiers-joy/1?i=3", title: "Soldier's Joy 2")

@MainActor
@Suite struct FindRecordingsModelTests {
    private let root = TemporaryRoot()

    private func links(_ store: CrosstuneStore, tuneID: String) async throws -> [RecordingLink] {
        try await store.read { db in
            try RecordingLink.filter(Column("tune_id") == tuneID).fetchAll(db).filter { $0.deletedAt == nil }
        }
    }

    private func setSearchProviders(_ store: CrosstuneStore, _ providers: [String]) async throws {
        var settings = SampleCatalog.settings
        settings.searchProviders = providers
        let row = settings
        try await store.write { writer in try writer.put(row, at: .now) }
    }

    private func model(
        _ store: CrosstuneStore, tuneID: String = soldiersJoy.id, service: String? = nil, search: FakeSearch?,
        country: String = "IE", stopPlayer: @escaping @MainActor () -> Void = {}
    ) -> FindRecordingsModel {
        FindRecordingsModel(
            store: store, tuneID: tuneID, service: service, search: search?.search, country: country,
            stopPlayer: stopPlayer)
    }

    // MARK: Opening

    @Test func opensOnTheChosenServicesWithTheTitleAndTypeAndSearchesNothing() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, search: search)

        try await eventually { model.isLoaded }
        #expect(model.query == "Soldier's Joy Reel")
        #expect(model.providers == SampleCatalog.searchProviders)
        #expect(model.shown == nil)
        #expect(!model.isDirect)
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.isEmpty)
        #expect(!model.isSearching)
    }

    @Test func prefillsTheTitleAloneForATuneWithNoType() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, tuneID: elzicsFarewell.id, search: FakeSearch())

        try await eventually { model.isLoaded }
        #expect(model.query == "Elzic's Farewell")
    }

    @Test func leavesTheFieldEmptyForAMissingTune() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, tuneID: "no_such_tune", search: FakeSearch())

        try await eventually { model.isLoaded }
        #expect(model.query == "")
    }

    @Test func listsOnlyTheChosenServicesThisBuildKnowsInOrder() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await setSearchProviders(store, ["spotify", "napster", "tidal"])
        let model = model(store, search: FakeSearch())

        try await eventually { model.providers == ["tidal", "spotify"] }
    }

    @Test func listsEveryServiceWhenThereIsNoSettingsRow() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await store.write { writer in
            try writer.db.execute(sql: "DELETE FROM user_settings")
        }
        let model = model(store, search: FakeSearch())

        try await eventually { model.isLoaded }
        #expect(model.providers == searchableProviders)
    }

    @Test func typingBeforeTheTuneLoadsKeepsWhatWasTyped() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, search: FakeSearch())

        model.setQuery("Tam Lin")
        try await eventually { model.isLoaded }
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.query == "Tam Lin")
    }

    @Test func searchesOnlyTheAppsOwnServicesInPlace() {
        #expect(FindRecordingsModel.inlineSearch == ["apple_music", "tidal", "internet_archive"])
        #expect(FindRecordingsModel.searchesInApp("tidal"))
        #expect(!FindRecordingsModel.searchesInApp("spotify"))
    }

    // MARK: Picking a service

    @Test func pickingAServiceSearchedHereSearchesOnlyItAndShowsItsResults() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = .ok([group([appleTrack])])
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        #expect(await model.pick("apple_music") == nil)

        #expect(model.shown == "apple_music")
        #expect(search.calls == [.init(q: "Soldier's Joy Reel", providers: ["apple_music"], country: "IE")])
        #expect(model.group == group([appleTrack]))
        #expect(model.failure == nil)
    }

    @Test func pickingAServiceSearchedElsewhereAnswersItsSearchPageAndStaysOnTheList() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = .ok([
            SearchGroup(provider: "spotify", status: .searchOnly, results: [], searchURL: "https://spotify.test/q")
        ])
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        #expect(await model.pick("spotify") == URL(string: "https://spotify.test/q"))

        #expect(model.shown == nil)
        #expect(search.calls == [.init(q: "Soldier's Joy Reel", providers: ["spotify"], country: "IE")])
        #expect(model.failure == nil)
    }

    @Test(arguments: [
        (RecordingSearchOutcome.offline, "Search needs a connection"),
        (.rateLimited(retryAfter: 3), "Too many searches. Try again in 3 seconds."),
        (.failed, "Couldn't search. Try again."),
        (.ok([]), "Couldn't search. Try again."),
    ])
    func saysWhyAServicesSearchPageCouldNotOpen(outcome: RecordingSearchOutcome, message: String) async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = outcome
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        #expect(await model.pick("youtube") == nil)
        #expect(model.failure == message)
        #expect(model.shown == nil)
    }

    @Test func asksForASearchPageOnlyWithSomethingToSearchFor() async throws {
        let search = FakeSearch()
        let page = await FindRecordingsModel.searchPage(
            for: "spotify", query: "   ", country: "IE", search: search.search)
        #expect(page == nil)
        #expect(search.calls.isEmpty)
    }

    @Test func answersASearchPageWithNoServerToAskAsOffline() async throws {
        let page = await FindRecordingsModel.searchPage(for: "spotify", query: "Tam Lin", country: "IE", search: nil)
        #expect(page == .failure(SearchPageFailure(message: FindRecordingsModel.searchNeedsConnection)))
    }

    @Test func searchesTheShownServiceAgainOnReturnWithTheQueryTrimmedAndCapped() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        _ = await model.pick("tidal")

        let long = String(repeating: "a", count: 250)
        model.setQuery("  \(long)  ")
        await model.submit()
        #expect(search.calls.count == 2)
        #expect(search.calls.last?.q == String(repeating: "a", count: FindRecordingsModel.maxQuery))
        #expect(search.calls.last?.providers == ["tidal"])
        #expect(FindRecordingsModel.maxQuery == 200)

        model.setQuery("   ")
        await model.submit()
        #expect(search.calls.count == 2)
    }

    @Test func aReturnOnTheListSearchesNothing() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        await model.submit()
        #expect(search.calls.isEmpty)
    }

    @Test func capsTheQueryByUnicodeScalarsAsTheServerCountsCodePoints() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        // A flag is two scalars but one Character, so a Character count would send 201 scalars.
        model.setQuery(String(repeating: "a", count: 199) + "🇮🇪🎻")
        _ = await model.pick("tidal")
        #expect(search.calls.last?.q == String(repeating: "a", count: 199) + "\u{1F1EE}")
        #expect(search.calls.last?.q.unicodeScalars.count == FindRecordingsModel.maxQuery)
    }

    @Test func showsSearchingOnlyWhileARequestIsInFlight() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        #expect(!model.isSearching)

        let picking = Task { await model.pick("apple_music") }
        try await eventually { search.waitingCount == 1 }
        #expect(model.isSearching)
        search.answer(0, with: .ok([group([appleTrack])]))
        _ = await picking.value
        #expect(!model.isSearching)
        #expect(model.group == group([appleTrack]))
    }

    @Test func showsTheShownServicesGroupWhateverItsStatus() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        // A service searched here can still answer search-only, such as one missing its credentials.
        let searchOnly = SearchGroup(
            provider: "tidal", status: .searchOnly, results: [], searchURL: "https://tidal.test")
        search.outcome = .ok([searchOnly])
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        _ = await model.pick("tidal")
        #expect(model.group == searchOnly)
        #expect(model.failure == nil)
    }

    @Test func namesWhatEachGroupShows() {
        let unavailable = SearchGroup(provider: "tidal", status: .unavailable, results: [], searchURL: "u")
        let searchOnly = SearchGroup(provider: "spotify", status: .searchOnly, results: [], searchURL: "u")
        let empty = group([], provider: "internet_archive")
        let found = group([appleTrack])

        #expect(
            FindRecordingsSheet.footer(unavailable)
                == "TIDAL isn't available right now. Try again in a few minutes.")
        #expect(FindRecordingsSheet.footer(empty) == "No results")
        #expect(FindRecordingsSheet.footer(found) == nil)
        #expect(FindRecordingsSheet.footer(searchOnly) == nil)
        #expect(FindRecordingsSheet.searchOn("Spotify") == "Search on Spotify")
        #expect(FindRecordingsSheet.searchService("TIDAL") == "Search TIDAL")
        #expect(FindRecordingsSheet.noResults == "No results")
        #expect(FindRecordingsSheet.back == "Back")
    }

    @Test func titlesTheListAndEachServicesResults() {
        #expect(FindRecordingsSheet.title(shown: nil) == "Find recordings")
        #expect(FindRecordingsSheet.title(shown: "tidal") == "TIDAL")
        #expect(FindRecordingsSheet.title(shown: "internet_archive") == "Internet Archive")
    }

    @Test(arguments: [
        (RecordingSearchOutcome.offline, "Search needs a connection"),
        (.rateLimited(retryAfter: 60), "Too many searches. Try again in 60 seconds."),
        (.rateLimited(retryAfter: 7), "Too many searches. Try again in 7 seconds."),
        (.rateLimited(retryAfter: 1), "Too many searches. Try again in 1 second."),
        (.rateLimited(retryAfter: 0), "Too many searches. Try again in 1 second."),
        (.failed, "Couldn't search. Try again."),
    ])
    func saysWhyAWholeSearchFailed(outcome: RecordingSearchOutcome, message: String) async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = outcome
        let model = model(store, search: search)
        try await eventually { model.isLoaded }

        _ = await model.pick("tidal")
        #expect(model.failure == message)
        #expect(model.group == nil)
    }

    @Test func answersOfflineWithNoServerToAsk() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, search: nil)
        try await eventually { model.isLoaded }

        _ = await model.pick("tidal")
        #expect(model.failure == FindRecordingsModel.searchNeedsConnection)
    }

    @Test func saysNoServicesWithNoneSelected() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await setSearchProviders(store, [])
        let search = FakeSearch()
        let model = model(store, search: search)

        try await eventually { model.isLoaded }
        #expect(model.hasNoServices)
        await model.submit()
        #expect(search.calls.isEmpty)
        #expect(FindRecordingsSheet.noServices == "No services selected")
    }

    // MARK: Going back

    @Test func backReturnsToTheListKeepingTheText() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = .ok([group([appleTrack])])
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        model.setQuery("Tam Lin")
        _ = await model.pick("apple_music")
        model.play(appleTrack)

        model.back()

        #expect(model.shown == nil)
        #expect(model.query == "Tam Lin")
        #expect(model.group == nil)
        #expect(model.playing == nil)
    }

    @Test func ignoresAnAnswerThatArrivesAfterBack() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        let picking = Task { await model.pick("apple_music") }
        try await eventually { search.waitingCount == 1 }

        model.back()
        #expect(!model.isSearching)
        search.answer(0, with: .ok([group([appleTrack])]))
        _ = await picking.value

        #expect(model.shown == nil)
        #expect(model.group == nil)
        #expect(!model.isSearching)
    }

    @Test func ignoresASearchPageThatArrivesAfterTheSheetCloses() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        let picking = Task { await model.pick("spotify") }
        try await eventually { search.waitingCount == 1 }

        model.cancel()
        search.answer(
            0,
            with: .ok([SearchGroup(provider: "spotify", status: .searchOnly, results: [], searchURL: "https://s.test")])
        )
        #expect(await picking.value == nil)
    }

    // MARK: Opening on one service

    @Test func opensOnOneServiceAndSearchesItOnceWithNoListToGoBackTo() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await setSearchProviders(store, ["tidal"])
        let search = FakeSearch()
        let tidalGroup = group([], provider: "tidal")
        search.outcome = .ok([tidalGroup])
        let model = model(store, service: "tidal", search: search)
        #expect(model.shown == "tidal")
        #expect(model.isDirect)

        try await eventually { model.group == tidalGroup }
        #expect(search.calls == [.init(q: "Soldier's Joy Reel", providers: ["tidal"], country: "IE")])
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.count == 1)
    }

    @Test func typingBeforeTheTuneLoadsIsTheOpeningsSearch() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, service: "tidal", search: search)

        model.setQuery("Tam Lin")
        try await eventually { model.isLoaded }
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.query == "Tam Lin")
        #expect(search.calls.isEmpty)
    }

    @Test func aReturnBeforeTheTuneLoadsSearchesWhatWasTypedOnce() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, service: "tidal", search: search)

        model.setQuery("Tam Lin")
        await model.submit()
        try await eventually { search.calls.count == 1 }
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.map(\.q) == ["Tam Lin"])
    }

    @Test func searchesNothingOnOpeningForAMissingTune() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, tuneID: "no_such_tune", service: "tidal", search: search)

        try await eventually { model.isLoaded }
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.isEmpty)
        #expect(!model.isSearching)
    }

    @Test(arguments: [
        ([String](), FindRecordingsEntry.sheet(service: nil), "Find recordings…"),
        (["tidal"], .sheet(service: "tidal"), "Search TIDAL…"),
        (["apple_music"], .sheet(service: "apple_music"), "Search Apple Music…"),
        (["spotify"], .searchPage("spotify"), "Search Spotify…"),
        (["internet_archive", "youtube"], .sheet(service: nil), "Find recordings…"),
    ])
    func namesTheMenuItemForTheChosenServices(providers: [String], entry: FindRecordingsEntry, label: String) {
        #expect(FindRecordingsEntry(providers: providers) == entry)
        #expect(FindRecordingsEntry(providers: providers).label == label)
    }

    @Test func disablesOnlyASheetItemWithNoSheetToOpen() {
        #expect(FindRecordingsEntry.sheet(service: nil).isDisabled(sheetAvailable: false))
        #expect(!FindRecordingsEntry.sheet(service: nil).isDisabled(sheetAvailable: true))
        #expect(!FindRecordingsEntry.searchPage("spotify").isDisabled(sheetAvailable: false))
    }

    @Test func doesNothingOfflineWhenFindRecordingsIsChosen() async throws {
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: "t1")
        let search = FakeSearch()
        var sheets = 0
        var opened: [URL] = []
        for entry in [FindRecordingsEntry.sheet(service: nil), .searchPage("spotify")] {
            await model.chooseFindRecordings(
                entry, tuneID: "t1", query: "Tam Lin", offline: true, search: search.search,
                openSheet: { _, _ in sheets += 1 }, open: { opened.append($0) })
        }
        #expect(sheets == 0 && opened.isEmpty && search.calls.isEmpty)
        #expect(model.failure(at: .media) == nil)
    }

    @Test func reportsASearchPageFailureUnderTheMedia() async throws {
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: "t1")
        let search = FakeSearch()
        search.outcome = .failed
        var opened: [URL] = []
        await model.chooseFindRecordings(
            .searchPage("spotify"), tuneID: "t1", query: "Tam Lin", offline: false, search: search.search,
            openSheet: nil, open: { opened.append($0) })
        #expect(opened.isEmpty)
        #expect(model.failure(at: .media) == FindRecordingsModel.searchFailed)
    }

    @Test func opensTheSheetOrTheSearchPageWhenOnline() async throws {
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: "t1")
        let search = FakeSearch()
        search.outcome = .ok([
            SearchGroup(
                provider: "spotify", status: .searchOnly, results: [], searchURL: "https://open.spotify.com/search/x")
        ])
        var sheets: [String?] = []
        var opened: [URL] = []
        await model.chooseFindRecordings(
            .sheet(service: "tidal"), tuneID: "t1", query: "Tam Lin", offline: false, search: search.search,
            openSheet: { _, service in sheets.append(service) }, open: { opened.append($0) })
        await model.chooseFindRecordings(
            .searchPage("spotify"), tuneID: "t1", query: "Tam Lin", offline: false, search: search.search,
            openSheet: nil, open: { opened.append($0) })
        #expect(sheets == ["tidal"])
        #expect(opened == [URL(string: "https://open.spotify.com/search/x")!])
        #expect(model.failure(at: .media) == nil)
    }

    // MARK: Staleness

    @Test func ignoresAnEarlierSearchAnsweringAfterALaterOne() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        let first = Task { await model.pick("apple_music") }
        try await eventually { search.waitingCount == 1 }

        model.setQuery("Tam Lin")
        let second = Task { await model.submit() }
        try await eventually { search.waitingCount == 2 }
        search.answer(1, with: .ok([group([otherAppleTrack])]))
        await second.value
        search.answer(0, with: .ok([group([appleTrack])]))
        _ = await first.value

        #expect(model.group == group([otherAppleTrack]))
        #expect(!model.isSearching)
    }

    @Test func ignoresAnAnswerThatArrivesAfterTheSheetCloses() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, search: search)
        try await eventually { model.isLoaded }
        let picking = Task { await model.pick("apple_music") }
        try await eventually { search.waitingCount == 1 }

        model.cancel()
        search.answer(0, with: .ok([group([appleTrack])]))
        _ = await picking.value

        #expect(model.group == nil)
        #expect(model.failure == nil)
    }

    @Test func startsNoOpeningSearchOnceTheSheetHasClosed() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, service: "tidal", search: search)

        model.cancel()
        try await eventually { model.isLoaded }
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.isEmpty)
        #expect(!model.isSearching)
    }

    @Test func dropsAReturnPressedBeforeTheTuneLoadedOnceTheSheetHasClosed() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let model = model(store, service: "tidal", search: search)

        model.setQuery("Tam Lin")
        await model.submit()
        model.cancel()
        try await eventually { model.isLoaded }
        try await Task.sleep(for: .milliseconds(50))
        #expect(search.calls.isEmpty)
        #expect(!model.isSearching)
    }

    @Test func stopsShowingSearchingOnceTheSheetCloses() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, service: "tidal", search: search)
        try await eventually { model.isSearching && search.waitingCount == 1 }

        model.cancel()
        #expect(!model.isSearching)
        search.answer(0, with: .failed)
    }

    @Test func keepsALinkFailureBesideASearchInFlight() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.holds = true
        let model = model(store, tuneID: "no_such_tune", search: search)
        try await eventually { model.isLoaded }
        model.setQuery("Tam Lin")
        let searching = Task { await model.pick("apple_music") }
        try await eventually { model.isSearching && search.waitingCount == 1 }

        await model.link(appleTrack)

        #expect(model.isSearching)
        #expect(model.linkFailure != nil)
        search.answer(0, with: .failed)
        _ = await searching.value
        #expect(model.failure == FindRecordingsModel.searchFailed)
        #expect(model.linkFailure != nil)
    }

    @Test(arguments: [("es_419", "US"), ("zh_Hant_TW", "TW"), ("en_US", "US"), ("en_IE", "IE"), ("en", "US")])
    func searchesTheStorefrontOfTheLocalesRegion(identifier: String, country: String) {
        #expect(storefrontCountry(Locale(identifier: identifier)) == country)
    }

    // MARK: Playing

    @Test func playsOneRowAtATimeAndStopsTheAppsPlayer() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        search.outcome = .ok([group([appleTrack, otherAppleTrack])])
        var stops = 0
        let model = model(store, search: search, stopPlayer: { stops += 1 })
        try await eventually { model.isLoaded }
        _ = await model.pick("apple_music")

        model.play(appleTrack)
        #expect(model.playing == appleTrack.url)
        #expect(stops == 1)

        model.play(otherAppleTrack)
        #expect(model.playing == otherAppleTrack.url)
        #expect(stops == 2)

        // Play again on the open row folds it away.
        model.play(otherAppleTrack)
        #expect(model.playing == nil)
        #expect(stops == 2)
    }

    @Test func buildsEachRowsPlayerFromItsProviderRefAndURL() {
        #expect(FindRecordingsModel.embed(for: appleTrack)?.src.hasPrefix("https://embed.music.apple.com/") == true)
        #expect(FindRecordingsModel.embed(for: result("https://example.test/x", provider: "other")) == nil)
    }

    @Test func playsNothingForARowWithNoPlayer() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        var stops = 0
        let model = model(store, search: FakeSearch(), stopPlayer: { stops += 1 })

        model.play(result("https://example.test/x", provider: "other"))
        #expect(model.playing == nil)
        #expect(stops == 0)
    }

    // MARK: Linking

    @Test func linksAResultWithItsOwnFieldsAndKeepsItPlaying() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let search = FakeSearch()
        let tidal = result("https://tidal.com/browse/track/1", provider: "tidal", title: "Tam Lin")
        search.outcome = .ok([group([tidal], provider: "tidal")])
        let model = model(store, tuneID: elzicsFarewell.id, search: search)
        try await eventually { model.isLoaded }
        _ = await model.pick("tidal")
        model.play(tidal)

        await model.link(tidal)

        let row = try #require(try await links(store, tuneID: elzicsFarewell.id).first)
        #expect(row.url == tidal.url)
        #expect(row.provider == "tidal")
        #expect(row.providerRef == "track:1")
        #expect(row.title == "Tam Lin")
        #expect(row.artworkURL == tidal.artworkURL)
        #expect(model.linkedURLs.contains(tidal.url))
        #expect(model.playing == tidal.url)
    }

    @Test func linksOnceForADoubleTap() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, tuneID: elzicsFarewell.id, search: FakeSearch())
        try await eventually { model.isLoaded }

        async let first: Void = model.link(appleTrack)
        async let second: Void = model.link(appleTrack)
        _ = await (first, second)

        #expect(try await links(store, tuneID: elzicsFarewell.id).count == 1)
    }

    @Test func showsAResultAlreadyLinkedToTheTuneAsLinked() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let linked = SampleCatalog.links[0].url
        let model = model(store, search: FakeSearch())

        try await eventually { model.linkedURLs.contains(linked) }
        await model.link(result(linked, provider: "youtube"))
        #expect(try await links(store, tuneID: soldiersJoy.id).count == 2)
    }

    @Test func saysWhyALinkFailedAndLetsItBeTriedAgain() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = model(store, tuneID: "no_such_tune", search: FakeSearch())
        try await eventually { model.isLoaded }

        await model.link(appleTrack)

        #expect(model.linkFailure != nil)
        #expect(!model.linkedURLs.contains(appleTrack.url))
    }
}
