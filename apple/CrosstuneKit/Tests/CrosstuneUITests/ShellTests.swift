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
                #expect(contrast(swatch.ink, swatch.background) >= 4.5, "\(status) \(scheme)")
            }
        }
    }

    /// WCAG 2 contrast ratio between two sRGB colors.
    private func contrast(_ first: KeyColor.RGB, _ second: KeyColor.RGB) -> Double {
        func luminance(_ color: KeyColor.RGB) -> Double {
            func linear(_ channel: Double) -> Double {
                channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
        }
        let (a, b) = (luminance(first), luminance(second))
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
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

@Suite struct TabSlotTests {
    @Test func choosingTheRecordSlotRecordsAndKeepsTheTab() {
        #expect(TabSlot.record.resolved(current: .lists) == (.lists, true))
        #expect(TabSlot.destination(.settings).resolved(current: .lists) == (.settings, false))
    }
}

@Suite struct RecordDomeTests {
    @Test func keepsItsFullSizeWhenItsSlotHasRoom() {
        #expect(RecordDome.diameter(forWidth: 402) == RecordDome.diameter)
        #expect(RecordDome.diameter(forWidth: .infinity) == RecordDome.diameter)
    }

    @Test func narrowsToItsSlotInANarrowWindow() {
        let width: CGFloat = 320
        let slot = (width - 2 * RecordDome.barInset) / 5
        #expect(RecordDome.diameter(forWidth: width) == slot)
        #expect(slot < RecordDome.diameter)
        #expect(RecordDome.diameter(forWidth: 0) == 0)
    }
}

@Suite struct SidebarTests {
    private let root = TemporaryRoot()

    @Test func listsLiveListsInTheirOrder() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let commands = Commands(store: store)
        let late = try await commands.createList("Late set")
        try await commands.deleteList(SampleCatalog.lists[0].id)

        let names = try await store.read { try SplitShell.sidebarLists($0).map(\.name) }
        #expect(names == ["Waltzes", "Late set"])
        #expect(try await store.read { try SplitShell.sidebarLists($0).last?.id } == late)
    }

    @Test func aDeletedListsSelectionFallsBackToTheCatalog() {
        let lists = SampleCatalog.lists
        #expect(SidebarItem.list(id: lists[1].id).kept(among: lists) == .list(id: lists[1].id))
        #expect(SidebarItem.list(id: "gone").kept(among: lists) == .catalog)
        #expect(SidebarItem.recordings.kept(among: []) == .recordings)
    }

    @Test func eachRowButAListOpensItsDestination() {
        #expect(SidebarItem.catalog.destination == .catalog)
        #expect(SidebarItem.recordings.destination == .recordings)
        #expect(SidebarItem.settings.destination == .settings)
        #expect(SidebarItem.list(id: "a").destination == nil)
    }
}

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

    @Test func recordStandsDownUnderASheetWhileSelectingOrForAPendingTakeOrACapture() {
        #expect(MenuGates.record(sheetsOpen: false, selecting: false, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: true, selecting: false, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: true, takePending: false, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: false, takePending: true, capturing: false))
        #expect(!MenuGates.record(sheetsOpen: false, selecting: false, takePending: false, capturing: true))
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
    @Test func narrowingKeepsTheSidebarRowAndTheDetailTune() {
        let place = ShellPlace()
        place.sidebar = .recordings
        place.detailTune = "tune-1"
        place.enterTabs()
        #expect(place.tab == .recordings)
        #expect(place.tabTunes == [.recordings: "tune-1"])
        #expect(place.tabList == nil)
    }

    @Test func narrowingOnAListPushesTheListAndItsTune() {
        let place = ShellPlace()
        place.sidebar = .list(id: "list-1")
        place.detailTune = "tune-1"
        place.enterTabs()
        #expect(place.tab == .lists)
        #expect(place.tabList == "list-1")
        #expect(place.tabTunes == [.lists: "tune-1"])
    }

    @Test func wideningKeepsTheTabAndItsPushedTune() {
        let place = ShellPlace()
        place.tab = .catalog
        place.tabTunes = [.catalog: "tune-1", .recordings: "tune-2"]
        place.enterSplit()
        #expect(place.sidebar == .catalog)
        #expect(place.detailTune == "tune-1")

        place.tab = .settings
        place.enterSplit()
        #expect(place.sidebar == .settings)
        #expect(place.detailTune == nil)
    }

    @Test func wideningOnTheListsTabOpensTheListOrFallsBackToTheCatalog() {
        let place = ShellPlace()
        place.tab = .lists
        place.tabList = "list-1"
        place.tabTunes[.lists] = "tune-1"
        place.enterSplit()
        #expect(place.sidebar == .list(id: "list-1"))
        #expect(place.detailTune == "tune-1")

        place.tabList = nil
        place.enterSplit()
        #expect(place.sidebar == .catalog)
        #expect(place.detailTune == nil)
    }

    @Test func aTunePushedOverOneListLeavesWithIt() {
        let place = ShellPlace()
        place.tabList = "list-1"
        place.tabTunes = [.lists: "tune-1", .catalog: "tune-2"]
        place.tabList = "list-2"
        #expect(place.tabTunes == [.catalog: "tune-2"])
    }

    @Test func aRoundTripComesBackToTheSamePlace() {
        let place = ShellPlace()
        place.sidebar = .list(id: "list-1")
        place.detailTune = "tune-1"
        place.enterTabs()
        place.enterSplit()
        #expect(place.sidebar == .list(id: "list-1"))
        #expect(place.detailTune == "tune-1")
    }
}
