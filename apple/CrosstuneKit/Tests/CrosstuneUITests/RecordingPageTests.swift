import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneDesign
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

private func pageRecording(_ id: String, speedPercent: Int = 100) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, label: "Take \(id)", state: "ready",
        sourceDurationMs: 60_000, speedPercent: speedPercent, pitchCents: 0)
}

/// Notes each settled write the player makes, by recording.
@MainActor
private final class PageWrites {
    private(set) var made: [(id: String, change: PlaybackSettings)] = []

    func save(_ id: String, _ change: PlaybackSettings) async throws {
        made.append((id, change))
    }
}

private let noLoopWrites = LoopWriter(
    add: { _, _ in throw CancellationError() }, update: { _, _, _ in }, remove: { _ in })

@MainActor
@Suite struct RecordingPageTests {
    private let audio = FakeAudio()
    private let writes = PageWrites()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio)
        player.settleDelay = .milliseconds(20)
        audio.duration = 60
        player.saveSettings = writes.save
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
    }

    private func playA() async throws {
        player.play(.recording(pageRecording("a"), tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
    }

    private func practice(_ id: String) -> PracticeModel {
        PracticeModel(player: player, recording: pageRecording(id), file: nil, writer: noLoopWrites)
    }

    @Test func openingAPageLeavesPlaybackAlone() async throws {
        try await playA()
        let calls = audio.calls.count
        let place = ShellPlace()
        RecordingPageOpener.shell(place, player: player)("b", source: .recordingsList)
        #expect(player.item?.id == "a")
        #expect(audio.calls.count == calls)
        #expect(place.takeUnreportedOpen(of: "b")?.tab == nil)
    }

    @Test func playLoadsThePagesRecordingAtThePlayhead() async throws {
        try await playA()
        let model = practice("b")
        model.seek(toMs: 12_000)
        #expect(player.item?.id == "a")
        #expect(model.centerMs == 12_000)

        model.togglePlay()
        try await eventually { player.item?.id == "b" && player.recordingAudio == .loaded && audio.isPlaying }
        #expect(audio.elapsed == 12)
        #expect(model.isCurrent)
    }

    @Test func speedOnAnUnloadedRecordingWritesTheRowOnly() async throws {
        try await playA()
        let model = practice("b")
        model.setSpeed(70)
        #expect(model.speedPercent == 70)
        #expect(player.speedPercent == 100)
        try await eventually { !writes.made.isEmpty }
        #expect(writes.made.map(\.id) == ["b"])
        #expect(writes.made.first?.change == PlaybackSettings(speedPercent: 70))
        #expect(!audio.calls.contains("setRate(70)"))
        #expect(player.item?.id == "a")
    }

    @Test func compactOpensOnPracticeAndListsItFirst() {
        #expect(
            RecordingPageArrangement.layout(
                width: 390, allowsWide: false, tab: .details, recordingsPlay: true) == .details)
        #expect(
            RecordingPageArrangement.layout(
                width: 390, allowsWide: false, tab: .practice, recordingsPlay: true) == .practice)
        #expect(RecordingPageTab.allCases == [.practice, .details])
    }

    @Test func regularWidthShowsTheAttributesColumnAndNoTabs() {
        let layout = RecordingPageArrangement.layout(width: 1000, allowsWide: true, tab: .details, recordingsPlay: true)
        #expect(layout == .wide)
        #expect(!RecordingPageArrangement.showsTabs(layout))
        // A width that would fit the column never shows it where the page is pushed full screen.
        #expect(
            RecordingPageArrangement.layout(width: 1000, allowsWide: false, tab: .details, recordingsPlay: true)
                == .details)
    }

    @Test func foldsToTabsBelowTheColumnWidth() {
        let fold = PageStyle.attributesColumnWidth + PageStyle.attributesColumnGap + RecordingScreen.minimumWidth
        #expect(RecordingPageArrangement.foldWidth == fold)
        #expect(
            RecordingPageArrangement.layout(width: fold, allowsWide: true, tab: .practice, recordingsPlay: true)
                == .wide)
        let folded = RecordingPageArrangement.layout(
            width: fold - 1, allowsWide: true, tab: .practice, recordingsPlay: true)
        #expect(folded == .practice)
        #expect(RecordingPageArrangement.showsTabs(folded))
    }

    /// The practice layout wraps the page once whichever tab shows, so a switch between Details
    /// and Practice keeps the page's identity, and VoiceOver's focus stays on the tab control.
    @Test func thePracticeSurfaceKeepsThePageIdentity() throws {
        let text = SourceScan.iOSCompiled(
            SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "RecordingPage/RecordingPage.swift"))))
        // The layout is the file's last type, so it runs to the end of the text.
        let start = try #require(text.range(of: "struct PracticePageFill"))
        let surface = String(text[start.upperBound...])
        let uses = surface.matches(of: /\bcontent\b/).count
        // The parameter, then the one use.
        #expect(uses == 2)
    }

    /// The practice layout follows where practice sits, never the appearance, so a switch of
    /// appearance never moves the controls.
    @Test func practiceLayoutIgnoresTheAppearance() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "RecordingScreen/RecordingScreen.swift")))
        #expect(!text.contains("colorScheme"))
    }

    /// The tuner draws dark in every appearance, so it takes light bars. Practice, trim, and split
    /// draw on the page, so they leave the bars to the appearance.
    @Test func onlyTheTunerTakesLightBars() throws {
        let tuner = SourceScan.iOSCompiled(
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Tuner/TunerScreen.swift"))))
        #expect(tuner.contains(".darkBars("))
        let page = SourceScan.iOSCompiled(
            SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "RecordingPage/RecordingPage.swift"))))
        #expect(!page.contains(".darkBars("))
        #expect(!page.contains("Palette.tunerBackground"))
    }

    /// A pushed screen takes the stack's environment, so the tune pushed over a recording page is
    /// handed to the modifier that pushes it, and every destination that pushes pages forwards it.
    @Test func theTuneOverAPageIsHandedDownTheStack() throws {
        func text(_ path: String) throws -> String {
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path)))
        }
        #expect(!(try text("RecordingPage/PushesRecordingPage.swift")).contains("@Environment(\\.stackPath)"))
        let catalog = try text("Catalog/CatalogScreen.swift")
        #expect(catalog.matches(of: /PushesRecordingPage\(path: stackPath/).count == 2)
        #expect(try text("Lists/ListsScreen.swift").contains(".environment(\\.stackPath, stackPath)"))
    }

    @Test func aDeletedRecordingLeavesThePage() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.database.write { db in try pageRecording("b").insert(db) }
        var left = 0
        let page = RecordingPageModel(
            recordingID: "b", parent: RecordingPageParent(showsClose: false) { left += 1 }, analytics: .noop)
        page.follow(store)
        try await eventually { page.rows?.recording.id == "b" }
        #expect(left == 0)

        try await store.database.write { db in
            var gone = pageRecording("b")
            gone.deletedAt = noon
            try gone.update(db)
        }
        try await eventually { left == 1 }
        #expect(page.rows == nil)
    }

    private func editingPage(_ id: String) -> RecordingPageModel {
        RecordingPageModel(recordingID: id, parent: RecordingPageParent(showsClose: false) {}, analytics: .noop)
    }

    @Test func anEditorClosedWithoutAPlayLeavesNothingLoaded() async throws {
        let page = editingPage("b")
        #expect(page.loadForEditing(.recording(pageRecording("b"), tuneTitle: nil), on: player))
        try await eventually { player.recordingAudio == .loaded }

        page.closeEditors()
        #expect(!player.isLoaded)
    }

    @Test func anEditorClosedAfterAPlayKeepsTheRecordingLoaded() async throws {
        let page = editingPage("b")
        #expect(page.loadForEditing(.recording(pageRecording("b"), tuneTitle: nil), on: player))
        try await eventually { player.recordingAudio == .loaded }
        player.audio.play()
        try await eventually { !player.loadedUnplayed }
        player.audio.pause()

        page.closeEditors()
        #expect(player.item?.id == "b")
    }

    @Test func anEditorOnTheLoadedRecordingKeepsItLoaded() async throws {
        try await playA()
        player.audio.pause()
        let page = editingPage("a")
        #expect(page.loadForEditing(.recording(pageRecording("a"), tuneTitle: nil), on: player))

        page.closeEditors()
        #expect(player.item?.id == "a")
    }

    @Test func aPageGoneWithItsEditorUnplayedLeavesNothingLoaded() async throws {
        var page: RecordingPageModel? = editingPage("b")
        #expect(page?.loadForEditing(.recording(pageRecording("b"), tuneTitle: nil), on: player) == true)
        try await eventually { player.recordingAudio == .loaded }

        page = nil
        #expect(!player.isLoaded)
    }

    /// A page whose practice is still being made shows neither the controls nor the plan's
    /// lock, so a paying musician never sees Subscribe to play while the page opens.
    @Test func aPageWaitingForItsPracticeShowsNoLock() {
        #expect(RecordingPracticeArea.shown(hasPractice: false, blockedReason: nil) == .waiting)
        #expect(RecordingPracticeArea.shown(hasPractice: true, blockedReason: nil) == .controls)
        let reason = RecordingText.subscribeToPlay
        #expect(RecordingPracticeArea.shown(hasPractice: false, blockedReason: reason) == .blocked(reason))
        #expect(RecordingPracticeArea.shown(hasPractice: true, blockedReason: reason) == .blocked(reason))
    }

    @Test func aRefusedPracticePickSelectsNothing() {
        #expect(RecordingPageArrangement.pick(.practice, recordingsPlay: false) == nil)
        #expect(RecordingPageArrangement.pick(.details, recordingsPlay: false) == .details)
        #expect(RecordingPageArrangement.pick(.practice, recordingsPlay: true) == .practice)
    }

    @Test func aLapsedAccountsPageDisablesPlayAndPractice() {
        #expect(RecordingPageArrangement.playBlockedReason(recordingsPlay: false) == RecordingText.subscribeToPlay)
        #expect(RecordingPageArrangement.playBlockedReason(recordingsPlay: true) == nil)
        #expect(!RecordingPageArrangement.isEnabled(.practice, recordingsPlay: false))
        #expect(RecordingPageArrangement.isEnabled(.details, recordingsPlay: false))
        // A remembered Practice opens on Details while it cannot be used.
        #expect(
            RecordingPageArrangement.layout(width: 390, allowsWide: false, tab: .practice, recordingsPlay: false)
                == .details)
    }

    @Test func expandWhileALinkPlaysOpensItsTune() throws {
        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        player.play(try #require(PlayerItem.link(link)))
        let place = ShellPlace()
        var tunes: [String] = []
        player.openLoaded(
            recordingPage: .shell(place, player: player), tune: IDOpener(id: 0) { tunes.append($0) }, source: .dock)
        #expect(tunes == ["t1"])
        #expect(place.unreportedOpen == nil)
    }

    @Test func expandWhileARecordingPlaysOpensItsPracticeTab() async throws {
        try await playA()
        let place = ShellPlace()
        player.openLoaded(recordingPage: .shell(place, player: player), tune: nil, source: .dock)
        #expect(place.takeUnreportedOpen(of: "a")?.tab == .practice)
    }

    @Test func aTabSwitchOrAFoldKeepsThePracticeVisit() async throws {
        let fixture = ActivityFixture()
        fixture.player.play(.recording(loggedRecording(), tuneTitle: nil))
        try await eventually { fixture.player.recordingAudio == .loaded }
        let practice = PracticeModel(
            player: fixture.player, recording: loggedRecording(), file: nil, writer: noLoopWrites, announce: { _ in })
        let page = RecordingPageModel(
            recordingID: "r1", parent: RecordingPageParent(showsClose: false) {}, analytics: .noop)
        page.shown(on: fixture.player, window: nil, practice: practice)
        #expect(fixture.player.activity.screenRecordingID == "r1")

        // Practice showing and hiding, as Details and Practice switch or the page folds.
        practice.showPanel()
        practice.leave()
        practice.showPanel()
        practice.leave()
        #expect(fixture.player.activity.screenRecordingID == "r1")
        #expect(fixture.recorded.sessions.isEmpty)

        page.closeVisit()
        #expect(fixture.player.activity.screenRecordingID == nil)
    }

    @Test func aPageForAnUnloadedRecordingOpensNoVisit() async throws {
        try await playA()
        let page = RecordingPageModel(
            recordingID: "b", parent: RecordingPageParent(showsClose: false) {}, analytics: .noop)
        page.shown(on: player, window: nil, practice: practice("b"))
        #expect(player.activity.screenRecordingID == nil)
    }

    @Test func aPageThatHasLeftOpensNoVisitWhenThePlayerTakesItsRecording() async throws {
        let page = shownPage("b")
        let model = practice("b", on: page)
        await pageLeft(page)
        player.play(.recording(pageRecording("b"), tuneTitle: nil))
        try await eventually { model.isCurrent }
        page.openVisit(model)
        #expect(player.activity.screenRecordingID == nil)
    }

    @Test func theIsolatePanelOnAnUnloadedRecordingLeavesTheLoadedOneAlone() async throws {
        try await playA()
        let model = PracticeModel(
            player: player, recording: pageRecording("b"), file: nil, writer: noLoopWrites, mode: .isolate)
        model.showPanel()
        #expect(!audio.calls.contains("setIsolateOutlineWanted(true)"))

        model.togglePlay()
        try await eventually { player.item?.id == "b" && player.recordingAudio == .loaded }
        model.currentChanged()
        #expect(audio.calls.last { $0.hasPrefix("setIsolateOutlineWanted") } == "setIsolateOutlineWanted(true)")
    }

    @Test func aModeChangeWhilePracticeIsHiddenOpensNoPanel() async throws {
        try await playA()
        let model = PracticeModel(player: player, recording: pageRecording("a"), file: nil, writer: noLoopWrites)
        model.mode = .isolate
        #expect(!audio.calls.contains("setIsolateOutlineWanted(true)"))

        model.showPanel()
        #expect(audio.calls.last { $0.hasPrefix("setIsolateOutlineWanted") } == "setIsolateOutlineWanted(true)")
        model.leave()
        #expect(audio.calls.last { $0.hasPrefix("setIsolateOutlineWanted") } == "setIsolateOutlineWanted(false)")
        model.mode = .speed
        model.mode = .isolate
        #expect(audio.calls.last { $0.hasPrefix("setIsolateOutlineWanted") } == "setIsolateOutlineWanted(false)")
    }

    @Test func aRecordingThatCannotLoadSaysWhyAndCannotPlay() {
        let ready = pageRecording("b")
        func reason(
            _ recording: Recording = ready, file: RecordingFile?, downloading: Bool = false, offline: Bool = false
        )
            -> String?
        {
            RecordingScreenText.loadUnavailableReason(recording, file: file, downloading: downloading, offline: offline)
        }
        let here = RecordingFile(id: "b", localState: .downloaded, fileName: "b.m4a")
        #expect(reason(file: here) == nil)
        #expect(reason(file: here, offline: true) == nil)
        #expect(reason(file: nil) == nil)
        #expect(reason(file: nil, offline: true) == SyncStatus.offlineLabel)
        #expect(reason(file: nil, downloading: true) == RecordingText.downloading)
        #expect(
            reason(file: RecordingFile(id: "b", localState: .capturing, fileName: "b.m4a"))
                == RecordingScreenText.trimWhileRecording)
        var elsewhere = ready
        elsewhere.state = "pending_upload"
        #expect(reason(elsewhere, file: nil) != nil)
    }

    // MARK: Playback on the page

    private let window = UUID()
    private let otherWindow = UUID()

    private func shownPage(_ id: String, in window: UUID? = nil) -> RecordingPageModel {
        let page = editingPage(id)
        page.shown(on: player, window: window ?? self.window)
        return page
    }

    private func practice(_ id: String, on page: RecordingPageModel) -> PracticeModel {
        PracticeModel(player: player, recording: pageRecording(id), file: nil, writer: noLoopWrites, page: page.screen)
    }

    /// Plays `id` from its page, as the practice transport does.
    private func playOnPage(_ id: String) async throws -> (RecordingPageModel, PracticeModel) {
        let page = shownPage(id)
        let model = practice(id, on: page)
        model.togglePlay()
        try await eventually { player.holds(.recording, id: id) && player.recordingAudio == .loaded }
        return (page, model)
    }

    private func pageLeft(_ page: RecordingPageModel) async {
        page.hidden()
        await settle(player)
    }

    /// Waits out the turn after which a page with nothing on screen has left.
    private func settle(_ player: PlayerModel) async {
        await player.pageLeaving?.value
    }

    /// Pushes the trim or split screen over `page`, the editor's appear and the page's disappear
    /// arriving in `order`, in one update.
    private func pushEditor(
        over page: RecordingPageModel, on player: PlayerModel, _ order: PushOrder, practice: PracticeModel? = nil
    ) {
        switch order {
        case .pageHiddenFirst:
            page.hidden(.page)
            page.shown(.editor, on: player, window: window, practice: practice)
        case .editorShownFirst:
            page.shown(.editor, on: player, window: window, practice: practice)
            page.hidden(.page)
        }
    }

    @Test func aPlayOnThePageShowsNoDockOrPlayerBar() async throws {
        try await playA()
        let page = shownPage("b")
        #expect(PlayerBar.isShown(player, nil, in: window))

        let model = practice("b", on: page)
        model.togglePlay()
        try await eventually { player.item?.id == "b" && player.recordingAudio == .loaded }
        #expect(!PlayerBar.isShown(player, nil, in: window))
        #expect(!PlayerBar.isShown(player, nil, in: otherWindow))
        #expect(!PadBottomBar.showsPlayer(player, nil, in: window))
    }

    @Test func detailsCarryListControlsOnlyWhileThePageRecordingIsLoaded() async throws {
        #expect(!RecordingPageArrangement.showsListControls(isCurrent: false))
        let (page, _) = try await playOnPage("b")
        #expect(RecordingPageArrangement.showsListControls(isCurrent: practice("b", on: page).isCurrent))
    }

    @Test func leavingThePageStopsThePlaybackStartedOnIt() async throws {
        let (page, _) = try await playOnPage("b")
        await pageLeft(page)
        #expect(!player.isLoaded)
        #expect(!PlayerBar.isShown(player, nil, in: window))
    }

    @Test func aPageGoneStopsThePlaybackStartedOnIt() async throws {
        var page: RecordingPageModel? = shownPage("b")
        practice("b", on: try #require(page)).togglePlay()
        try await eventually { player.recordingAudio == .loaded }
        page = nil
        await player.pageLeaving?.value
        #expect(!player.isLoaded)
    }

    @Test func aPageOnPlaybackFromElsewhereHidesOnlyItsWindowsDock() async throws {
        try await playA()
        let page = shownPage("a")
        #expect(!PlayerBar.isShown(player, nil, in: window))
        #expect(PlayerBar.isShown(player, nil, in: otherWindow))

        await pageLeft(page)
        #expect(player.item?.id == "a")
        #expect(audio.isPlaying)
        #expect(PlayerBar.isShown(player, nil, in: window))
    }

    @Test func aPauseAndResumeOnThePageLeavesPlaybackFromElsewhereItsOwn() async throws {
        try await playA()
        let page = shownPage("a")
        let model = practice("a", on: page)
        model.togglePlay()
        try await eventually { !audio.isPlaying }
        model.togglePlay()
        try await eventually { audio.isPlaying }

        await pageLeft(page)
        #expect(player.item?.id == "a")
        #expect(PlayerBar.isShown(player, nil, in: window))
    }

    @Test func aTabSwitchKeepsThePagesPlayback() async throws {
        let (page, model) = try await playOnPage("b")
        // Practice showing and hiding, as Details and Practice switch.
        model.showPanel()
        model.leave()
        model.showPanel()
        #expect(player.item?.id == "b")
        #expect(!PlayerBar.isShown(player, nil, in: window))

        await pageLeft(page)
        #expect(!player.isLoaded)
    }

    /// A fold that swaps the shell makes the page again, in the same window.
    @Test func thePageMadeAgainInItsPlaceTakesItsPlaybackOver() async throws {
        let (page, _) = try await playOnPage("b")
        page.hidden()
        let again = shownPage("b")
        await settle(player)
        #expect(player.item?.id == "b")
        #expect(!PlayerBar.isShown(player, nil, in: otherWindow))

        await pageLeft(again)
        #expect(!player.isLoaded)
    }

    /// An app tab switch with the trim or split screen pushed takes the editor off screen too.
    @Test func thePageLeavesOnceNeitherItNorItsEditorShows() async throws {
        try await playA()
        let page = shownPage("a")
        page.shown(.editor, on: player, window: window)
        page.hidden(.page)
        await settle(player)
        #expect(!PlayerBar.isShown(player, nil, in: window))

        page.hidden(.editor)
        await settle(player)
        #expect(player.item?.id == "a")
        #expect(PlayerBar.isShown(player, nil, in: window))
    }

    @Test func thePagesPlaybackStopsOnceNeitherItNorItsEditorShows() async throws {
        let (page, _) = try await playOnPage("b")
        page.shown(.editor, on: player, window: window)
        page.hidden(.page)
        await settle(player)
        #expect(player.item?.id == "b")

        page.hidden(.editor)
        await settle(player)
        #expect(!player.isLoaded)
    }

    /// A push to the editor keeps the page on show, whichever of the page's disappear and the
    /// editor's appear comes first.
    @Test(arguments: PushOrder.allCases)
    func theEditorShownInTheSameUpdateKeepsThePagesPlayback(_ order: PushOrder) async throws {
        let (page, _) = try await playOnPage("b")
        pushEditor(over: page, on: player, order)
        await settle(player)
        #expect(player.item?.id == "b")
        #expect(!PlayerBar.isShown(player, nil, in: window))
    }

    // MARK: The practice visit across the page and its editor

    private func visitPage(_ fixture: ActivityFixture) -> (RecordingPageModel, PracticeModel) {
        let practice = PracticeModel(
            player: fixture.player, recording: loggedRecording(), file: nil, writer: noLoopWrites, announce: { _ in })
        let page = RecordingPageModel(
            recordingID: "r1", parent: RecordingPageParent(showsClose: false) {}, analytics: .noop)
        page.shown(.page, on: fixture.player, window: window, practice: practice)
        return (page, practice)
    }

    private func screenPlays(_ fixture: ActivityFixture) -> [Int64] {
        fixture.recorded.plays.filter { $0.context == "recording_screen" }.map(\.listenedMs)
    }

    /// A push to the editor and back keeps one visit, whichever of the page's disappear and the
    /// editor's appear comes first.
    @Test(arguments: PushOrder.allCases)
    func aPushToTheEditorKeepsOneVisit(_ order: PushOrder) async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        let (page, practice) = visitPage(fixture)
        #expect(fixture.player.activity.screenRecordingID == "r1")
        fixture.clock.advance(5_000)
        pushEditor(over: page, on: fixture.player, order, practice: practice)
        await settle(fixture.player)
        fixture.clock.advance(5_000)
        #expect(screenPlays(fixture).isEmpty)

        page.shown(.page, on: fixture.player, window: window, practice: practice)
        page.hidden(.editor)
        page.hidden(.page)
        await settle(fixture.player)
        #expect(screenPlays(fixture) == [10_000])
    }

    /// An app tab switch with the editor pushed takes the editor off screen, and the time away is
    /// no visit.
    @Test func theVisitClosesWhileTheEditorIsAwayAndOpensAgainOnItsReturn() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        let (page, practice) = visitPage(fixture)
        page.shown(.editor, on: fixture.player, window: window, practice: practice)
        page.hidden(.page)
        fixture.clock.advance(15_000)
        page.hidden(.editor)
        await settle(fixture.player)
        #expect(fixture.player.activity.screenRecordingID == nil)
        #expect(screenPlays(fixture) == [15_000])

        fixture.clock.advance(30_000)
        page.shown(.editor, on: fixture.player, window: window, practice: practice)
        #expect(fixture.player.activity.screenRecordingID == "r1")
        fixture.clock.advance(15_000)
        page.hidden(.editor)
        await settle(fixture.player)
        #expect(screenPlays(fixture) == [15_000, 15_000])
    }

    @Test func aPageForTheRecordingInAnotherWindowDoesNotKeepItsPlayback() async throws {
        let (page, _) = try await playOnPage("b")
        _ = shownPage("b", in: otherWindow)
        await pageLeft(page)
        #expect(!player.isLoaded)
    }

    @Test func aLoadFromElsewhereEndsThePagesClaim() async throws {
        let (page, _) = try await playOnPage("b")
        player.play(.recording(pageRecording("a"), tuneTitle: nil))
        try await eventually { player.item?.id == "a" && player.recordingAudio == .loaded }
        #expect(PlayerBar.isShown(player, nil, in: window))

        await pageLeft(page)
        #expect(player.item?.id == "a")
    }

    @Test func aRowPlayOfThePagesRecordingEndsThePagesClaim() async throws {
        let (page, _) = try await playOnPage("b")
        player.play(.recording(pageRecording("b"), tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
        // The page still shows the loaded recording.
        #expect(!PlayerBar.isShown(player, nil, in: window))
        #expect(PlayerBar.isShown(player, nil, in: otherWindow))

        await pageLeft(page)
        #expect(player.item?.id == "b")
    }

    @Test func aQueueMovingOnEndsThePagesClaim() async throws {
        let (page, _) = try await playOnPage("b")
        player.playQueued(
            .recording(pageRecording("c"), tuneTitle: nil), nowPlaying: NowPlaying(title: "c", tuneTitle: nil),
            trigger: .autoAdvance)
        await pageLeft(page)
        #expect(player.item?.id == "c")
    }

    @Test func anEditorLoadOnThePageBelongsToThePage() async throws {
        let page = shownPage("b")
        #expect(page.loadForEditing(.recording(pageRecording("b"), tuneTitle: nil), on: player))
        try await eventually { player.recordingAudio == .loaded }
        player.audio.play()
        try await eventually { !player.loadedUnplayed }
        page.closeEditors()
        #expect(!PlayerBar.isShown(player, nil, in: window))

        await pageLeft(page)
        #expect(!player.isLoaded)
    }

    /// The open is reported once per request for the page, in the layout it first showed: a
    /// page that mounts again, as after a trip to another sidebar screen, reports nothing.
    @Test func sendsRecordingPageOpenedOncePerRequest() {
        let sink = RecordingAnalyticsSink()
        let place = ShellPlace()
        func mount() -> RecordingPageModel {
            RecordingPageModel(
                recordingID: "b", parent: RecordingPageParent(showsClose: false) {}, analytics: sink.client)
        }
        // As the page does when a request may be its own.
        func report(_ page: RecordingPageModel, layout: RecordingPageLayout) {
            if let open = place.takeUnreportedOpen(of: page.recordingID) { page.reportOpen(open, layout: layout) }
        }
        let opened = RecordingAnalyticsSink.Capture(
            name: "recording_page_opened",
            properties: [
                "recording_id": .string("b"), "layout": .string("details"), "source": .string("recordings_list"),
            ])

        place.openRecordingPage("b", source: .recordingsList)
        let page = mount()
        report(page, layout: .details)
        report(page, layout: .wide)
        #expect(sink.captures == [opened])

        // Back from another screen: the page mounts again, with no new request.
        report(mount(), layout: .details)
        #expect(sink.captures == [opened])

        // A request for another recording is not this page's.
        place.openRecordingPage("c", source: .tune)
        report(page, layout: .details)
        #expect(sink.captures == [opened])

        // A fresh request for the page on show is a fresh open.
        place.openRecordingPage("b", source: .recordingsList)
        report(page, layout: .details)
        #expect(sink.captures == [opened, opened])
    }
}

/// The order in which a push's two halves reach a recording page in one update.
enum PushOrder: CaseIterable {
    case pageHiddenFirst
    case editorShownFirst
}
