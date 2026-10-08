import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Testing

@testable import CrosstuneUI

/// The catalog reports a search once it has settled and is done with, never per keystroke, and a
/// filter once its write lands, by kind alone.
@MainActor
@Suite struct CatalogEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func loadedCatalog(settleDelay: Duration = .zero) async throws -> (CrosstuneStore, CatalogModel) {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let catalog = CatalogModel(store: store, analytics: sink.client, searchSettleDelay: settleDelay)
        #expect(try await poll { catalog.results != nil })
        return (store, catalog)
    }

    private func searched(_ count: String, tookOffer: Bool = false) -> RecordingAnalyticsSink.Capture {
        .init(
            name: "search_performed",
            properties: ["result_count_bucket": .string(count), "took_offer": .bool(tookOffer)])
    }

    /// Types `text` a keystroke at a time and waits until it has settled.
    private func type(_ text: String, into catalog: CatalogModel) async throws {
        for end in text.indices { catalog.query = String(text[...end]) }
        #expect(try await poll { catalog.settledSearch?.query == text })
    }

    @Test func reportsNothingUntilASearchHasSettledAndIsDone() async throws {
        let (_, catalog) = try await loadedCatalog(settleDelay: .seconds(60))
        for typed in ["f", "fa", "far", "fare", "farewell"] { catalog.query = typed }

        #expect(catalog.settledSearch == nil)
        #expect(sink.calls.isEmpty)
    }

    @Test func reportsASearchLeftInPlaceWhenAResultIsOpened() async throws {
        let (_, catalog) = try await loadedCatalog()
        try await type("farewell", into: catalog)
        #expect(sink.calls.isEmpty)

        catalog.searchResultOpened()
        catalog.searchResultOpened()

        #expect(sink.captures == [searched("1-9")])
        #expect(catalog.query == "farewell", "opening a result leaves the search in place")
    }

    @Test func reportsAReplacedSearchAsTwo() async throws {
        let (_, catalog) = try await loadedCatalog()
        try await type("farewell", into: catalog)

        // Select all and type over it: the query never goes blank between the two.
        try await type("rove riley", into: catalog)
        catalog.query = ""

        #expect(sink.captures == [searched("1-9"), searched("0")])
    }

    @Test func reportsASettledSearchAsTheAppLeavesTheForeground() async throws {
        let (_, catalog) = try await loadedCatalog()
        try await type("farewell", into: catalog)

        catalog.leftForeground()
        catalog.leftForeground()

        #expect(sink.captures == [searched("1-9")])
    }

    @Test func reportsTheCountTheSearchSettledOn() async throws {
        let (store, catalog) = try await loadedCatalog()
        try await type("farewell", into: catalog)
        try await store.setMeta(.catalogFilters, to: CatalogFilters(status: "known").stored)
        #expect(try await poll { catalog.status == "known" })

        catalog.query = ""

        #expect(sink.captures == [searched("1-9")])
    }

    @Test func reportsTheOfferTakenWhenASearchEndsInANewTune() async throws {
        let (_, catalog) = try await loadedCatalog(settleDelay: .seconds(60))
        catalog.query = "Rove Riley"

        _ = catalog.newTune(title: "Rove Riley")

        #expect(sink.captures == [searched("0", tookOffer: true)])
    }

    @Test func reportsNoSearchForWhitespaceOrANewTuneWithoutOne() async throws {
        let (_, catalog) = try await loadedCatalog()
        catalog.query = "   "
        catalog.query = ""
        catalog.query = "  "
        catalog.leftForeground()
        catalog.searchResultOpened()
        _ = catalog.newTune()

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsEachFilterAppliedByKindOnceItsWriteLands() async throws {
        let (_, catalog) = try await loadedCatalog()

        catalog.updateFilters {
            $0.status = "learning"
            $0[.tuning("violin")] = "AEAE"
            $0[.tuning("five_string_banjo")] = "gDGBD"
            $0.unheard = true
        }

        #expect(try await poll { !catalog.isSavingFilters })
        #expect(
            sink.captures == [
                .init(name: "catalog_filtered", properties: ["filter": .string("status")]),
                .init(name: "catalog_filtered", properties: ["filter": .string("tuning")]),
                .init(name: "catalog_filtered", properties: ["filter": .string("unheard")]),
            ])
    }

    @Test func reportsNoFilterForOneCleared() async throws {
        let (store, catalog) = try await loadedCatalog()
        try await store.setMeta(.catalogFilters, to: CatalogFilters(status: "known").stored)
        #expect(try await poll { catalog.status == "known" })

        catalog.updateFilters { $0.status = nil }

        #expect(try await poll { !catalog.isSavingFilters })
        #expect(sink.calls.isEmpty)
    }

    @Test func reportsAFilterSetFromAnotherScreen() async throws {
        let (_, catalog) = try await loadedCatalog()

        catalog.replaceFilters(with: CatalogFilters(facets: [.genre: "Irish"]))

        #expect(try await poll { !catalog.isSavingFilters })
        #expect(sink.captures == [.init(name: "catalog_filtered", properties: ["filter": .string("genre")])])
    }

    @Test func sortingTheCatalogReportsTheSort() async throws {
        let (_, catalog) = try await loadedCatalog()

        catalog.reportSort(CatalogSortChoice(sort: .played, descending: true))
        catalog.reportSort(CatalogSortChoice(sort: .added, descending: false))

        #expect(
            sink.captures == [
                .init(name: "catalog_sorted", properties: ["sort": .string("played")]),
                .init(name: "catalog_sorted", properties: ["sort": .string("added")]),
            ])
    }

    @Test func copyingASortFromAnotherWindowReportsNothing() async throws {
        let (_, catalog) = try await loadedCatalog()

        catalog.sort = CatalogSortChoice(sort: .added, descending: true)

        #expect(sink.calls.isEmpty)
    }

    @Test func archivingARowReportsTheTune() async throws {
        let (_, catalog) = try await loadedCatalog()
        let entry = try #require(catalog.results?.visible.first)

        await catalog.setArchived(entry, archived: true)
        await catalog.setArchived(entry, archived: false)

        #expect(
            sink.captures == [
                .init(name: "tune_archived", properties: ["tune_id": .string(entry.tune.id)]),
                .init(name: "tune_unarchived", properties: ["tune_id": .string(entry.tune.id)]),
            ])
    }
}
