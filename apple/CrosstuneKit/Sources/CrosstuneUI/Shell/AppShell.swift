import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneBilling
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// The frame every screen lives in: a tab bar on iPhone and in compact width on iPad, the iPad
/// shell in regular width, and a split view on the Mac. It hands its screens the store, the
/// commands, and the player, presents the record sheet, and publishes the menu commands it can
/// perform.
///
/// Reads the `AccountSession` and `SyncEngine` from the environment when they are there.
public struct AppShell: View {
    private let store: CrosstuneStore
    private let player: PlayerModel
    private let stage: EmbedStage
    private let recorders: RecorderHost
    private let tuner: TunerModel

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(\.analytics) private var analytics
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.undoManager) private var undoManager
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @Environment(\.plan) private var plan
    @Environment(\.noticeClaim) private var noticeClaim
    @Environment(\.purchases) private var purchases
    @Environment(\.locationAccess) private var locationAccess
    #if os(macOS)
        @Environment(\.openSettings) private var openSettings
    #endif
    @State private var catalog: CatalogModel?
    @State private var recordings: RecordingsModel?
    @State private var addedTune: AddedTuneUndo?
    @State private var counts: LiveQuery<CatalogCounts?>?
    @State private var take: RecordTake?
    @State private var openSheets = ShellCover()
    /// Above the layout, so the shell's own sheets disable the iPhone record slot too.
    @State private var recordCover = ShellCover()
    @State private var selecting = ShellCover()
    /// Bumped to bring the Recordings screen forward.
    @State private var recordingsShown = 0
    @State private var place = ShellPlace()
    @State private var playerWindow = UUID()
    @State private var padPracticeVisit = PadPracticeVisit()
    @State private var recentRecording = RecentRecording()
    /// Made again for each plan, which is made again for each store.
    @State private var premium: PremiumPresenter?
    /// Made again for each plan, as `premium` is, and only in a build that offers purchases.
    @State private var purchase: PurchaseModel?
    /// Made again for each plan, as `premium` is.
    @State private var notices: NoticeModel?
    /// Used when the app shares no claim across windows, as in previews.
    @State private var ownNoticeClaim = NoticeClaim()
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        @SceneStorage("shell.tab") private var savedTab: Destination = .catalog
    #endif

    /// - Parameters:
    ///   - stage: The web view every window shares for a loaded link, so the link plays once and
    ///     moves between layouts rather than reloading.
    ///   - recorders: The recorder every window shares.
    ///   - tuner: The tuner every window shares, so only one ever holds the microphone.
    public init(
        store: CrosstuneStore, player: PlayerModel, stage: EmbedStage, recorders: RecorderHost, tuner: TunerModel
    ) {
        self.store = store
        self.player = player
        self.stage = stage
        self.recorders = recorders
        self.tuner = tuner
    }

    #if DEBUG
        /// Opens on `place`, so a marketing capture starts on the tune or list it shows.
        init(
            store: CrosstuneStore, player: PlayerModel, stage: EmbedStage, recorders: RecorderHost,
            tuner: TunerModel, place: ShellPlace
        ) {
            self.init(store: store, player: player, stage: stage, recorders: recorders, tuner: tuner)
            _place = State(initialValue: place)
        }
    #endif

    public var body: some View {
        layout
            #if os(iOS)
                .onChange(of: sizeClass) { _, next in
                    if next == .compact { place.narrowed() } else if next == .regular { place.widened() }
                }
            #endif
            .modifier(NewTuneCommand(open: openNewTune))
            .modifier(ListSheets())
            .modifier(LinkSheets())
            .modifier(
                RecordSheets(
                    take: $take, host: recorders, store: store, record: { startRecording(tuneID: $0, source: .tune) },
                    showRecordings: { recordingsShown += 1 })
            )
            // The sheet claims the shell only once it shows; this holds the menus from the request.
            .coversShellMenus(premium?.presented != nil)
            .modifier(PlanSheets(presenter: premium, purchase: purchase))
            #if DEBUG
                .opensForSample(.record) { startRecording(tuneID: nil, source: .menu) }
                .opensForSample(.plan, when: premium != nil) { premium?.present(.plan, from: .planGroup) }
                .opensForSample(.planMember, when: premium != nil) { premium?.present(.plan, from: .planGroup) }
            #endif
            .modifier(
                NoticeSheets(
                    model: notices, plan: plan?.plan ?? .unknown, purchase: purchase, onSeePlan: seePlan,
                    onComparePlans: { premium?.present(.plan, from: $0) })
            )
            .modifier(LyricsScreens())
            .modifier(ScanScreens())
            .modifier(RecordingTransfers(store: store, player: player))
            .modifier(PlayerLinkWatch(store: store, player: player))
            .modifier(PlayerRecordingWatch(store: store, player: player))
            .modifier(ListPlaybackWiring(store: store, player: player, playback: listPlayback))
            .updatePrompt(session)
            // Waits out what a plan notice waits out, a capture, a notice that is up, and a build
            // the API no longer supports.
            .requestsReview(
                isClear: !isNoticeCovered && !recorders.isCapturing && notices?.showing == nil
                    && session?.updateRequired != true
            )
            .environment(\.store, store)
            .environment(\.commands, Commands(store: store))
            .environment(player)
            .environment(recorders)
            .environment(recentRecordingForPlatform)
            .environment(catalog)
            .environment(recordings)
            .environment(addedTune)
            .environment(tuner)
            .environment(\.tunerSelected, tunerSelected)
            .environment(\.catalogCounts, counts)
            .environment(\.openSheets, openSheets)
            .environment(\.recordCover, recordCover)
            .environment(\.selecting, selecting)
            .environment(\.premium, premium)
            .environment(\.purchase, purchase)
            .environment(\.playerWindow, playerWindow)
            .environment(\.padPracticeVisit, padPracticeVisit)
            .environment(\.openCatalogRoot, MenuAction(id: ShellActionID.openCatalogRoot) { showCatalogRoot() })
            .environment(\.openTune, TuneOpener(id: ObjectIdentifier(place)) { openTune($0) })
            .focusedSceneValue(
                \.recordAction,
                canRecord ? MenuAction(id: recordID) { startRecording(tuneID: nil, source: .menu) } : nil
            )
            .focusedSceneValue(
                \.syncNowAction,
                engine.map { engine in
                    MenuAction(id: ShellActionID.syncNow(ObjectIdentifier(engine))) { Task { await engine.sync() } }
                }
            )
            .modifier(
                ShellControls(
                    player: player, playback: listPlayback, window: playerWindow,
                    isActive: MenuCommandAvailability.controls(sheetsOpen: openSheets.isCovered), show: show(_:))
            )
            // Made here rather than by their screens, which a Mac or iPad sidebar tears down, so
            // each search lasts the app session and leaves with the signed-in shell.
            .task(id: ObjectIdentifier(store)) {
                catalog = CatalogModel(
                    store: store,
                    sort: UserDefaults.standard.string(forKey: CatalogSortChoice.storageKey)
                        .flatMap(CatalogSortChoice.init(rawValue:)) ?? .default,
                    analytics: analytics)
                recordings = RecordingsModel(store: store, analytics: analytics)
                addedTune = AddedTuneUndo(store: store, analytics: analytics)
                addedTune?.undoManager = undoManager
                addedTune?.voiceOverRunning = voiceOver
                counts = LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) }
            }
            .onChange(of: plan.map(ObjectIdentifier.init), initial: true) {
                (premium, purchase) = PremiumPresenter.forPlan(
                    plan, purchases: purchases, engine: engine, session: session, analytics: analytics)
                notices?.leave()
                notices = plan.map {
                    NoticeModel(store: store, plan: $0, analytics: analytics, claim: noticeClaim ?? ownNoticeClaim)
                }
                notices?.coverChanged(covered: isNoticeCovered, capturing: recorders.isCapturing)
            }
            .onChange(of: isNoticeCovered) {
                notices?.coverChanged(covered: isNoticeCovered, capturing: recorders.isCapturing)
            }
            .onChange(of: recorders.isCapturing) {
                notices?.coverChanged(covered: isNoticeCovered, capturing: recorders.isCapturing)
            }
            // A closed window hands a notice it showed, unseen, to another window.
            .onDisappear { notices?.leave() }
            .onAppear { notices?.rejoin() }
            .onChange(of: scenePhase) {
                if scenePhase == .background { catalog?.leftForeground() }
            }
            .onChange(of: undoManager.map(ObjectIdentifier.init)) { addedTune?.undoManager = undoManager }
            .onChange(of: voiceOver) { addedTune?.voiceOverRunning = voiceOver }
            #if os(macOS)
                .onAppQuit {
                    catalog?.leftForeground()
                    player.appQuitting()
                    analytics.flush()
                }
            #endif
            .onAppear {
                player.isCapturing = { [recorders] in
                    recorders.isCapturing || Recorder.hasActiveCapture
                }
                stage.onOpened = { [player] in player.embedOpened($0) }
            }
            #if os(iOS)
                // The shell's own layout rather than the size class, which turns a frame before it.
                .environment(\.windowIsRegular, !place.showsCompactShell(windowIsCompact: sizeClass == .compact))
                .onAppear { place.restore(tab: savedTab, compact: sizeClass == .compact) }
                .onChange(of: place.tabToSave(saved: savedTab)) { _, next in savedTab = next }
            #endif
    }

    /// The highlight is the iPhone and iPad list's; the Mac's rows stay as they are.
    private var recentRecordingForPlatform: RecentRecording? {
        #if os(iOS)
            recentRecording
        #else
            nil
        #endif
    }

    private var tunerSelected: Bool {
        #if os(iOS)
            place.tab == .tuner
        #else
            place.sidebar == .tuner
        #endif
    }

    /// Whether a sheet, dialog, or selection is over the shell, which a plan notice waits out.
    private var isShellCovered: Bool {
        openSheets.isCovered || selecting.isCovered
    }

    private var isNoticeCovered: Bool {
        Self.noticeCovered(shellCovered: isShellCovered, premiumRequested: premium?.presented != nil, phase: scenePhase)
    }

    /// Whether a plan notice waits: while something covers the shell, while the Plan sheet is
    /// asked for, or while the window is not the active one, so a notice never lands in a
    /// background or minimized window that another window could show it in. The request is read
    /// from the presenter because a cover's claim lands only in the update after it.
    static func noticeCovered(shellCovered: Bool, premiumRequested: Bool, phase: ScenePhase) -> Bool {
        shellCovered || premiumRequested || phase != .active
    }

    private var canRecord: Bool {
        MenuCommandAvailability.record(
            sheetsOpen: openSheets.isCovered, selecting: selecting.isCovered,
            takePending: !RecordTake.mayReplace(take), capturing: recorders.isCapturing)
    }

    private func show(_ destination: Destination) {
        #if os(iOS)
            place.tab = destination
        #else
            place.sidebar = destination == .recordings ? .recordings : .catalog
        #endif
    }

    private func openTune(_ tuneID: String) {
        player.isExpanded = false
        place.openTune(tuneID)
    }

    private func openNewTune() {
        catalog?.newTune()
        player.isExpanded = false
        place.openNewTune(source: .menu)
    }

    private func showCatalogRoot() {
        #if os(iOS)
            place.showTabRoot(.catalog)
        #else
            place.showSidebarRoot(.catalog)
        #endif
    }

    private var recordID: ShellActionID {
        .record(
            store: ObjectIdentifier(store), recorders: ObjectIdentifier(recorders), player: ObjectIdentifier(player),
            playback: listPlayback.map(ObjectIdentifier.init), window: playerWindow)
    }

    private func record() {
        startRecording(tuneID: nil, source: .dock)
    }

    /// Opens the record sheet, unless another window's sheet has the microphone or the plan
    /// holds recordings back, which shows the Plan sheet instead. The sheet takes the
    /// recorder only once it shows, so a presentation refused while another sheet is up holds
    /// nothing.
    private func startRecording(tuneID: String?, source: ActionSource) {
        guard RecordTake.mayReplace(take), recorders.isFree(for: store) else { return }
        guard premium?.gate(.recordings, from: .record) ?? true else { return }
        // Playback would be recorded along with the instrument.
        PlayerBar.closePlayer(player, listPlayback)
        let model = RecordSheetModel(
            recorder: recorders.recorder(for: store), tuneID: tuneID, recentRecording: recentRecordingForPlatform,
            source: source,
            analytics: analytics, locationAccess: locationAccess)
        take = RecordTake(model: model)
        #if os(iOS)
            Task { await model.loadTuneTitle(from: store) }
        #endif
    }

    /// Opens the Plan group: the Settings window's Account tab on the Mac, Settings › Account
    /// elsewhere, in the Settings sheet in a compact window.
    private func seePlan() {
        #if os(macOS)
            MacSettingsTabs.select(.account)
            openSettings()
        #else
            place.showSettingsPage(.account)
        #endif
    }

    @ViewBuilder private var layout: some View {
        #if os(iOS)
            // Both shells read the same tab fields, so a size change keeps the tab, list, and tune.
            if place.showsCompactShell(windowIsCompact: sizeClass == .compact) {
                PhoneShell(
                    player: player, stage: stage, place: place, recordingsShown: recordingsShown, onRecord: record)
            } else {
                PadShell(
                    player: player, stage: stage, place: place, recordingsShown: recordingsShown, onRecord: record)
            }
        #else
            SplitShell(
                store: store, player: player, stage: stage, place: place, window: playerWindow,
                recordingsShown: recordingsShown, onRecord: record)
        #endif
    }
}

#if DEBUG
    #Preview("Shell") {
        SampleShell()
    }

    #Preview("Shell, playing") {
        SampleShell(playing: true)
    }
#endif
