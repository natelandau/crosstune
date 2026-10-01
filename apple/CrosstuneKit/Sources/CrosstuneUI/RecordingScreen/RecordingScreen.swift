import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import GRDB
import SwiftUI

/// Where the recording screen's navigation stack goes.
enum RecordingRoute: Hashable {
    case trim
    case practice
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

/// The expanded player for the loaded recording: the whole trimmed recording as a scrubber, the
/// transport, and the tools. It drives the player the bar shows, so what plays here is what the
/// bar plays. Reads the store from the environment.
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
                } else {
                    // Loading is silence.
                    Color.clear
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(RecordingScreenText.close, systemImage: "xmark") { player.isExpanded = false }
                        .help(RecordingScreenText.close)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 560, minHeight: 600, idealHeight: 720)
        #endif
        .task(id: loadedID) {
            // A trim or practice screen belongs to the recording it opened on.
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
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(\.playerWindow) private var window
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
    /// The open practice screen's model, kept until the screen has gone.
    @State private var practice: PracticeModel?
    @FocusState private var holdsKeyboard: Bool

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
        let recording = rows.recording
        let ready = player.recordingAudio == .loaded && !player.audio.hasFailed
        let length = ready ? player.audio.duration ?? 0 : Double(rows.trimmedLengthMs ?? 0) / 1000
        let position = ready ? player.audio.elapsed : 0
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text(subtitle)
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    practiceBadge
                }
                if let message = player.failure ?? failure {
                    PlayerFailureText(message)
                }
                if let trimNotice {
                    Text(trimNotice)
                        .font(.footnote)
                }
                VStack(spacing: 4) {
                    WaveformView(
                        peaks: shownPeaks,
                        length: length, position: position
                    ) {
                        trimNotice = nil
                        player.audio.seek(to: $0)
                    }
                    .disabled(!ready)
                    HStack {
                        Text(PlayerTime.clock(position))
                        Spacer()
                        Text(PlayerTime.remaining(position, of: length))
                    }
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                }
                if let status = RecordingPlayerText.status(
                    player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
                {
                    RecordingPlayerStatus(player: player, message: status)
                }
                RecordingTransport(player: player)
                #if os(iOS)
                    AudioRoutePicker()
                #endif
                ToolStrip(items: tools, onSelect: select)
            }
            .frame(maxWidth: 560)
            .padding(16)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(player.title ?? "")
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
            case .practice:
                if let practice {
                    PracticeScreen(model: practice, title: player.title ?? "", peaks: shownPeaks) {
                        path.removeAll()
                    }
                }
            }
        }
        .onChange(of: path.isEmpty) { _, isEmpty in
            // However the pushed screen went, back swipe included, it holds nothing after.
            guard isEmpty else { return }
            trim?.leave()
            trim = nil
            practice?.leave()
            practice = nil
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
        .onChange(of: player.opening, initial: true) { _, opening in
            guard opening != nil, player.takeOpening() == .practice else { return }
            openPractice()
        }
        // True once a trim from elsewhere has landed, and a save under way has finished.
        .onChange(of: trim?.mustGiveWay == true) { _, mustGiveWay in
            guard mustGiveWay else { return }
            leaveTrim()
            trimNotice = RecordingScreenText.trimChangedElsewhere
            AccessibilityNotification.Announcement(RecordingScreenText.trimChangedElsewhere).post()
        }
        .focusable()
        .focusEffectDisabled()
        .focused($holdsKeyboard)
        .defaultFocus($holdsKeyboard, true)
        // A focused text field, slider, or button keeps these keys, so this hears them only when
        // nothing inside wants them.
        .onKeyPress(.space, phases: .down) { _ in
            guard ready else { return .ignored }
            trimNotice = nil
            player.audio.toggle()
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
            guard ready else { return .ignored }
            trimNotice = nil
            player.audio.skip(by: press.key == .leftArrow ? -AudioPlayer.skipInterval : AudioPlayer.skipInterval)
            return .handled
        }
        .task(
            id: PeaksKey(fileName: rows.file?.peaksFileName, fileRev: rows.file?.peaksRev, rowRev: recording.peaksRev)
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

    private var shownPeaks: ShownPeaks? {
        peaks.flatMap { ShownPeaks(rows.recording, peaks: $0.peaks, peaksRev: $0.rev) }
    }

    private var subtitle: String {
        let date = RecordingText.recordedAt(rows.recording.recordedAt)
        guard let length = RecordingText.duration(milliseconds: rows.trimmedLengthMs) else { return date }
        return "\(date) · \(length)"
    }

    private var tools: [ToolStripItem] {
        let downloading = transfers?.isDownloading(rows.recording.id) == true
        let blocker = RecordingScreenText.trimBlocker(
            rows.recording, file: rows.file, audio: downloading ? .fetching : player.recordingAudio,
            offline: session?.isOffline == true)
        return ToolStripItem.recordingScreen(
            trimBlocker: blocker, practiceBlocker: practiceBlocker, speedPercent: player.speedPercent,
            pitchCents: player.pitchCents)
    }

    private var practiceBlocker: String? {
        RecordingScreenText.practiceBlocker(
            file: rows.file, downloading: transfers?.isDownloading(rows.recording.id) == true)
    }

    /// The speed and pitch away from their defaults, which opens Practice where they are set.
    @ViewBuilder private var practiceBadge: some View {
        if practiceBlocker == nil,
            let badge = RecordingScreenText.practiceBadge(
                speedPercent: player.speedPercent, pitchCents: player.pitchCents)
        {
            // Through the player, the way the player bar's Repeat badge opens Practice too.
            Button {
                trimNotice = nil
                player.openPractice(in: window)
            } label: {
                SettingsBadgeLabel(text: badge)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RecordingScreenText.practiceBadgeLabel(badge))
        }
    }

    private var menu: some View {
        let view = rows.view
        return Menu {
            if practiceBlocker == nil {
                Button(PracticeText.practice, systemImage: "repeat") { act(openPractice) }
            }
            Button(RecordingRowActions.rename, systemImage: "pencil") { act { renaming = view } }
            if view.tuneID != nil {
                Button(RecordingRowActions.removeFromTune, systemImage: "folder.badge.minus") { act(removeFromTune) }
            } else {
                Button(RecordingRowActions.addToTune, systemImage: "folder.badge.plus") { act { filing = view } }
            }
            Divider()
            Button(RecordingRowActions.delete, systemImage: "trash", role: .destructive) { act { deleting = view } }
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
        }
        .help(TuneScreen.moreActions)
    }

    /// Runs something the musician asked for, which puts away the trim notice.
    private func act(_ action: () -> Void) {
        trimNotice = nil
        action()
    }

    private func select(_ chosen: RecordingTool) {
        trimNotice = nil
        switch chosen {
        case .trim: openTrim()
        case .practice: openPractice()
        }
    }

    /// Pushes Practice, unless it cannot run now, when the recording's own view says why.
    private func openPractice() {
        guard path.isEmpty, practiceBlocker == nil, let commands else { return }
        let model = PracticeModel(
            player: player, recording: rows.recording, file: rows.file, writer: .commands(commands))
        model.partStructure = rows.partStructure
        practice = model
        trimNotice = nil
        path.append(.practice)
    }

    private func openTrim() {
        guard path.isEmpty, let commands else { return }
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
