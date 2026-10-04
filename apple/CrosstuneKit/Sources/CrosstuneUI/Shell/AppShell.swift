import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// The frame every screen lives in: a tab bar on iPhone and in compact width on iPad, a split
/// view on iPad in regular width and on Mac. It hands its screens the store, the commands,
/// and the player, presents the record sheet, and publishes the menu commands it can perform.
///
/// Reads the `AccountSession` and `SyncEngine` from the environment when they are there.
public struct AppShell: View {
    private let store: CrosstuneStore
    private let player: PlayerModel
    private let stage: EmbedStage
    private let recorders: RecorderHost

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @State private var catalog: CatalogModel?
    @State private var recordings: RecordingsModel?
    @State private var take: RecordTake?
    @State private var openSheets = ShellCover()
    /// Above the layout, so the shell's own sheets hide the iPhone record dome too.
    @State private var domeCover = ShellCover()
    @State private var selecting = ShellCover()
    /// Bumped to bring the Recordings screen forward.
    @State private var recordingsShown = 0
    @State private var place = ShellPlace()
    @State private var playerWindow = UUID()
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        @SceneStorage("shell.tab") private var savedTab: Destination = .catalog
        /// The layout on show, which follows the size class only once the place has been carried
        /// over, so the new layout opens on it. Nil only before the shell first appears.
        @State private var usesTabs: Bool?
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
                    take: $take, host: recorders, store: store, record: startRecording(tuneID:),
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
            .environment(catalog)
            .environment(recordings)
            .environment(\.openSheets, openSheets)
            .environment(\.domeCover, domeCover)
            .environment(\.selecting, selecting)
            .environment(\.playerWindow, playerWindow)
            .environment(\.openCatalogRoot, MenuAction { showRoot(.catalog) })
            .focusedSceneValue(\.recordAction, canRecord ? MenuAction(record) : nil)
            .focusedSceneValue(\.syncNowAction, engine.map { engine in MenuAction { Task { await engine.sync() } } })
            .modifier(
                ShellControls(
                    player: player, playback: listPlayback, window: playerWindow,
                    isActive: MenuGates.controls(sheetsOpen: openSheets.isCovered), show: show(_:))
            )
            // Made here rather than by their screens, which a Mac or iPad sidebar tears down, so
            // each search lasts the app session and leaves with the signed-in shell.
            .task(id: ObjectIdentifier(store)) {
                catalog = CatalogModel(store: store)
                recordings = RecordingsModel(store: store)
            }
            .onAppear {
                player.isCapturing = { [recorders] in recorders.isCapturing || Recorder.hasActiveCapture }
            }
            #if os(iOS)
                .onAppear {
                    place.tab = savedTab
                    // Set now, so the first switch after launch converts before the new layout draws.
                    usesTabs = sizeClass == .compact
                }
                .onChange(of: place.tab) { savedTab = place.tab }
                .onChange(of: sizeClass == .compact) { _, compact in
                    if compact { place.enterTabs() } else { place.enterSplit() }
                    usesTabs = compact
                }
            #endif
    }

    private var canRecord: Bool {
        MenuGates.record(
            sheetsOpen: openSheets.isCovered, selecting: selecting.isCovered,
            takePending: !RecordTake.mayReplace(take), capturing: recorders.isCapturing)
    }

    private func show(_ destination: Destination) {
        #if os(iOS)
            if usesTabs == true {
                place.tab = destination
                return
            }
        #endif
        place.sidebar = destination == .recordings ? .recordings : .catalog
    }

    private func showRoot(_ destination: Destination) {
        #if os(iOS)
            place.showRoot(destination, inTabs: usesTabs == true)
        #else
            place.showRoot(destination, inTabs: false)
        #endif
    }

    private func record() {
        startRecording(tuneID: nil)
    }

    /// Opens the record sheet, unless another window's sheet has the microphone. The sheet
    /// takes the recorder only once it shows, so a presentation refused while another sheet
    /// is up holds nothing.
    private func startRecording(tuneID: String?) {
        guard RecordTake.mayReplace(take), recorders.isFree(for: store) else { return }
        // Playback would be recorded along with the instrument.
        PlayerBar.closePlayer(player, listPlayback)
        take = RecordTake(model: RecordSheetModel(recorder: recorders.recorder(for: store), tuneID: tuneID))
    }

    @ViewBuilder private var layout: some View {
        #if os(iOS)
            if usesTabs ?? (sizeClass == .compact) {
                PhoneShell(
                    player: player, stage: stage, place: place, recordingsShown: recordingsShown, onRecord: record)
            } else {
                split
            }
        #else
            split
        #endif
    }

    private var split: some View {
        SplitShell(
            store: store, player: player, stage: stage, place: place, recordingsShown: recordingsShown,
            onRecord: record)
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
