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
    @State private var catalog: CatalogModel?
    @State private var take: RecordTake?
    @State private var openSheets = ShellCover()
    /// Above the layout, so the shell's own sheets hide the iPhone record dome too.
    @State private var domeCover = ShellCover()
    @State private var selecting = ShellCover()
    /// Bumped to bring the Recordings screen forward.
    @State private var recordingsShown = 0
    @State private var place = ShellPlace()
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
            .modifier(RecordingTransfers(store: store, player: player))
            .modifier(PlayerLinkWatch(store: store, player: player))
            .modifier(PlayerRecordingWatch(store: store, player: player))
            .environment(\.store, store)
            .environment(\.commands, Commands(store: store))
            .environment(player)
            .environment(recorders)
            .environment(catalog)
            .environment(\.openSheets, openSheets)
            .environment(\.domeCover, domeCover)
            .environment(\.selecting, selecting)
            .focusedSceneValue(\.recordAction, canRecord ? MenuAction(record) : nil)
            .focusedSceneValue(\.syncNowAction, engine.map { engine in MenuAction { Task { await engine.sync() } } })
            // Made here rather than by the catalog screen, which a Mac or iPad sidebar tears down,
            // so the search lasts the app session and leaves with the signed-in shell.
            .task(id: ObjectIdentifier(store)) {
                catalog = CatalogModel(store: store)
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

    private func record() {
        startRecording(tuneID: nil)
    }

    /// Opens the record sheet, unless another window's sheet has the microphone. The sheet
    /// takes the recorder only once it shows, so a presentation refused while another sheet
    /// is up holds nothing.
    private func startRecording(tuneID: String?) {
        guard RecordTake.mayReplace(take), recorders.isFree(for: store) else { return }
        // Playback would be recorded along with the instrument.
        player.close()
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
