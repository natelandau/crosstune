import CrosstuneAnalytics
import CrosstuneAudio
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

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.analytics) private var analytics
    @Environment(\.scenePhase) private var scenePhase
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @State private var catalog: CatalogModel?
    @State private var recordings: RecordingsModel?
    @State private var counts: LiveQuery<CatalogCounts?>?
    @State private var take: RecordTake?
    @State private var openSheets = ShellCover()
    /// Above the layout, so the shell's own sheets stand down the iPhone record slot too.
    @State private var recordCover = ShellCover()
    @State private var selecting = ShellCover()
    /// Bumped to bring the Recordings screen forward.
    @State private var recordingsShown = 0
    @State private var place = ShellPlace()
    @State private var playerWindow = UUID()
    @State private var standVisit = StandVisit()
    @State private var recentTake = RecentTake()
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        @SceneStorage("shell.tab") private var savedTab: Destination = .catalog
    #endif

    /// - Parameters:
    ///   - stage: The web view every window shares for a loaded link, so the link plays once and
    ///     moves between layouts rather than reloading.
    ///   - recorders: The recorder every window shares.
    public init(store: CrosstuneStore, player: PlayerModel, stage: EmbedStage, recorders: RecorderHost) {
        self.store = store
        self.player = player
        self.stage = stage
        self.recorders = recorders
    }

    public var body: some View {
        layout
            .modifier(TuneFormSheets())
            .modifier(ListSheets())
            .modifier(LinkSheets())
            .modifier(
                RecordSheets(
                    take: $take, host: recorders, store: store, record: { startRecording(tuneID: $0, source: .tune) },
                    showRecordings: { recordingsShown += 1 })
            )
            .modifier(LyricsScreens())
            .modifier(ScanScreens())
            .modifier(RecordingTransfers(store: store, player: player))
            .modifier(PlayerLinkWatch(store: store, player: player))
            .modifier(PlayerRecordingWatch(store: store, player: player))
            .modifier(ListPlaybackWiring(store: store, player: player, playback: listPlayback))
            .environment(\.store, store)
            .environment(\.commands, Commands(store: store))
            .environment(player)
            .environment(recorders)
            .environment(recentTakeForPlatform)
            .environment(catalog)
            .environment(recordings)
            .environment(\.catalogCounts, counts)
            .environment(\.openSheets, openSheets)
            .environment(\.recordCover, recordCover)
            .environment(\.selecting, selecting)
            .environment(\.playerWindow, playerWindow)
            .environment(\.standVisit, standVisit)
            .environment(\.openCatalogRoot, MenuAction(id: ShellActionID.openCatalogRoot) { showCatalogRoot() })
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
                    isActive: MenuGates.controls(sheetsOpen: openSheets.isCovered), show: show(_:))
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
                counts = LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) }
            }
            .onChange(of: scenePhase) {
                if scenePhase == .background { catalog?.leftForeground() }
            }
            #if os(macOS)
                .onAppQuit {
                    catalog?.leftForeground()
                    player.appQuitting()
                    analytics.flush()
                }
            #endif
            .onAppear {
                player.isCapturing = { [recorders] in recorders.isCapturing || Recorder.hasActiveCapture }
                stage.onProviderOpened = { [player] in player.embedOpenedProvider() }
            }
            #if os(iOS)
                .environment(\.windowIsRegular, sizeClass == .regular)
                .onAppear { place.tab = savedTab }
                .onChange(of: place.tab) { savedTab = place.tab }
            #endif
    }

    /// The highlight is the iPhone and iPad list's; the Mac's rows stay as they are.
    private var recentTakeForPlatform: RecentTake? {
        #if os(iOS)
            recentTake
        #else
            nil
        #endif
    }

    private var canRecord: Bool {
        MenuGates.record(
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

    /// Opens the record sheet, unless another window's sheet has the microphone. The sheet
    /// takes the recorder only once it shows, so a presentation refused while another sheet
    /// is up holds nothing.
    private func startRecording(tuneID: String?, source: ActionSource) {
        guard RecordTake.mayReplace(take), recorders.isFree(for: store) else { return }
        // Playback would be recorded along with the instrument.
        PlayerBar.closePlayer(player, listPlayback)
        let model = RecordSheetModel(
            recorder: recorders.recorder(for: store), tuneID: tuneID, recentTake: recentTakeForPlatform, source: source,
            analytics: analytics)
        take = RecordTake(model: model)
        #if os(iOS)
            Task { await model.loadTuneTitle(from: store) }
        #endif
    }

    @ViewBuilder private var layout: some View {
        #if os(iOS)
            // Both shells read the same tab fields, so a size change keeps the tab, list, and tune.
            if sizeClass == .compact {
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
