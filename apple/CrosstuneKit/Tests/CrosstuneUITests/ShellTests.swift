import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct SyncBadgeTests {
    @Test func showsOnlyTheStatesThatNeedAttention() {
        let shown = SyncStatus.allCases.map {
            SyncBadge.attention(status: $0, isOffline: false, needsSignIn: false, updateRequired: false)
        }
        #expect(shown == [nil, nil, .offline, .unauthorized, .error, .updateRequired])
        #expect(SyncBadge.attention(status: nil, isOffline: false, needsSignIn: false, updateRequired: false) == nil)
    }

    @Test func offlineWinsOverTheLastRun() {
        #expect(
            SyncBadge.attention(status: .error, isOffline: true, needsSignIn: true, updateRequired: false) == .offline)
        #expect(
            SyncBadge.attention(status: nil, isOffline: true, needsSignIn: false, updateRequired: false) == .offline)
    }

    @Test func aRefusedSessionAsksForSignInWhateverTheLastRunSaid() {
        #expect(
            SyncBadge.attention(status: .idle, isOffline: false, needsSignIn: true, updateRequired: false)
                == .unauthorized)
    }

    @Test func updateRequiredOutranksEveryOtherAttention() {
        #expect(
            SyncBadge.attention(status: .error, isOffline: true, needsSignIn: true, updateRequired: true)
                == .updateRequired)
        #expect(SyncStatus.updateRequired.label == SyncStatus.updateRequiredLabel)
        #expect(SyncStatus.updateRequiredLabel == "Update required")
    }

    @Test func updateRequiredIsAWarning() {
        #expect(SyncBadge.tone(.updateRequired) == SyncBadge.tone(.offline))
    }

    @Test func everyBadgeReadsAtLeastFourAndAHalfToOne() {
        for scheme in [ColorScheme.light, .dark] {
            for status in [SyncStatus.offline, .unauthorized, .error, .updateRequired] {
                let text = Palette.hex(SyncBadge.tone(status), scheme)
                let fill = blend(text, over: Palette.hex(.pageBackground, scheme), opacity: Palette.subtleOpacity)
                #expect(contrastRatio(text, fill) >= 4.5, "\(status) \(scheme)")
            }
        }
    }

    @Test func labelsAreTheWebs() {
        #expect(
            [SyncStatus.offline, .unauthorized, .error].map(\.label) == ["Offline", "Sign in again", "Sync failed"])
    }
}

@Suite struct UpdatePromptTests {
    @Test func appStoreURLForEachPlatform() {
        #expect(UpdatePromptText.appStoreURL(id: nil) == nil)
        #expect(UpdatePromptText.appStoreURL(id: "") == nil)
        #if os(macOS)
            #expect(
                UpdatePromptText.appStoreURL(id: "123")?.absoluteString == "macappstore://apps.apple.com/app/id123")
        #else
            #expect(UpdatePromptText.appStoreURL(id: "123")?.absoluteString == "https://apps.apple.com/app/id123")
        #endif
    }
}

@MainActor
@Suite struct UpdatePromptClaimTests {
    /// Held for the whole test, so no two windows ever share an identifier.
    private let windows = (0..<2).map { _ in Window() }
    private final class Window {}

    private func window(_ index: Int) -> ObjectIdentifier { ObjectIdentifier(windows[index]) }

    @Test func onlyOneWindowShowsADuePrompt() {
        let claim = UpdatePromptClaim()
        let first = window(0)
        let second = window(1)

        #expect(claim.shows(first, due: true, isActive: true))
        #expect(!claim.shows(second, due: true, isActive: true))
        #expect(claim.shows(first, due: true, isActive: true))
    }

    @Test func aBackgroundWindowYieldsThePromptToAnActiveOne() {
        let claim = UpdatePromptClaim()
        let background = window(0)
        let active = window(1)
        #expect(claim.shows(background, due: true, isActive: true))

        #expect(!claim.shows(background, due: true, isActive: false))
        #expect(claim.holder == nil)
        #expect(claim.shows(active, due: true, isActive: true))
        #expect(!claim.shows(background, due: true, isActive: true))
    }

    @Test func aClosingWindowHandsThePromptToAnother() {
        let claim = UpdatePromptClaim()
        let closing = window(0)
        let other = window(1)
        #expect(claim.shows(closing, due: true, isActive: true))

        claim.release(closing)

        #expect(claim.shows(other, due: true, isActive: true))
    }

    @Test func aDismissedPromptLetsTheClaimGo() {
        let claim = UpdatePromptClaim()
        let window = window(0)
        #expect(claim.shows(window, due: true, isActive: true))

        #expect(!claim.shows(window, due: false, isActive: true))
        #expect(claim.holder == nil)
    }

    @Test func aTapFromAnotherWindowTakesTheClaim() {
        let claim = UpdatePromptClaim()
        let holder = window(0)
        let tapped = window(1)
        #expect(claim.shows(holder, due: true, isActive: true))

        claim.request(tapped)

        #expect(claim.holder == tapped)
        #expect(!claim.shows(holder, due: true, isActive: true))
        #expect(claim.shows(tapped, due: true, isActive: true))
    }

    @Test func aTapFromTheHolderKeepsTheClaim() {
        let claim = UpdatePromptClaim()
        let holder = window(0)
        #expect(claim.shows(holder, due: true, isActive: true))

        claim.request(holder)

        #expect(claim.holder == holder)
        #expect(claim.shows(holder, due: true, isActive: true))
        #expect(!claim.shows(window(1), due: true, isActive: true))
    }

    @Test func onlyTheHolderLetsTheClaimGo() {
        let claim = UpdatePromptClaim()
        let holder = window(0)
        #expect(claim.shows(holder, due: true, isActive: true))

        claim.release(window(1))

        #expect(claim.holder == holder)
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
    @Test @MainActor func theRecordSlotIsDisabledOnlyWhileTheShellIsCovered() {
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
        #expect(TabSlot.destination(.tuner).resolved(current: .lists) == (.tuner, false))
    }

    @Test func thePhoneTabsAreCatalogListsTunerRecordings() {
        #expect(TabSlot.phoneTabs == [.catalog, .lists, .tuner, .recordings])
    }
}

@Suite struct SidebarTests {
    private let root = TemporaryRoot()

    #if os(macOS)
        @Test func listsLiveListsInTheirOrder() async throws {
            let store = try await SampleCatalog.copiedStore(root: root.url)
            let commands = Commands(store: store)
            let late = try await commands.createList("Late set")
            try await commands.deleteList(SampleCatalog.lists[0].id)

            let names = try await store.read { try SplitShell.sidebarLists($0).map(\.name) }
            #expect(names == ["Waltzes", "Late set"])
            #expect(try await store.read { try SplitShell.sidebarLists($0).last?.id } == late)
        }
    #endif

    #if os(macOS)
        @Test func onlyTheTunerFillsTheContentAndDetailColumns() {
            #expect(SplitShell.fillsDetail(.tuner))
            for item in [SidebarItem.catalog, .status("known"), .recordings, .list(id: "a")] {
                #expect(!SplitShell.fillsDetail(item))
            }
        }

        @Test func theSidebarReadsHiddenByTheSplitsColumnCount() {
            #expect(!SplitShell.sidebarHidden(.all, twoColumn: false))
            #expect(SplitShell.sidebarHidden(.doubleColumn, twoColumn: false))
            #expect(SplitShell.sidebarHidden(.detailOnly, twoColumn: false))
            #expect(!SplitShell.sidebarHidden(.doubleColumn, twoColumn: true))
            #expect(!SplitShell.sidebarHidden(.all, twoColumn: true))
            #expect(SplitShell.sidebarHidden(.detailOnly, twoColumn: true))
        }

        @Test func eachLayoutShowsItsColumnsForTheSidebarsState() {
            #expect(SplitShell.visibility(sidebarHidden: false, twoColumn: false) == .all)
            #expect(SplitShell.visibility(sidebarHidden: true, twoColumn: false) == .doubleColumn)
            #expect(SplitShell.visibility(sidebarHidden: false, twoColumn: true) == .all)
            #expect(SplitShell.visibility(sidebarHidden: true, twoColumn: true) == .detailOnly)
            // A sidebar hidden on the Tuner stays hidden in the other layout, and the other way.
            for twoColumn in [false, true] {
                for hidden in [false, true] {
                    let shown = SplitShell.visibility(sidebarHidden: hidden, twoColumn: twoColumn)
                    #expect(SplitShell.sidebarHidden(shown, twoColumn: twoColumn) == hidden)
                }
            }
        }

        @Test func theMacSidebarPutsTunerAfterRecordings() {
            let rows = MacSidebar.destinationRows(statuses: ["learning", "known"])
            #expect(rows == [.catalog, .status("learning"), .status("known"), .recordings, .tuner])
        }

        /// The rebuilt sidebar scrolls to its selection by the identity its rows go by: the
        /// destination rows' items, and the lists' ids.
        @Test func theMacSidebarScrollsToTheIdentityItsRowsGoBy() {
            #expect(MacSidebar.scrollTarget(.tuner) == AnyHashable(SidebarItem.tuner))
            #expect(MacSidebar.scrollTarget(.status("known")) == AnyHashable(SidebarItem.status("known")))
            #expect(MacSidebar.scrollTarget(.list(id: "l1")) == AnyHashable("l1"))
        }

        /// A row's tag stays its outermost modifier, which a List needs to select and draw it.
        @Test func theMacSidebarRowEndsWithItsTag() throws {
            let source = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.sources.appending(path: "Mac/MacSidebar.swift")))
            let flat = source.filter { !$0.isWhitespace }
            let row = try #require(flat.range(of: "privatefuncrow("))
            let open = try #require(flat[row.upperBound...].firstIndex(of: "{"))
            // The function's own closing brace, past any closure inside it.
            var depth = 0
            var close = open
            for index in flat[open...].indices {
                if flat[index] == "{" { depth += 1 }
                if flat[index] == "}" { depth -= 1 }
                if depth == 0 {
                    close = index
                    break
                }
            }
            #expect(flat[open..<close].hasSuffix(".tag(item)"))
            #expect(!flat.contains(".id(item)"))
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
        #expect(SidebarItem.tuner.destination == .tuner)
        #expect(SidebarItem.list(id: "a").destination == nil)
    }

    @Test func statusRowMapping() {
        #expect(SidebarItem.catalogRow(status: nil) == .catalog)
        #expect(SidebarItem.catalogRow(status: "learning") == .status("learning"))
        #expect(SidebarItem.status("known").destination == .catalog)
        #expect(SidebarItem.catalog.statusFilter == .some(nil))
        #expect(SidebarItem.status("known").statusFilter == .some("known"))
        #expect(SidebarItem.recordings.statusFilter == nil)
        #expect(SidebarItem.tuner.statusFilter == nil)
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
            let store = try await SampleCatalog.copiedStore(root: root.url)
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
            let store = try await SampleCatalog.copiedStore(root: root.url)
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

@Suite struct MenuCommandAvailabilityTests {
    @Test func newTuneIsDisabledUnderASheetOrWhileSelecting() {
        #expect(MenuCommandAvailability.newTune(sheetsOpen: false, selecting: false))
        #expect(!MenuCommandAvailability.newTune(sheetsOpen: true, selecting: false))
        #expect(!MenuCommandAvailability.newTune(sheetsOpen: false, selecting: true))
    }

    @Test func newListIsDisabledUnderASheet() {
        #expect(MenuCommandAvailability.newList(sheetsOpen: false))
        #expect(!MenuCommandAvailability.newList(sheetsOpen: true))
    }

    @Test func findActsOnlyForAScreenOnShowWithNoSheetUp() {
        #expect(MenuCommandAvailability.find(isShown: true, sheetsOpen: false))
        #expect(!MenuCommandAvailability.find(isShown: false, sheetsOpen: false))
        #expect(!MenuCommandAvailability.find(isShown: true, sheetsOpen: true))
    }

    @Test func sortByActsOnlyWhileTheRecordingsShowWithNoSheetUp() {
        #expect(MenuCommandAvailability.sort(isShown: true, sheetsOpen: false))
        #expect(!MenuCommandAvailability.sort(isShown: false, sheetsOpen: false))
        #expect(!MenuCommandAvailability.sort(isShown: true, sheetsOpen: true))
    }

    @Test func sortByIsDisabledWhileTheScreenSelects() {
        #expect(!MenuCommandAvailability.sort(isShown: true, sheetsOpen: false, selecting: true))
        #expect(MenuCommandAvailability.sort(isShown: true, sheetsOpen: false, selecting: false))
    }

    @Test func sortByOffersEveryRecordingSort() {
        #expect(MenuCommand.sortBy == "Sort By")
        #expect(
            SortChoices<RecordingSort>.items(for: .default).map(\.label) == [
                "Date added", "Date recorded", "Title", "Tune",
            ])
    }

    @Test func recordIsDisabledUnderASheetWhileSelectingOrForAPendingRecordingOrACapture() {
        #expect(
            MenuCommandAvailability.record(
                sheetsOpen: false, selecting: false, recordingPending: false, capturing: false))
        #expect(
            !MenuCommandAvailability.record(
                sheetsOpen: true, selecting: false, recordingPending: false, capturing: false))
        #expect(
            !MenuCommandAvailability.record(
                sheetsOpen: false, selecting: true, recordingPending: false, capturing: false))
        #expect(
            !MenuCommandAvailability.record(
                sheetsOpen: false, selecting: false, recordingPending: true, capturing: false))
        #expect(
            !MenuCommandAvailability.record(
                sheetsOpen: false, selecting: false, recordingPending: false, capturing: true))
    }

    @Test func controlsAreDisabledUnderASheet() {
        #expect(MenuCommandAvailability.controls(sheetsOpen: false))
        #expect(!MenuCommandAvailability.controls(sheetsOpen: true))
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

    #if os(iOS)
        @Test func aTuneOpensInATabThatShowsTunesOrElseTheCatalog() {
            let place = ShellPlace()
            place.tab = .recordings
            place.openTune("t1")
            #expect(place.tab == .recordings)
            #expect(place.tabTunes[.recordings] == "t1")

            place.tab = .lists
            place.tabList = "l1"
            place.openTune("t2")
            #expect(place.tab == .lists)
            #expect(place.tabTunes[.lists] == "t2")

            place.tabList = nil
            place.openTune("t3")
            #expect(place.tab == .catalog)
            #expect(place.tabTunes[.catalog] == "t3")

            place.tab = .tuner
            place.openTune("t4")
            #expect(place.tab == .catalog)
            #expect(place.tabTunes[.catalog] == "t4")
        }
    #else
        @Test func aTuneOpensInTheDetailColumnBesideACatalogWhereTheTunerFillsIt() {
            let place = ShellPlace()
            place.sidebar = .recordings
            place.openTune("t1")
            #expect(place.sidebar == .recordings)
            #expect(place.detailTune == "t1")

            place.sidebar = .tuner
            place.openTune("t2")
            #expect(place.sidebar == .catalog)
            #expect(place.detailTune == "t2")
        }
    #endif

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

    @Test func poppingASettingsPageInTheSheetClosesItForTheIPadLayoutToo() {
        let place = ShellPlace()
        place.isCompact = true
        place.showSettingsPage(.account)

        place.settingsPath.removeLast()

        #expect(place.settingsPage == nil)
    }

    @Test func narrowingShowsTheIPadSettingsPageAloneInTheSheet() {
        let place = ShellPlace()
        place.showSettingsPage(.account)
        // Picked in the iPad detail column, which never touches the sheet's stack.
        place.settingsPage = .stats

        place.narrowed()

        #expect(place.settingsPath == NavigationPath([SettingsPage.stats]))
        #expect(place.settingsPage == .stats)

        place.settingsPage = nil
        place.narrowed()

        #expect(place.settingsPath.isEmpty)
    }

    @Test func narrowingFromTheSettingsTabPresentsTheSheetOverTheCatalog() {
        let place = ShellPlace()
        place.showSettingsPage(.account)

        place.narrowed()

        #expect(place.isCompact)
        #expect(place.tab == .catalog)
        #expect(place.settingsSheetShown)
        #expect(place.settingsPath.count == 1)
    }

    @Test func narrowingFromAnotherTabKeepsItAndLeavesTheSheetDown() {
        let place = ShellPlace()
        place.tab = .tuner

        place.narrowed()

        #expect(place.tab == .tuner)
        #expect(!place.settingsSheetShown)
    }

    @Test func wideningWithTheSheetUpShowsTheSettingsTab() {
        let place = ShellPlace()
        place.isCompact = true
        place.tab = .lists
        place.showSettingsPage(.stats)

        place.widened()

        #expect(!place.isCompact)
        #expect(!place.settingsSheetShown)
        #expect(place.tab == .settings)
        #expect(place.settingsPage == .stats)
    }

    @Test func wideningWithTheSheetDownKeepsTheTab() {
        let place = ShellPlace()
        place.isCompact = true
        place.tab = .recordings

        place.widened()

        #expect(place.tab == .recordings)
    }

    @Test func seePlanOnACompactWindowPresentsSettingsAndPushesAccount() {
        let place = ShellPlace()
        place.isCompact = true
        place.tab = .recordings
        place.showSettingsPage(.stats)

        place.showSettingsPage(.account)

        #expect(place.settingsSheetShown)
        #expect(place.settingsPath.count == 1)
        #expect(place.settingsPage == .account)
        #expect(place.tab == .recordings)
    }

    @Test func showSettingsPresentsTheRoot() {
        let place = ShellPlace()
        place.isCompact = true

        place.showSettings()

        #expect(place.settingsSheetShown)
        #expect(place.settingsPath.isEmpty)
    }

    @Test func theSettingsSheetReopensWhereItWasLeft() {
        let place = ShellPlace()
        place.isCompact = true
        place.showSettingsPage(.stats)
        place.settingsSheetShown = false

        place.showSettings()

        #expect(place.settingsSheetShown)
        #expect(place.settingsPath == NavigationPath([SettingsPage.stats]))
    }

    @Test func aRestoredSettingsTabOpensTheCatalogInACompactWindow() {
        let place = ShellPlace()
        place.restore(tab: .settings, compact: true)
        #expect(place.isCompact)
        #expect(place.tab == .catalog)
        #expect(!place.settingsSheetShown)

        place.restore(tab: .settings, compact: false)
        #expect(!place.isCompact)
        #expect(place.tab == .settings)

        place.restore(tab: .tuner, compact: true)
        #expect(place.tab == .tuner)
    }

    @Test func theCompactShellOutlastsWidening() {
        let place = ShellPlace()
        #expect(place.showsCompactShell(windowIsCompact: true))
        #expect(!place.showsCompactShell(windowIsCompact: false))

        place.restore(tab: .catalog, compact: true)
        #expect(place.showsCompactShell(windowIsCompact: false))

        // The size class has changed, but the compact shell and its sheet stay until this runs.
        place.widened()
        #expect(!place.showsCompactShell(windowIsCompact: true))
    }

    @Test func theSheetsTeardownAfterWideningStillOpensTheSettingsTab() {
        let place = ShellPlace()
        place.restore(tab: .lists, compact: true)
        place.showSettings()

        place.widened()
        place.settingsSheetChanged(shown: false)

        #expect(place.tab == .settings)
        #expect(!place.settingsSheetShown)
    }

    @Test func aCloseBeforeWideningIsAClose() {
        let place = ShellPlace()
        place.restore(tab: .lists, compact: true)
        place.showSettings()

        place.settingsSheetChanged(shown: false)
        place.widened()

        #expect(place.tab == .lists)
        #expect(!place.settingsSheetShown)
    }

    @Test func closingTheSheetInACompactWindowClosesIt() {
        let place = ShellPlace()
        place.isCompact = true
        place.showSettings()
        place.settingsSheetChanged(shown: false)
        #expect(!place.settingsSheetShown)

        place.widened()
        #expect(place.tab == .catalog)
    }

    @Test func aSavedSettingsTabStaysSavedWhileACompactWindowShowsTheCatalog() {
        let place = ShellPlace()
        place.restore(tab: .settings, compact: true)
        #expect(place.tabToSave(saved: .settings) == .settings)
        #expect(place.tabToSave(saved: .lists) == .catalog)
        place.tab = .lists
        #expect(place.tabToSave(saved: .settings) == .lists)

        place.restore(tab: .settings, compact: false)
        place.tab = .catalog
        #expect(place.tabToSave(saved: .settings) == .catalog)
    }

    @Test func closingTheSheetEndsTheCatalogReplacement() {
        let place = ShellPlace()
        place.restore(tab: .settings, compact: true)
        place.showSettings()
        place.settingsSheetChanged(shown: false)
        #expect(place.tabToSave(saved: .settings) == .catalog)

        let narrowed = ShellPlace()
        narrowed.tab = .settings
        narrowed.narrowed()
        #expect(narrowed.tabToSave(saved: .settings) == .settings)
        narrowed.settingsSheetChanged(shown: false)
        #expect(narrowed.tabToSave(saved: .settings) == .catalog)
    }

    @Test func wideningShowsThePageTheSheetWasOn() {
        let place = ShellPlace()
        place.isCompact = true
        place.showSettingsPage(.account)
        // Back to the root, then on to another page, as the sheet's own stack does.
        place.settingsPath = NavigationPath()
        place.settingsPath.append(SettingsPage.stats)
        place.settingsPage = .stats

        place.widened()

        #expect(place.tab == .settings)
        #expect(place.settingsPage == .stats)
    }

    @Test func theMacSidebarShowsTheTunerRow() {
        let place = ShellPlace()
        place.showSidebarRoot(.tuner)
        #expect(place.sidebar == .tuner)
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

    @Test func onlyTheTunerFillsItsTabWithNoDetailColumn() {
        #expect(Destination.allCases.filter { !PadTab.hasDetailColumn($0) } == [.tuner])
    }

    @Test func settingsDetailNamesNoSetting() { #expect(SettingsDetailPlaceholder.title == "No setting selected") }
}

#if os(macOS)
    @Suite struct MacUpdatePromptTests {
        /// The prompt is a notice sheet: Update the primary, pressed by Return and focused, Not
        /// Now beside it on Escape.
        @Test func updateIsThePrimaryAndNotNowCancels() {
            let footer = UpdatePromptSheet.footer(canUpdate: true, update: {}, notNow: {})
            #expect(footer.primary?.title == UpdatePromptText.update)
            #expect(footer.primary?.takesDefaultFocus == true)
            #expect(footer.cancel?.title == UpdatePromptText.notNow)
            let keys = MacSheetAction.keyboardRoles(
                cancel: footer.cancel, primary: footer.primary)
            #expect(keys.primary == .defaultAction)
            #expect(keys.cancel == .cancellation)
        }

        /// Without an App Store page there is nothing to update from, so Not now is the one
        /// primary.
        @Test func withoutAStorePageNotNowIsThePrimary() {
            let footer = UpdatePromptSheet.footer(canUpdate: false, update: {}, notNow: {})
            #expect(footer.cancel == nil)
            #expect(footer.primary?.title == UpdatePromptText.notNow)
            #expect(footer.primary?.answersReturn == true)
            #expect(footer.escape != nil)
        }
    }
#endif

@Suite struct AccountItemTests {
    @Test func showsOnlyWithTheShellsActionAndNotWhileSelecting() {
        let action = MenuAction {}
        #expect(showsAccountItem(showAccount: action, isSelecting: false))
        #expect(!showsAccountItem(showAccount: action, isSelecting: true))
        #expect(!showsAccountItem(showAccount: nil, isSelecting: false))
        #expect(!showsAccountItem(showAccount: nil, isSelecting: true))
    }
}
