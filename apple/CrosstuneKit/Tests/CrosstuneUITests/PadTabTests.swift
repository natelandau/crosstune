import CrosstuneStore
import CrosstuneTestSupport
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PadTabTests {
    private let root = TemporaryRoot()

    private func loadedCatalog(status: String? = nil) async throws -> CatalogModel {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let filters = CatalogFilters(status: status)
        if status != nil { try await store.setMeta(.catalogFilters, to: filters.stored) }
        let catalog = CatalogModel(store: store)
        #expect(try await poll { catalog.results != nil && catalog.status == status })
        return catalog
    }

    @Test func sidebarShowsTheStatusRowForASetStatus() {
        let place = ShellPlace()
        place.tab = .catalog
        #expect(PadTab.selected(place: place, status: "learning", inSidebar: true) == .status("learning"))
        #expect(PadTab.selected(place: place, status: nil, inSidebar: true) == .destination(.catalog))
    }

    @Test func topBarShowsCatalogWhateverTheStatus() {
        let place = ShellPlace()
        place.tab = .catalog
        #expect(PadTab.selected(place: place, status: "learning", inSidebar: false) == .destination(.catalog))
    }

    @Test func sidebarShowsAnOpenListAsItsRow() {
        let place = ShellPlace()
        place.tab = .lists
        place.tabList = "l1"
        #expect(PadTab.selected(place: place, status: nil, inSidebar: true) == .list(id: "l1"))
        #expect(PadTab.selected(place: place, status: nil, inSidebar: false) == .destination(.lists))
    }

    @Test func choosingAStatusRowSetsTheFilterAndTheCatalogTab() async throws {
        let catalog = try await loadedCatalog()
        let place = ShellPlace()
        place.tab = .recordings
        PadTab.choose(.status("known"), place: place, catalog: catalog, inSidebar: true)
        #expect(place.tab == .catalog)
        #expect(catalog.status == "known")
        #expect(try await poll { !catalog.isSavingFilters })
    }

    @Test func choosingCatalogInTheSidebarClearsTheStatus() async throws {
        let catalog = try await loadedCatalog(status: "known")
        let place = ShellPlace()
        place.tab = .recordings
        PadTab.choose(.destination(.catalog), place: place, catalog: catalog, inSidebar: true)
        #expect(place.tab == .catalog)
        #expect(catalog.status == nil)
        #expect(try await poll { !catalog.isSavingFilters })
    }

    @Test func catalogTabInTheTopBarKeepsTheStatus() async throws {
        let catalog = try await loadedCatalog(status: "known")
        let place = ShellPlace()
        place.tab = .recordings
        PadTab.choose(.destination(.catalog), place: place, catalog: catalog, inSidebar: false)
        #expect(place.tab == .catalog)
        #expect(catalog.status == "known")
    }

    @Test func choosingAListRowOpensItOnTheListsStack() {
        let place = ShellPlace()
        place.tab = .catalog
        PadTab.choose(.list(id: "l1"), place: place, catalog: nil, inSidebar: true)
        #expect(place.tab == .lists)
        #expect(place.tabList == "l1")
    }

    @Test func choosingListsKeepsTheOpenList() {
        let place = ShellPlace()
        place.tab = .catalog
        place.tabList = "l1"
        PadTab.choose(.destination(.lists), place: place, catalog: nil, inSidebar: true)
        #expect(place.tab == .lists)
        #expect(place.tabList == "l1")
    }

    @Test func sidebarShowsListsWithNoListOpen() {
        let place = ShellPlace()
        place.tab = .lists
        #expect(PadTab.selected(place: place, status: nil, inSidebar: true) == .destination(.lists))
    }

    @Test func aStatusChoiceKeepsEachTabsTune() async throws {
        let catalog = try await loadedCatalog()
        let place = ShellPlace()
        place.tabTunes = [.catalog: "t1", .lists: "t2"]
        PadTab.choose(.status("known"), place: place, catalog: catalog, inSidebar: true)
        #expect(place.tabTunes == [.catalog: "t1", .lists: "t2"])
        #expect(try await poll { !catalog.isSavingFilters })
    }

    @Test func aNewStatusDropsTheCatalogsScrollPlace() async throws {
        let catalog = try await loadedCatalog(status: "known")
        let place = ShellPlace()
        place.scrollAnchors = [.catalog: "ut-3", .lists: "item-2"]
        PadTab.choose(.status("known"), place: place, catalog: catalog, inSidebar: true)
        #expect(place.scrollAnchors[.catalog] == "ut-3")
        PadTab.choose(.status("learning"), place: place, catalog: catalog, inSidebar: true)
        #expect(place.scrollAnchors == [.lists: "item-2"])
        place.scrollAnchors[.catalog] = "ut-4"
        PadTab.choose(.destination(.catalog), place: place, catalog: catalog, inSidebar: true)
        #expect(place.scrollAnchors[.catalog] == nil)
        #expect(try await poll { !catalog.isSavingFilters })
    }

    @Test func aDeletedListClosesOnceTheListsHaveRead() {
        let place = ShellPlace()
        place.tabList = "l1"
        PadTab.closeDeletedList(place: place, lists: nil)
        #expect(place.tabList == "l1")
        PadTab.closeDeletedList(place: place, lists: ["l1", "l2"])
        #expect(place.tabList == "l1")
        PadTab.closeDeletedList(place: place, lists: ["l2"])
        #expect(place.tabList == nil)
    }

    @Test func aTunePagesListOpensOnTheListsTab() {
        let place = ShellPlace()
        place.tab = .catalog
        #expect(PadTab.openList(place: place) == .catalog)
        PadTab.openList(.recordings, place: place)
        #expect(place.tab == .catalog)
        PadTab.openList(.list(id: "l1"), place: place)
        #expect(place.tab == .lists)
        #expect(place.tabList == "l1")
        #expect(PadTab.openList(place: place) == .list(id: "l1"))
    }
}
