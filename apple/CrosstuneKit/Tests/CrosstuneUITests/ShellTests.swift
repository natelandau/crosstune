import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct SyncBadgeTests {
    @Test func showsOnlyTheStatesThatNeedAttention() {
        let shown = SyncStatus.allCases.map { SyncBadge.attention(status: $0, isOffline: false, needsSignIn: false) }
        #expect(shown == [nil, nil, .offline, .unauthorized, .error])
        #expect(SyncBadge.attention(status: nil, isOffline: false, needsSignIn: false) == nil)
    }

    @Test func offlineWinsOverTheLastRun() {
        #expect(SyncBadge.attention(status: .error, isOffline: true, needsSignIn: true) == .offline)
        #expect(SyncBadge.attention(status: nil, isOffline: true, needsSignIn: false) == .offline)
    }

    @Test func aRefusedSessionAsksForSignInWhateverTheLastRunSaid() {
        #expect(SyncBadge.attention(status: .idle, isOffline: false, needsSignIn: true) == .unauthorized)
    }

    @Test func everyBadgeReadsAtLeastFourAndAHalfToOne() {
        for scheme in [ColorScheme.light, .dark] {
            for status in [SyncStatus.offline, .unauthorized, .error] {
                let swatch = SyncBadge.swatch(status, scheme: scheme)
                #expect(contrastRatio(swatch.ink, swatch.background) >= 4.5, "\(status) \(scheme)")
            }
        }
    }

    @Test func labelsAreTheWebs() {
        #expect(
            [SyncStatus.offline, .unauthorized, .error].map(\.label) == ["Offline", "Sign in again", "Sync failed"])
    }
}

@Suite struct AppearanceTests {
    @Test func systemFollowsTheDeviceAndTheOthersForceAScheme() {
        #expect(Appearance.system.colorScheme == nil)
        #expect(Appearance.light.colorScheme == .light)
        #expect(Appearance.dark.colorScheme == .dark)
    }

    @Test func storesTheWebsValuesUnderTheWebsKey() {
        #expect(Appearance.allCases.map(\.rawValue) == ["system", "light", "dark"])
        #expect(Appearance.allCases.map(\.label) == ["System", "Light", "Dark"])
        #expect(Appearance.storageKey == "crosstune.appearance")
        #expect(Appearance(rawValue: "sepia") == nil)
    }
}

@Suite struct TextSizeTests {
    @Test func bodySizesFollowApplesTable() {
        #expect(
            DynamicTypeSize.allCases.map(TextSize.bodyPointSize) == [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53])
    }

    @Test func shiftsByWholeStepsAndClampsAtBothEnds() {
        #expect(TextSize.applied(system: .large, offset: 0) == .large)
        #expect(TextSize.applied(system: .large, offset: -2) == .small)
        #expect(TextSize.applied(system: .large, offset: 3) == .xxxLarge)
        #expect(TextSize.applied(system: .small, offset: -5) == .xSmall)
        #expect(TextSize.applied(system: .accessibility4, offset: 4) == .accessibility5)
    }

    @Test func theRangeIsWhatTheSystemSizeLeaves() {
        #expect(TextSize.offsetRange(system: .large) == -3...8)
        #expect(TextSize.offsetRange(system: .xSmall) == 0...11)
        #expect(TextSize.offsetRange(system: .accessibility5) == -11...0)
    }

    @Test func readsSystemAtZeroAndAPercentElsewhere() {
        #expect(TextSize.valueLabel(system: .large, offset: 0) == "System")
        #expect(TextSize.valueLabel(system: .large, offset: -2) == "88%")
        #expect(TextSize.valueLabel(system: .large, offset: 1) == "112%")
        // A stored shift the system size has since used up still names what applies.
        #expect(TextSize.valueLabel(system: .xSmall, offset: -2) == "System")
    }

    @Test func aStoredWordReadsAsNoShift() throws {
        let suite = TemporaryDefaults("TextSizeTests")
        let defaults = suite.defaults
        defaults.set("compact", forKey: TextSize.storageKey)
        // Read the way the root and Settings read it.
        let offset = AppStorage(wrappedValue: 0, TextSize.storageKey, store: defaults)
        #expect(offset.wrappedValue == 0)
        #expect(TextSize.storageKey == "crosstune.textSize")
    }
}

@Suite struct TabSlotTests {
    @Test @MainActor func theRecordSlotStandsDownOnlyWhileTheShellIsCovered() {
        #expect(TabSlot.recordIsEnabled(cover: nil))
        let cover = ShellCover()
        #expect(TabSlot.recordIsEnabled(cover: cover))
        cover.claim()
        #expect(!TabSlot.recordIsEnabled(cover: cover))
        cover.release()
        #expect(TabSlot.recordIsEnabled(cover: cover))
    }

    @Test func choosingTheRecordSlotRecordsAndKeepsTheTab() {
        #expect(TabSlot.record.resolved(current: .lists) == (.lists, true))
        #expect(TabSlot.destination(.settings).resolved(current: .lists) == (.settings, false))
    }
}

@Suite struct SidebarTests {
    private let root = TemporaryRoot()

    #if os(macOS)
        @Test func listsLiveListsInTheirOrder() async throws {
            let store = try await SampleCatalog.makeStore(root: root.url)
            let commands = Commands(store: store)
            let late = try await commands.createList("Late set")
            try await commands.deleteList(SampleCatalog.lists[0].id)

            let names = try await store.read { try SplitShell.sidebarLists($0).map(\.name) }
            #expect(names == ["Waltzes", "Late set"])
            #expect(try await store.read { try SplitShell.sidebarLists($0).last?.id } == late)
        }
    #endif

    @Test func aDeletedListsSelectionFallsBackToTheCatalog() {
        let lists = SampleCatalog.lists
        #expect(SidebarItem.list(id: lists[1].id).kept(among: lists) == .list(id: lists[1].id))
        #expect(SidebarItem.list(id: "gone").kept(among: lists) == .catalog)
        #expect(SidebarItem.recordings.kept(among: []) == .recordings)
    }

    @Test func eachRowButAListOpensItsDestination() {
        #expect(SidebarItem.catalog.destination == .catalog)
        #expect(SidebarItem.recordings.destination == .recordings)
        #expect(SidebarItem.list(id: "a").destination == nil)
    }

    @Test func statusRowMapping() {
        #expect(SidebarItem.catalogRow(status: nil) == .catalog)
        #expect(SidebarItem.catalogRow(status: "learning") == .status("learning"))
        #expect(SidebarItem.status("known").destination == .catalog)
        #expect(SidebarItem.catalog.statusFilter == .some(nil))
        #expect(SidebarItem.status("known").statusFilter == .some("known"))
        #expect(SidebarItem.recordings.statusFilter == nil)
        #expect(SidebarItem.list(id: "a").statusFilter == nil)
        #expect(SidebarItem.status("known").kept(among: []) == .status("known"))
    }
}

#if os(macOS)
    @MainActor
    @Suite struct SidebarSyncTests {
        private let root = TemporaryRoot()

        private func eventually(_ condition: @MainActor () -> Bool) async throws {
            #expect(try await poll { condition() })
        }

        private func storedFilters(_ store: CrosstuneStore) async throws -> CatalogFilters {
            CatalogFilters(stored: try await store.meta(.catalogFilters, as: JSONValue.self))
        }

        /// A catalog on the sample store, loaded, with `filters` stored first.
        private func loadedCatalog(_ filters: CatalogFilters? = nil) async throws -> (CrosstuneStore, CatalogModel) {
            let store = try await SampleCatalog.makeStore(root: root.url)
            if let filters { try await store.setMeta(.catalogFilters, to: filters.stored) }
            let catalog = CatalogModel(store: store)
            try await eventually { catalog.results != nil && catalog.status == filters?.status }
            return (store, catalog)
        }

        @Test func pickingAStatusRowSetsTheStatusAndKeepsTheOtherFilters() async throws {
            let (store, catalog) = try await loadedCatalog(CatalogFilters(facets: [.key: "D"]))
            catalog.query = "reel"
            let place = ShellPlace()

            pickSidebarRow(.status("known"), place: place, catalog: catalog)
            #expect(place.sidebar == .status("known"))
            #expect(catalog.status == "known")
            try await eventually { !catalog.isSavingFilters }
            #expect(try await storedFilters(store) == CatalogFilters(status: "known", facets: [.key: "D"]))
            #expect(catalog.query == "reel")

            pickSidebarRow(.catalog, place: place, catalog: catalog)
            #expect(place.sidebar == .catalog)
            try await eventually { !catalog.isSavingFilters }
            #expect(try await storedFilters(store) == CatalogFilters(facets: [.key: "D"]))
        }

        @Test func pickingAnotherRowLeavesTheStatusAlone() async throws {
            let (store, catalog) = try await loadedCatalog(CatalogFilters(status: "learning"))
            let place = ShellPlace()
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .status("learning"))

            pickSidebarRow(.recordings, place: place, catalog: catalog)
            #expect(place.sidebar == .recordings)
            #expect(catalog.status == "learning")
            #expect(!catalog.isSavingFilters)
            #expect(try await storedFilters(store).status == "learning")
        }

        @Test func returningToCatalogKeepsStoredStatus() async throws {
            let (store, catalog) = try await loadedCatalog(CatalogFilters(status: "learning"))
            let place = ShellPlace()
            place.sidebar = .recordings
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .recordings)

            place.showSidebarRoot(.catalog)
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .status("learning"))
            #expect(!catalog.isSavingFilters)
            #expect(try await storedFilters(store).status == "learning")
        }

        @Test func statsLinkClearsStatusRow() async throws {
            let (_, catalog) = try await loadedCatalog()
            let place = ShellPlace()
            pickSidebarRow(.status("known"), place: place, catalog: catalog)
            #expect(place.sidebar == .status("known"))

            catalog.replaceFilters(with: CatalogFilters(facets: [.key: "D"]))
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .catalog)
        }

        @Test func aStatusSetElsewhereSelectsItsRow() async throws {
            let (store, catalog) = try await loadedCatalog()
            let place = ShellPlace()
            try await store.setMeta(.catalogFilters, to: CatalogFilters(status: "want_to_learn").stored)
            try await eventually { catalog.status == "want_to_learn" }
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .status("want_to_learn"))
        }

        @Test func failedWriteFollowsFiltersInForce() async throws {
            let (store, catalog) = try await loadedCatalog(CatalogFilters(status: "learning"))
            try await store.write { writer in
                for event in ["INSERT", "UPDATE"] {
                    try writer.db.execute(
                        sql: """
                            CREATE TRIGGER refuse_filters_\(event.lowercased()) BEFORE \(event) ON meta
                            WHEN NEW.key = 'catalog_filters' BEGIN SELECT RAISE(ABORT, 'refused'); END
                            """)
                }
            }
            let place = ShellPlace()

            pickSidebarRow(.status("known"), place: place, catalog: catalog)
            try await eventually { catalog.filterError != nil }
            #expect(catalog.status == "learning")
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .status("learning"))
        }

        @Test func aCatalogWhoseFiltersAreUnreadLeavesTheCatalogRowAndWritesNothing() async throws {
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await store.setMeta(.catalogFilters, to: CatalogFilters(status: "learning").stored)
            let catalog = CatalogModel(store: store)
            #expect(catalog.status == nil)
            let place = ShellPlace()

            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .catalog)
            #expect(!catalog.isSavingFilters)

            try await eventually { catalog.status == "learning" }
            #expect(try await storedFilters(store) == CatalogFilters(status: "learning"))
            syncSidebar(place: place, catalog: catalog)
            #expect(place.sidebar == .status("learning"))
        }

        @Test func aCatalogStillLoadingLeavesTheCatalogRow() {
            let place = ShellPlace()
            place.sidebar = .status("known")
            syncSidebar(place: place, catalog: nil)
            #expect(place.sidebar == .catalog)
        }
    }
#endif

@MainActor
@Suite struct ShellCoverTests {
    @Test func staysCoveredUntilEveryClaimIsReleased() {
        let cover = ShellCover()
        #expect(!cover.isCovered)
        cover.claim()
        cover.claim()
        cover.release()
        #expect(cover.isCovered)
        cover.release()
        #expect(!cover.isCovered)
    }

    @Test func anExtraReleaseNeverUncoversALaterClaim() {
        let cover = ShellCover()
        cover.release()
        cover.claim()
        #expect(cover.isCovered)
    }
}

@Suite struct CoverClaimTests {
    @Test func claimsOnlyWhileShownAndCovering() {
        var claim = CoverClaim(isCovering: true)
        #expect(claim.update(isShown: true) == .claim)
        #expect(claim.update(isShown: true) == nil)
        #expect(claim.update(isShown: false) == .release)
        #expect(claim.update(isShown: false) == nil)
    }

    @Test func followsTheWishToCoverWhileShown() {
        var claim = CoverClaim(isCovering: false)
        #expect(claim.update(isShown: true) == nil)
        #expect(claim.update(isCovering: true) == .claim)
        #expect(claim.update(isCovering: false) == .release)
    }

    @Test func disappearingWhileNotCoveringGivesNothingBack() {
        var claim = CoverClaim(isCovering: false)
        _ = claim.update(isShown: true)
        #expect(claim.update(isShown: false) == nil)
        #expect(claim.update(isCovering: true) == nil)
        #expect(claim.update(isShown: true) == .claim)
    }
}

@Suite struct MenuGateTests {
    @Test func newTuneStandsDownUnderASheetOrWhileSelecting() {
        #expect(MenuGates.newTune(sheetsOpen: false, selecting: false))
        #expect(!MenuGates.newTune(sheetsOpen: true, selecting: false))
        #expect(!MenuGates.newTune(sheetsOpen: false, selecting: true))
    }

    @Test func newListStandsDownUnderASheet() {
        #expect(MenuGates.newList(sheetsOpen: false))
        #expect(!MenuGates.newList(sheetsOpen: true))
    }

    @Test func findActsOnlyForAScreenOnShowWithNoSheetUp() {
        #expect(MenuGates.find(isShown: true, sheetsOpen: false))
        #expect(!MenuGates.find(isShown: false, sheetsOpen: false))
        #expect(!MenuGates.find(isShown: true, sheetsOpen: true))
    }

    @Test func sortByActsOnlyWhileTheRecordingsShowWithNoSheetUp() {
        #expect(MenuGates.sort(isShown: true, sheetsOpen: false))
        #expect(!MenuGates.sort(isShown: false, sheetsOpen: false))
        #expect(!MenuGates.sort(isShown: true, sheetsOpen: true))
    }

    @Test func sortByStandsDownWhileTheScreenSelects() {
        #expect(!MenuGates.sort(isShown: true, sheetsOpen: false, selecting: true))
        #expect(MenuGates.sort(isShown: true, sheetsOpen: false, selecting: false))
    }

    @Test func sortByOffersEveryRecordingSort() {
        #expect(MenuCommand.sortBy == "Sort By")
        #expect(
            SortChoices<RecordingSort>.items(for: .default).map(\.label) == [
                "Date added", "Date recorded", "Title", "Tune",
            ])
    }

    @Test func recordStandsDownUnderASheetWhileSelectingOrForAPendingTakeOrACapture() {
        #expect(MenuGates.record(sheetsOpen: false, selecting: false, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: true, selecting: false, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: true, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: false, takePending: true, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: false, takePending: false, capturing: true))
    }

    @Test func controlsStandDownUnderASheet() {
        #expect(MenuGates.controls(sheetsOpen: false))
        #expect(!MenuGates.controls(sheetsOpen: true))
    }
}

@MainActor
@Suite struct NewTuneContextTests {
    @Test func theLatestScreenOnShowDecidesWhereANewTuneGoes() {
        let contexts = NewTuneContexts()
        #expect(contexts.current == nil)
        let catalog = UUID()
        let list = UUID()
        contexts.register(NewTuneContextBox(), id: catalog)
        // The list arrives before the catalog it replaces has left.
        let box = NewTuneContextBox(NewTuneContext(listID: "list"))
        contexts.register(box, id: list)
        contexts.unregister(catalog)
        #expect(contexts.current?.listID == "list")
        // A screen that redraws with a new context is read afresh.
        box.context = NewTuneContext(listID: "renamed")
        #expect(contexts.current?.listID == "renamed")
        contexts.unregister(list)
        #expect(contexts.current == nil)
    }
}

@MainActor
@Suite struct ShellPlaceTests {
    @Test func aTunePushedOverOneListLeavesWithIt() {
        let place = ShellPlace()
        place.tabList = "list-1"
        place.tabTunes = [.lists: "tune-1", .catalog: "tune-2"]
        place.tabList = "list-2"
        #expect(place.tabTunes == [.catalog: "tune-2"])
    }

    @Test func aPlaceScrolledToInOneListLeavesWithIt() {
        let place = ShellPlace()
        place.tabList = "list-1"
        place.scrollAnchors = [.lists: "item-3", .catalog: "ut-2"]
        place.tabList = "list-1"
        #expect(place.scrollAnchors[.lists] == "item-3")
        place.tabList = "list-2"
        #expect(place.scrollAnchors == [.catalog: "ut-2"])
    }

    @Test func theListsStackIsTheOpenList() {
        let place = ShellPlace()
        #expect(place.listPath.isEmpty)
        place.listPath = [ListRoute(id: "list-1")]
        #expect(place.tabList == "list-1")
        place.listPath = []
        #expect(place.tabList == nil)
    }

    @Test func aTabRootClosesWhatTheTabHasOpen() {
        let place = ShellPlace()
        place.tab = .catalog
        place.tabList = "l1"
        place.tabTunes[.lists] = "t1"
        place.showTabRoot(.lists)
        #expect(place.tab == .lists)
        #expect(place.tabList == nil)
        #expect(place.tabTunes[.lists] == nil)
        place.settingsPage = .stats
        place.showTabRoot(.settings)
        #expect(place.settingsPage == nil)
    }

    @Test func theMacSidebarFallsBackToTheCatalogWithNoRowOfItsOwn() {
        let place = ShellPlace()
        for destination in [Destination.settings, .lists] {
            place.sidebar = .recordings
            place.showSidebarRoot(destination)
            #expect(place.sidebar == .catalog)
        }
        place.showSidebarRoot(.recordings)
        #expect(place.sidebar == .recordings)
    }
}

@MainActor
@Suite struct PadShellTests {
    @Test func bothFormsShowTheSameListTuneAndScrollPlace() {
        // Both iOS shells read the same tab fields, so nothing converts on a size or form change.
        let place = ShellPlace()
        place.tab = .lists
        place.tabList = "l1"
        place.tabTunes[.lists] = "t1"
        place.scrollAnchors[.lists] = "item-3"
        #expect(PadTab.selected(place: place, status: nil, inSidebar: true) == .list(id: "l1"))
        #expect(PadTab.selected(place: place, status: nil, inSidebar: false) == .destination(.lists))
        // Choosing the top-level tab, as the top bar does, keeps the open list's tune and place.
        PadTab.choose(.destination(.lists), place: place, catalog: nil, inSidebar: false)
        #expect(place.tabTunes[.lists] == "t1")
        #expect(place.scrollAnchors[.lists] == "item-3")
    }

    @Test func settingsDetailNamesNoSetting() { #expect(SettingsDetailPlaceholder.title == "No setting selected") }
}
