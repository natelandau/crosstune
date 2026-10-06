import CrosstuneStore
import CrosstuneTestSupport
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct StatusScopeTests {
    private let root = TemporaryRoot()

    private func loadedCatalog(_ filters: CatalogFilters? = nil) async throws -> (CrosstuneStore, CatalogModel) {
        let store = try await SampleCatalog.makeStore(root: root.url)
        if let filters { try await store.setMeta(.catalogFilters, to: filters.stored) }
        let catalog = CatalogModel(store: store)
        #expect(try await poll { catalog.results != nil && catalog.status == filters?.status })
        return (store, catalog)
    }

    private func storedFilters(_ store: CrosstuneStore) async throws -> CatalogFilters {
        CatalogFilters(stored: try await store.meta(.catalogFilters, as: JSONValue.self))
    }

    @Test func titleIsCatalogForAllAndTheLabelForAStatus() {
        #expect(StatusScope.title(nil) == Destination.catalog.title)
        #expect(StatusScope.title("learning") == "Learning")
        #expect(StatusScope.title("bogus") == "Unknown")
    }

    @Test func choicesLeadWithCatalogThenEachStatusWithCounts() {
        let counts = CatalogCounts(
            catalog: 84, byStatus: ["known": 40, "learning": 20, "want_to_learn": 24], recordings: 0)
        let choices = StatusScope.choices(counts)
        #expect(choices.map(\.status) == [nil, "known", "learning", "want_to_learn"])
        #expect(choices.map(\.label) == [Destination.catalog.title, "Known", "Learning", "Unknown"])
        #expect(choices.map(\.count) == [84, 40, 20, 24])
        #expect(Set(choices.map(\.id)).count == 4)
        #expect(StatusScope.choices(nil).map(\.count) == [nil, nil, nil, nil])
    }

    @Test func choosingAStatusKeepsTheOtherFilters() async throws {
        let (store, catalog) = try await loadedCatalog(CatalogFilters(facets: [.key: "D"]))
        catalog.query = "reel"

        StatusScope.choose("known", in: catalog)
        #expect(catalog.status == "known")
        #expect(try await poll { !catalog.isSavingFilters })
        #expect(try await storedFilters(store) == CatalogFilters(status: "known", facets: [.key: "D"]))
        #expect(catalog.query == "reel")

        StatusScope.choose(nil, in: catalog)
        #expect(try await poll { !catalog.isSavingFilters })
        #expect(try await storedFilters(store) == CatalogFilters(facets: [.key: "D"]))
    }

    @Test func choosingTheStatusInForceWritesNothing() async throws {
        let (_, catalog) = try await loadedCatalog(CatalogFilters(status: "learning"))
        StatusScope.choose("learning", in: catalog)
        #expect(!catalog.isSavingFilters)
    }

    @Test func aStatusSetElsewhereIsTheTitle() async throws {
        let (_, catalog) = try await loadedCatalog()
        catalog.updateFilters { $0.status = "known" }
        #expect(StatusScope.title(catalog.status) == "Known")
    }
}
