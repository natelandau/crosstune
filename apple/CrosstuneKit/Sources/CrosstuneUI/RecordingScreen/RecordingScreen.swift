import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import GRDB
import SwiftUI

/// Where the recording screen's navigation stack goes: the trim editor, the one screen of its
/// own.
enum RecordingRoute: Hashable {
    case trim
}

/// The loaded recording's stored rows, as the recording screen reads them.
private struct ScreenRows: Equatable, Sendable {
    let recording: Recording
    let file: RecordingFile?
    /// The recording's tune while it still exists.
    let tuneID: String?
    let tuneTitle: String?
    /// The tune's part structure, which names loops.
    let partStructure: String?

    var view: RecordingView {
        RecordingView(recording: recording, file: file, tuneID: tuneID, tuneTitle: tuneTitle)
    }

    /// How long the trimmed recording plays, or nil when nothing says how long it is.
    var trimmedLengthMs: Int64? {
        guard let end = recording.trimEndMs ?? recording.sourceDurationMs ?? file?.localDurationMs else { return nil }
        return max(0, end - recording.trimStartMs)
    }

    static func fetch(_ db: Database, id: String) throws -> ScreenRows? {
        guard let recording = try Recording.fetchOne(db, key: id), recording.deletedAt == nil else { return nil }
        let tune = try recording.tuneID.flatMap { try Tune.fetchOne(db, key: $0) }
        let live = tune?.deletedAt == nil ? tune : nil
        return ScreenRows(
            recording: recording, file: try RecordingFile.fetchOne(db, key: id), tuneID: live?.id,
            tuneTitle: live?.title, partStructure: live?.partStructure)
    }
}

/// The expanded player for the loaded recording: the overview, the waveform under a fixed
/// playhead with the readout and zoom over it, the Loops, Speed, and Pitch selector, the
/// transport, and the chosen mode's controls, with Trim and the recording's other actions in its
/// menu. The recorded date and length are the title's subtitle. It drives the player the bar
/// shows, so what plays here is what the bar plays. Reads the store from the environment.
public struct RecordingScreen: View {
    private let player: PlayerModel

    @Environment(\.store) private var store
    @State private var rows: LiveQuery<ScreenRows?>?
    @State private var path: [RecordingRoute] = []

    public init(player: PlayerModel) {
        self.player = player
    }

    public var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let loaded = rows?.value ?? nil {
                    RecordingScreenContent(player: player, rows: loaded, path: $path)
                        .id(loaded.recording.id)
                } else {
                    // Loading is silence.
                    Color.clear
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(RecordingScreenText.close, systemImage: "chevron.down") { player.isExpanded = false }
                        .help(RecordingScreenText.close)
                        // Escape belongs to the screen's chain, which closes the name field and
                        // deselects before it closes the screen.
                        .keyboardShortcut(nil)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 560, minHeight: 600, idealHeight: 720)
        #endif
        .task(id: loadedID) {
            // A trim screen belongs to the recording it opened on.
            path = []
            guard let store, let id = loadedID else { return }
            rows = LiveQuery(store, initial: nil) { try ScreenRows.fetch($0, id: id) }
        }
        .onChange(of: (rows?.value ?? nil) == nil) { _, isGone in
            // The pushed screen went with the row, so a row that returns opens on the recording.
            if isGone { path = [] }
        }
        .shellSheet()
    }

    private var loadedID: String? {
        player.item?.kind == .recording ? player.item?.id : nil
    }
}

private struct RecordingScreenContent: View {
    let player: PlayerModel
    let rows: ScreenRows
    @Binding var path: [RecordingRoute]

    @Environment(\.store) private var store
    @Environment(\.commands) private var commands
    @Environment(\.spacing) private var spacing
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    /// The mode last used on this device, kept here; the screen's model is what the panel reads.
    @AppStorage(PracticeMode.storageKey) private var mode: PracticeMode = .loops
    @State private var peaks: LoadedPeaks?
    @State private var renaming: RecordingView?
    @State private var filing: RecordingView?
    /// A tune the add to tune sheet asked to start, opened once that sheet has gone.
    @State private var creating: String?
    @State private var form: CreatingTune?
    @State private var deleting: RecordingView?
    @State private var failure: String?
    /// The open trim screen's model, kept until the screen has gone.
    @State private var trim: TrimModel?
    /// Why the trim screen gave way on its own, until the musician next does something here.
    @State private var trimNotice: String?
    @State private var practice: PracticeModel?
    /// The natural height of everything under the waveform, which the waveform leaves room for.
    @State private var controlsHeight: Double?
    @FocusState private var focus: PracticeFocus?
    @AccessibilityFocusState private var waveformFocused: Bool

    private struct LoadedPeaks: Equatable {
        let peaks: Peaks
        /// The server revision these are, or nil for peaks made while recording.
        let rev: String?
    }

    private struct PeaksKey: Equatable {
        let fileName: String?
        let fileRev: String?
        let rowRev: String?
    }

    /// The tune form opened from the add to tune sheet.
    private struct CreatingTune: Identifiable {
        let title: String
        var id: String { title }
    }

    var body: some View {
        Group {
            if let practice {
                screen(practice)
            } else {
                Color.clear
            }
        }
        .navigationTitle(player.title ?? "")
        .navigationSubtitle(subtitle)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) { menu }
        }
        .navigationDestination(for: RecordingRoute.self) { route in
            switch route {
            case .trim:
                if let trim {
                    TrimScreen(model: trim, player: player, peaks: shownPeaks, onDone: leaveTrim)
                }
            }
        }
        .onAppear(perform: openPractice)
        .onDisappear { practice?.leave() }
        .onChange(of: path.isEmpty) { _, isEmpty in
            // However the trim screen went, back swipe included, it holds nothing after.
            guard isEmpty else { return }
            trim?.leave()
            trim = nil
        }
        .onChange(of: rows.recording) { _, row in
            trim?.follow(row)
            practice?.follow(row, file: rows.file)
        }
        .onChange(of: rows.file) { _, file in
            practice?.follow(rows.recording, file: file)
        }
        .onChange(of: rows.partStructure) { _, parts in
            practice?.partStructure = parts
        }
        .onChange(of: practice?.mode) { _, chosen in
            if let chosen { mode = chosen }
        }
        // True once a trim from elsewhere has landed, and a save under way has finished.
        .onChange(of: trim?.mustGiveWay == true) { _, mustGiveWay in
            guard mustGiveWay else { return }
            leaveTrim()
            trimNotice = RecordingScreenText.trimChangedElsewhere
            AccessibilityNotification.Announcement(RecordingScreenText.trimChangedElsewhere).post()
        }
        .task(
            id: PeaksKey(
                fileName: rows.file?.peaksFileName, fileRev: rows.file?.peaksRev, rowRev: rows.recording.peaksRev)
        ) {
            await loadPeaks()
        }
        .sheet(item: $renaming) { view in
            RenameRecordingSheet(view: view)
        }
        .sheet(item: $filing, onDismiss: openCreated) { view in
            AddToTuneSheet(recordingID: view.id) { title in creating = title }
        }
        .sheet(item: $form) { creating in
            TuneFormSheet(target: .new(title: creating.title)) { tuneID in
                file(under: tuneID)
            }
        }
        .coversShell(deleting != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: Binding {
                deleting != nil
            } set: {
                if !$0 { deleting = nil }
            },
            titleVisibility: .visible, presenting: deleting
        ) { view in
            Button(RecordingRowActions.delete, role: .destructive) { delete(view) }
        } message: { view in
            Text(RecordingsModel.deleteMessage(view))
        }
    }

    /// Phone versus wide is a size decision, never width alone.
    private var isWide: Bool {
        #if os(macOS)
            true
        #else
            horizontalSizeClass == .regular && verticalSizeClass == .regular
        #endif
    }

    private var isCompactHeight: Bool { verticalSizeClass == .compact }

    private func screen(_ practice: PracticeModel) -> some View {
        let blocker = screenBlocker
        return VStack(spacing: spacing.stackGap) {
            if let message = player.failure ?? failure ?? practice.failure {
                PlayerFailureText(message)
            }
            if let trimNotice {
                Text(trimNotice)
                    .font(.footnote)
            }
            if blocker == nil,
                let status = RecordingPlayerText.status(
                    player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
            {
                RecordingPlayerStatus(player: player, message: status)
            }
            OverviewStrip(model: practice, peaks: shownPeaks)
                .disabled(blocker != nil)
                .opacity(blocker != nil ? 0.5 : 1)
            PracticeWaveform(
                model: practice, peaks: shownPeaks, focus: $focus, accessibilityFocus: $waveformFocused
            )
            .disabled(blocker != nil)
            .opacity(blocker != nil ? 0.5 : 1)
            .frame(minHeight: PracticeLayout.waveformFloor(isCompactHeight: isCompactHeight), maxHeight: .infinity)
            // Outside the dimming, so the reason the screen is blocked reads at full strength.
            .overlay(alignment: .bottom) { WaveformOverlay(model: practice, blocker: blocker) }
            ScrollView {
                VStack(spacing: spacing.sectionGap) {
                    modeWidth(ModePicker(model: practice))
                        .disabled(blocker != nil)
                        .opacity(blocker != nil ? 0.5 : 1)
                    PracticeControls(model: practice, blocker: blocker)
                    modeWidth(ModeControls(model: practice, onDeleted: focusWaveform))
                        .disabled(blocker != nil)
                        .opacity(blocker != nil ? 0.5 : 1)
                }
                .onGeometryChange(for: Double.self) {
                    $0.size.height
                } action: {
                    controlsHeight = $0
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            // Laid out first, so it takes its natural height and the waveform the rest; only once
            // the waveform is at its floor does this region shrink and scroll.
            .frame(maxHeight: controlsHeight.map { CGFloat($0) })
            .layoutPriority(1)
        }
        .padding(16)
        // The keyboard covers the controls rather than squeezing the waveform, so opening a name
        // field leaves the waveform as it is.
        .ignoresSafeArea(.keyboard)
        .focusable()
        .focusEffectDisabled()
        .focused($focus, equals: .screen)
        .defaultFocus($focus, .screen)
        .modifier(
            PracticeKeys(
                model: practice, focus: $focus, isBlocked: blocker != nil, onDeleted: focusWaveform,
                onClose: close)
        )
        .onChange(of: focus) { _, _ in practice.commitNudge() }
    }

    /// Wide holds the mode's selector and controls to a fixed width.
    @ViewBuilder
    private func modeWidth(_ content: some View) -> some View {
        if isWide {
            content.frame(maxWidth: 440)
        } else {
            content
        }
    }

    private func close() {
        player.isExpanded = false
    }

    /// Delete loop went disabled with the loop it removed, so focus goes to the waveform rather than
    /// to nothing.
    private func focusWaveform() {
        focus = .screen
        waveformFocused = true
    }

    private var shownPeaks: ShownPeaks? {
        peaks.flatMap { ShownPeaks(rows.recording, peaks: $0.peaks, peaksRev: $0.rev) }
    }

    private var subtitle: String {
        let date = RecordingText.recordedAt(rows.recording.recordedAt)
        guard let length = RecordingText.duration(milliseconds: rows.trimmedLengthMs) else { return date }
        return "\(date) · \(length)"
    }

    private var screenBlocker: String? {
        RecordingScreenText.screenBlocker(
            file: rows.file, downloading: transfers?.isDownloading(rows.recording.id) == true)
    }

    private var trimBlocker: String? {
        let downloading = transfers?.isDownloading(rows.recording.id) == true
        return RecordingScreenText.trimBlocker(
            rows.recording, file: rows.file, audio: downloading ? .fetching : player.recordingAudio,
            offline: session?.isOffline == true)
    }

    private var menu: some View {
        let view = rows.view
        return Menu {
            ForEach(RecordingMenuItem.items(inTune: view.tuneID != nil, trimBlocker: trimBlocker), id: \.self) {
                item in
                if item == .delete { Divider() }
                Button(role: item == .delete ? .destructive : nil) {
                    trimNotice = nil
                    choose(item, view)
                } label: {
                    Label {
                        Text(item.label)
                        if let reason = item.blocker { Text(reason) }
                    } icon: {
                        Image(systemName: item.systemImage)
                    }
                }
                .disabled(item.blocker != nil)
            }
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
        }
        .help(TuneScreen.moreActions)
    }

    private func choose(_ item: RecordingMenuItem, _ view: RecordingView) {
        switch item {
        case .trim: openTrim()
        case .rename: renaming = view
        case .addToTune: filing = view
        case .removeFromTune: removeFromTune()
        case .delete: deleting = view
        }
    }

    /// Makes the screen's model once the commands it writes through are at hand.
    private func openPractice() {
        guard practice == nil, let commands else { return }
        let model = PracticeModel(
            player: player, recording: rows.recording, file: rows.file, writer: .commands(commands), mode: mode)
        model.partStructure = rows.partStructure
        practice = model
    }

    private func openTrim() {
        guard path.isEmpty, trimBlocker == nil, let commands else { return }
        let id = rows.recording.id
        let model = TrimModel(
            recording: rows.recording, file: rows.file,
            write: { try await commands.updateRecording($0, trimStartMs: .value($1), trimEndMs: .value($2)) },
            hold: { [player] in player.hold(id, $0) })
        model.open()
        trim = model
        trimNotice = nil
        path.append(.trim)
    }

    /// Back to the recording screen from the trim screen, which writes and holds nothing after.
    private func leaveTrim() {
        trim?.leave()
        path.removeAll()
    }

    /// Shows the peaks on this device at once, then fetches the server's current waveform when
    /// these are missing or older; the file row it writes reruns this with them.
    private func loadPeaks() async {
        let file = rows.file
        if let data = store?.localPeaks(file), let parsed = try? Peaks(file: data) {
            peaks = LoadedPeaks(peaks: parsed, rev: file?.peaksRev)
        } else {
            peaks = nil
        }
        guard let rowRev = rows.recording.peaksRev, file?.peaksRev != rowRev else { return }
        _ = await engine?.peaks(rows.recording.id)
    }

    private func removeFromTune() {
        let id = rows.recording.id
        Task { await run { try await $0.updateRecording(id, tuneID: .value(nil)) } }
    }

    private func openCreated() {
        guard let creating else { return }
        form = CreatingTune(title: creating)
        self.creating = nil
    }

    private func file(under tuneID: String) {
        let id = rows.recording.id
        Task { await run { try await $0.updateRecording(id, tuneID: .value(tuneID)) } }
    }

    /// Deletes through the player, which lets go of the audio first and closes this screen, and
    /// shows a failure on the player bar, which outlasts it.
    private func delete(_ view: RecordingView) {
        guard let commands else { return }
        Task { await player.deleteLoadedRecording { try await commands.deleteRecording(view.id) } }
    }

    /// Runs a write on the recording, showing why it failed above the waveform.
    private func run(_ write: (CrosstuneCommands.Commands) async throws -> Void) async {
        guard let commands else { return }
        failure = nil
        do {
            try await write(commands)
        } catch {
            failure = ListModel.message(error)
        }
    }
}
