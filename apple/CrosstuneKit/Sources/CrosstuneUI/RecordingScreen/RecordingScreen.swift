import CrosstuneAnalytics
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
struct ScreenRows: Equatable, Sendable {
    let recording: Recording
    let file: RecordingFile?
    /// The recording's tune while it still exists.
    let tuneID: String?
    let tuneTitle: String?
    /// The tune's part structure, which names loops.
    let partStructure: String?
    /// The location's name to show: its saved location's while that is live, else the recording's own.
    let shownPlace: String?

    var view: RecordingView {
        RecordingView(
            recording: recording, file: file, tuneID: tuneID, tuneTitle: tuneTitle, shownPlace: shownPlace)
    }

    /// How long the trimmed recording plays, or nil when nothing says how long it is. A row the
    /// trim pipeline has not reached yet knows only its upload's length.
    var trimmedLengthMs: Int64? {
        guard
            let end = recording.trimEndMs ?? recording.sourceDurationMs ?? file?.localDurationMs
                ?? recording.durationMs
        else { return nil }
        return max(0, end - recording.trimStartMs)
    }

    static func fetch(_ db: Database, id: String) throws -> ScreenRows? {
        guard let recording = try Recording.fetchOne(db, key: id), recording.deletedAt == nil else { return nil }
        let tune = try recording.tuneID.flatMap { try Tune.fetchOne(db, key: $0) }
        let live = tune?.deletedAt == nil ? tune : nil
        let linked = try recording.placeID.flatMap { try SavedPlace.fetchOne(db, key: $0) }
        let places = linked.map { [$0.id: $0] } ?? [:]
        return ScreenRows(
            recording: recording, file: try RecordingFile.fetchOne(db, key: id), tuneID: live?.id,
            tuneTitle: live?.title, partStructure: live?.partStructure,
            shownPlace: shownPlaceName(recording, places: places))
    }
}

extension EnvironmentValues {
    /// The appearance outside the recording screen whose practice background the screen is drawn
    /// on, or nil where it draws on the window's own background.
    @Entry var practiceBackground: ColorScheme?
}

extension View {
    /// Puts the recording screen on the practice background for `scheme`, the appearance outside
    /// it, and draws everything on it in dark so it reads on that background in every appearance.
    func practiceBackground(_ scheme: ColorScheme) -> some View {
        environment(\.practiceBackground, scheme)
            .environment(\.colorScheme, .dark)
    }
}

/// Fills a screen of the recording screen's stack with the practice background, where it has one.
private struct PracticeBackgroundFill: ViewModifier {
    @Environment(\.practiceBackground) private var practiceScheme

    func body(content: Content) -> some View {
        if let practiceScheme {
            content.stackBackground(Palette.practiceBackground(practiceScheme))
        } else {
            content
        }
    }
}

extension View {
    /// Fills the navigation stack's screen behind this view with `color`.
    fileprivate func stackBackground(_ color: Color) -> some View {
        #if os(iOS)
            containerBackground(color, for: .navigation)
        #else
            // The Mac uses the practice background only to preview the phone's screen.
            background(color)
        #endif
    }
}

/// The expanded player for the loaded recording: the overview, the waveform under a fixed
/// playhead with the readout and zoom over it, the Loops, Speed, and Pitch selector, the
/// transport, and the chosen mode's controls, with Trim and the recording's other actions in its
/// menu. Where the recording came from and its length are the title's subtitle on iPhone; the
/// Mac's heading reads its date and length. It drives the player the bar
/// shows, so what plays here is what the bar plays. Reads the store from the environment.
public struct RecordingScreen: View {
    private let player: PlayerModel

    @Environment(\.store) private var store
    #if os(macOS)
        @Environment(\.playerWindow) private var window
    #endif
    @State private var rows: LiveQuery<ScreenRows?>?
    @State private var path: [RecordingRoute] = []
    /// The top of the practice controls, below which a swipe down never closes the screen.
    @State private var controlsTop: CGFloat?
    /// This screen's identity for the visit it logs, so another window's screen ends only its own.
    @State private var screen = UUID()

    public init(player: PlayerModel) {
        self.player = player
    }

    #if os(macOS)
        /// The narrowest the Mac practice view lays out its waveform and controls.
        static let minimumWidth: CGFloat = 480
    #endif

    public var body: some View {
        // Around the stack, so the header, a pushed trim screen, and the swipe that closes the
        // screen belong to practice alone, and the reading pane keeps the window's full height.
        PadPracticeScreen(player: player) {
            practice
        }
        .screenView(.recording)
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
        // Here rather than on the recording's own view, which also goes while the trim screen
        // is pushed over it.
        #if os(macOS)
            .onAppear { player.screenAppeared(screen, in: window) }
        #endif
        .onDisappear {
            player.screenClosed(by: screen)
            #if os(macOS)
                player.screenDisappeared(screen, in: window)
            #endif
        }
        #if os(iOS)
            .shellSheet()
        #endif
    }

    private var practice: some View {
        NavigationStack(path: $path) {
            Group {
                if let loaded = rows?.value ?? nil {
                    RecordingScreenContent(
                        player: player, rows: loaded, path: $path, controlsTop: $controlsTop, screen: screen
                    )
                    .id(loaded.recording.id)
                } else {
                    // Loading is silence.
                    Color.clear
                }
            }
            .modifier(PracticeBackgroundFill())
            #if os(iOS)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            player.isExpanded = false
                        } label: {
                            Label(RecordingScreenText.close, systemImage: "chevron.down")
                        }
                        .help(RecordingScreenText.close)
                        // Escape belongs to the screen's chain, which closes the name field and
                        // deselects before it closes the screen.
                        .keyboardShortcut(nil)
                    }
                }
            #endif
        }
        .closesPracticeBySwipe(areaBottom: controlsTop, isEnabled: path.isEmpty) { player.isExpanded = false }
    }

    private var loadedID: String? {
        player.item?.kind == .recording ? player.item?.id : nil
    }
}

struct RecordingScreenContent: View {
    let player: PlayerModel
    let rows: ScreenRows
    /// The screen this content shows in, which owns the visit it opens.
    let screen: UUID?
    @Binding var path: [RecordingRoute]
    /// Where the controls under the waveform start, in the screen's swipe space.
    @Binding var controlsTop: CGFloat?

    @Environment(\.store) private var store
    @Environment(\.commands) private var commands
    @Environment(\.spacing) private var spacing
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(\.openURL) private var openURL
    @Environment(\.practiceBackground) private var practiceScheme
    @Environment(\.readingPaneHasContent) private var readingPaneHasContent
    @Environment(\.plan) private var plan
    /// The mode last used on this device, kept here; the screen's model is what the panel reads.
    @AppStorage(PracticeMode.storageKey) private var mode: PracticeMode = .loops
    @State private var peaks: LoadedPeaks?
    @State private var editing: RecordingView?
    /// The page the edit sheet opens on, nil for its form.
    @State private var editingPage: EditRecordingPage?
    @State private var filing: RecordingView?
    /// A tune the add to tune sheet asked to start, made once that sheet has gone.
    @State private var creating: String?
    @Environment(\.openTune) private var openTune
    @Environment(AddedTuneUndo.self) private var addedTune: AddedTuneUndo?
    @State private var deleting: RecordingView?
    @State private var failure: String?
    /// The open trim screen's model, kept until the screen has gone.
    @State private var trim: TrimModel?
    /// Why the trim screen gave way on its own, until the musician next does something here.
    @State private var trimNotice: String?
    @State private var practice: PracticeModel?
    /// The natural height of everything under the waveform, which the waveform leaves room for.
    @State private var controlsHeight: Double?
    /// The waveform's and the controls region's laid-out heights, which tell the iPad's practice screen how
    /// short practice can go before its controls clip.
    @State private var waveformHeight: CGFloat?
    @State private var controlsRegionHeight: CGFloat?
    @Environment(\.showsReadingPane) private var showsReadingPane
    @Environment(ListPlayback.self) private var playback: ListPlayback?
    @FocusState private var focus: PracticeFocus?
    @AccessibilityFocusState private var waveformFocused: Bool

    private struct LoadedPeaks: Equatable {
        let peaks: Peaks
        /// The server revision these are, or nil for peaks made while recording.
        let rev: String?
        /// Found once as the peaks load, since every redraw would otherwise scan the whole file.
        let loudest: UInt8

        init(peaks: Peaks, rev: String?) {
            self.peaks = peaks
            self.rev = rev
            loudest = peaks.values.max() ?? 0
        }
    }

    private struct PeaksKey: Equatable {
        let fileName: String?
        let fileRev: String?
        let rowRev: String?
    }

    /// - Parameters:
    ///   - practice: The screen's model when it is made ahead of showing, as for a snapshot.
    ///   - peaks: Peaks to show before any load, as for a snapshot.
    init(
        player: PlayerModel, rows: ScreenRows, path: Binding<[RecordingRoute]>,
        controlsTop: Binding<CGFloat?> = .constant(nil), screen: UUID? = nil, practice: PracticeModel? = nil,
        peaks: Peaks? = nil
    ) {
        self.player = player
        self.screen = screen
        self.rows = rows
        _path = path
        _controlsTop = controlsTop
        _practice = State(initialValue: practice)
        _peaks = State(initialValue: peaks.map { LoadedPeaks(peaks: $0, rev: nil) })
    }

    private var headerSubtitle: String? {
        PadPracticeHeader.subtitle(
            recording: rows.recording, tuneTitle: rows.tuneTitle, lengthMs: rows.trimmedLengthMs,
            place: rows.shownPlace, playback: playback, showsReadingPane: showsReadingPane)
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
        #if os(iOS)
            // A bar's subtitle, like its title, cannot carry .contentMask().
            .navigationSubtitle(headerSubtitle ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if readingPaneHasContent {
                    ToolbarItem(placement: .primaryAction) { ReadingPaneToggle() }
                }
                ToolbarItem(placement: .primaryAction) { locationControl }
                ToolbarItem(placement: .primaryAction) { menu }
            }
        #else
            // The heading in the content shows the title, so the toolbar does not show it twice.
            .toolbar(removing: .title)
            .paneBar {
                Button(RecordingScreenText.close) { player.isExpanded = false }
                .buttonStyle(.macSecondary)
                .help(RecordingScreenText.close)
                menu
            }
        #endif
        .navigationDestination(for: RecordingRoute.self) { route in
            switch route {
            case .trim:
                if let trim {
                    TrimScreen(model: trim, player: player, peaks: shownPeaks, onDone: leaveTrim)
                        .modifier(PracticeBackgroundFill())
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
        .sheet(item: $editing) { view in
            EditRecordingSheet(view: view, initialPage: editingPage)
        }
        .sheet(item: $filing, onDismiss: openCreated) { view in
            AddToTuneSheet(recordingID: view.id) { title in creating = title }
        }
        .coversShell(deleting != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: $deleting.isPresent(),
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
        let disabledReason = screenUnavailableReason
        return VStack(spacing: spacing.stackGap) {
            #if os(macOS)
                header
            #endif
            if let message = player.failure ?? failure ?? practice.failure {
                PlayerFailureText(message)
            }
            if let trimNotice {
                Text(trimNotice)
                    .font(.platform(.footnote))
            }
            if disabledReason == nil,
                let status = RecordingPlayerText.status(
                    player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
            {
                RecordingPlayerStatus(player: player, message: status)
            }
            PlaylistControlsRow()
            #if os(macOS)
                stage(practice, disabledReason: disabledReason)
            #else
                OverviewStrip(model: practice, peaks: shownPeaks)
                    .disabled(disabledReason != nil)
                    .opacity(disabledReason != nil ? 0.5 : 1)
                waveform(practice, disabledReason: disabledReason)
                    // Outside the dimming, so the reason the screen is blocked reads at full strength.
                    .overlay(alignment: .bottom) {
                        WaveformOverlay(
                            model: practice, disabledReason: disabledReason, showsReadout: practiceScheme == nil)
                    }
                // On the practice background the readout sits under the playhead rather than over the wave.
                if practiceScheme != nil {
                    PracticeReadout(model: practice, disabledReason: disabledReason)
                }
            #endif
            ScrollView {
                #if os(macOS)
                    // The transport right under the stage it plays, then the mode picker over
                    // its panel, so the two read as one unit.
                    VStack(spacing: MacStyle.sectionGap) {
                        PracticeControls(model: practice, disabledReason: disabledReason)
                        modeWidth(
                            VStack(spacing: 16) {
                                ModePicker(model: practice)
                                ModeControls(model: practice, onDeleted: focusWaveform)
                            }
                        )
                        .disabled(disabledReason != nil)
                        .opacity(disabledReason != nil ? 0.5 : 1)
                    }
                    .padding(.top, MacStyle.headingGap)
                    .onGeometryChange(for: Double.self) {
                        $0.size.height
                    } action: {
                        controlsHeight = $0
                    }
                #else
                    VStack(spacing: spacing.sectionGap) {
                        // On the practice background the transport leads, right under the waveform it plays.
                        if practiceScheme != nil {
                            PracticeControls(model: practice, disabledReason: disabledReason)
                        }
                        modeWidth(ModePicker(model: practice))
                            .disabled(disabledReason != nil)
                            .opacity(disabledReason != nil ? 0.5 : 1)
                        if practiceScheme == nil {
                            PracticeControls(model: practice, disabledReason: disabledReason)
                        }
                        modeWidth(ModeControls(model: practice, onDeleted: focusWaveform))
                            .disabled(disabledReason != nil)
                            .opacity(disabledReason != nil ? 0.5 : 1)
                    }
                    .onGeometryChange(for: Double.self) {
                        $0.size.height
                    } action: {
                        controlsHeight = $0
                    }
                #endif
            }
            .scrollBounceBehavior(.basedOnSize)
            .onGeometryChange(for: CGFloat.self) {
                $0.frame(in: .named(PracticeSwipe.space)).minY
            } action: {
                controlsTop = $0
            }
            // Laid out first, so it takes its natural height and the waveform the rest; only once
            // the waveform is at its floor does this region shrink and scroll.
            .frame(maxHeight: controlsHeight.map { CGFloat($0) })
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: {
                controlsRegionHeight = $0
            }
            .layoutPriority(1)
        }
        #if os(macOS)
            .padding([.horizontal, .bottom], MacStyle.pageMargin)
            .padding(.top, MacStyle.headingGap)
        #else
            .padding(16)
            .modifier(PadPracticeWidth())
        #endif
        // The keyboard covers the controls rather than squeezing the waveform, so opening a name
        // field leaves the waveform as it is.
        .ignoresSafeArea(.keyboard)
        .focusable()
        .focusEffectDisabled()
        .focused($focus, equals: .screen)
        .defaultFocus($focus, .screen)
        .modifier(
            PracticeKeys(
                model: practice, focus: $focus, isBlocked: disabledReason != nil, onDeleted: focusWaveform,
                onClose: close)
        )
        .onChange(of: focus) { _, _ in practice.commitNudge() }
        .preference(key: PracticeSpareHeight.self, value: showsReadingPane ? practiceSpareHeight : nil)
    }

    /// The height practice could give up before the controls under the waveform clip, or how
    /// much more it needs when negative: the waveform's room above its floor, less what the
    /// controls region lacks of its natural height.
    private var practiceSpareHeight: CGFloat? {
        guard let waveformHeight, let controlsRegionHeight, let controlsHeight else { return nil }
        return waveformHeight - PracticeLayout.waveformFloor(isCompactHeight: isCompactHeight)
            + controlsRegionHeight - CGFloat(controlsHeight)
    }

    /// The waveform, which takes the height the controls leave, down to its floor.
    private func waveform(_ practice: PracticeModel, disabledReason: String?) -> some View {
        PracticeWaveform(
            model: practice, peaks: shownPeaks, focus: $focus, accessibilityFocus: $waveformFocused
        )
        .disabled(disabledReason != nil)
        .opacity(disabledReason != nil ? 0.5 : 1)
        .frame(minHeight: PracticeLayout.waveformFloor(isCompactHeight: isCompactHeight), maxHeight: .infinity)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            waveformHeight = $0
        }
    }

    #if os(macOS)
        /// The stage: a card holding the overview, the waveform with its zoom over the corner,
        /// and the readout centered under the playhead with the loop switcher at its line's start.
        private func stage(_ practice: PracticeModel, disabledReason: String?) -> some View {
            VStack(spacing: 12) {
                OverviewStrip(model: practice, peaks: shownPeaks)
                    .disabled(disabledReason != nil)
                    .opacity(disabledReason != nil ? 0.5 : 1)
                waveform(practice, disabledReason: disabledReason)
                    // Outside the dimming, so the zoom keeps its strength beside a blocked wave.
                    .overlay(alignment: .bottomTrailing) {
                        WaveformOverlay(model: practice, disabledReason: disabledReason, showsReadout: false)
                    }
                // The loop switcher leads the readout's line, and an equal flexible slot trails it,
                // so the readout stays centered under the playhead.
                HStack(spacing: 12) {
                    LoopSwitcher(model: practice, disabledReason: disabledReason)
                    // Outside the dimming, so the reason the screen is blocked reads at full strength.
                    PracticeReadout(model: practice, disabledReason: disabledReason)
                        .layoutPriority(1)
                    Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                }
            }
            .padding(16)
            .background(Palette.surface, in: .rect(cornerRadius: MacStyle.stageRadius))
        }

        /// The recording's title as the page's heading, with its date, length, and credits under it.
        private var header: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(player.title ?? "")
                    .contentMask()
                    .font(MacStyle.pageTitle)
                    .tracking(MacStyle.pageTitleTracking)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    let subtitle = Self.headingSubtitle(rows)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .contentMask()
                            .font(MacStyle.body)
                            .monospacedDigit()
                            .foregroundStyle(.textSecondary)
                    }
                    locationControl
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, MacStyle.headingGap)
        }
    #endif

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
        peaks.flatMap { ShownPeaks(rows.recording, peaks: $0.peaks, peaksRev: $0.rev, loudest: $0.loudest) }
    }

    /// The Mac heading's second line: the date, the length, and the credits.
    static func headingSubtitle(_ rows: ScreenRows) -> String {
        let parts = [RecordingText.date(rows.recording), RecordingText.duration(milliseconds: rows.trimmedLengthMs)]
        return (parts.compactMap { $0 } + RecordingScreenText.credits(rows.recording, place: nil))
            .joined(separator: " · ")
    }

    private var screenUnavailableReason: String? {
        RecordingScreenText.screenUnavailableReason(
            file: rows.file, downloading: transfers?.isDownloading(rows.recording.id) == true)
    }

    /// Whether the plan lets recordings play, which practice and trim need.
    private var recordingsPlay: Bool { plan.recordingsPlay }

    private var trimDisabledReason: String? {
        let downloading = transfers?.isDownloading(rows.recording.id) == true
        return RecordingScreenText.trimDisabledReason(
            rows.recording, file: rows.file, audio: downloading ? .fetching : player.recordingAudio,
            offline: session?.isOffline == true)
    }

    private var menu: some View {
        let view = rows.view
        return Menu {
            ForEach(
                RecordingMenuItem.items(
                    inTune: view.tuneID != nil, trimDisabledReason: trimDisabledReason,
                    openOrigin: RecordingMenuItem.openOrigin(for: rows.recording), trims: recordingsPlay),
                id: \.self
            ) { item in
                if item == .delete { Divider() }
                Button(role: item == .delete ? .destructive : nil) {
                    trimNotice = nil
                    choose(item, view)
                } label: {
                    Label {
                        Text(item.label)
                        if let reason = item.disabledReason { Text(reason) }
                    } icon: {
                        Image(systemName: item.systemImage)
                    }
                }
                .disabled(item.disabledReason != nil)
            }
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                .labelStyle(.iconOnly)
        }
        .help(TuneScreen.moreActions)
    }

    private func edit(_ view: RecordingView, page: EditRecordingPage?) {
        editingPage = page
        editing = view
    }

    /// The control that opens the edit sheet on its location page, absent while the recording has no
    /// shown location.
    @ViewBuilder private var locationControl: some View {
        if let name = rows.shownPlace, let label = RecordingScreenText.editLocation(name) {
            #if os(iOS)
                // A bar's subtitle cannot hold a button, so the control sits in the toolbar, named
                // for the location it opens.
                Button {
                    edit(rows.view, page: .location)
                } label: {
                    Label(label, systemImage: "location")
                }
                .help(label)
            #else
                Button {
                    edit(rows.view, page: .location)
                } label: {
                    Label {
                        Text(name).contentMask()
                    } icon: {
                        Image(systemName: "location").imageScale(.small).accessibilityHidden(true)
                    }
                }
                .buttonStyle(.mac(.quiet))
                .accessibilityLabel(label)
                .help(label)
            #endif
        }
    }

    private func choose(_ item: RecordingMenuItem, _ view: RecordingView) {
        switch item {
        case .trim: openTrim()
        case .edit: edit(view, page: nil)
        case .addToTune: filing = view
        case .removeFromTune: removeFromTune()
        case .openOrigin(_, let page): openURL(page)
        case .delete: deleting = view
        }
    }

    /// Makes the screen's model once the commands it writes through are at hand, and carries on
    /// the visit, which showing again after the trim screen leaves as it was.
    private func openPractice() {
        guard recordingsPlay else { return }
        if practice == nil, let commands {
            let model = PracticeModel(
                player: player, recording: rows.recording, file: rows.file, writer: .commands(commands), mode: mode)
            model.partStructure = rows.partStructure
            practice = model
        }
        practice?.enter(screen: screen)
    }

    private func openTrim() {
        guard recordingsPlay, path.isEmpty, trimDisabledReason == nil, let commands else { return }
        let id = rows.recording.id
        let model = TrimModel(
            recording: rows.recording, file: rows.file,
            write: { try await commands.updateRecording($0, trimStartMs: .value($1), trimEndMs: .value($2)) },
            hold: { [player] in player.hold(id, $0) }, analytics: player.analytics)
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
        // With no store there is nothing to load, so peaks given at init stay.
        guard let store else { return }
        let file = rows.file
        if let data = store.localPeaks(file), let parsed = try? Peaks(file: data) {
            peaks = LoadedPeaks(peaks: parsed, rev: file?.peaksRev)
        } else {
            peaks = nil
        }
        guard let rowRev = rows.recording.peaksRev, file?.peaksRev != rowRev else { return }
        _ = await engine?.peaks(rows.recording.id)
    }

    private func removeFromTune() {
        let recording = rows.recording
        Task {
            if await run({ try await $0.updateRecording(recording.id, tuneID: .value(nil)) }) {
                player.analytics.recordingUnfiled(recording)
            }
        }
    }

    /// Creates the tune the add to tune sheet asked for and files this recording under it, then
    /// closes practice and opens the tune, as going to a recording's tune does. A refused filing
    /// still opens the tune it made, with the refusal in the window's banner, since this screen
    /// is closing.
    private func openCreated() {
        guard let creating, let commands else { return }
        self.creating = nil
        let recordingID = rows.recording.id
        let analytics = player.analytics
        Task {
            failure = nil
            do {
                let created = try await commands.createTitleOnly(
                    title: creating, source: .recordingScreen, recordingID: recordingID, analytics: analytics)
                if created.filingError != nil { addedTune?.notify(AddToTuneModel.failed) }
                openTune?(created.tuneID)
            } catch {
                failure = failureMessage(error)
            }
        }
    }

    /// Deletes through the player, which lets go of the audio first and closes this screen, and
    /// shows a failure on the player bar, which outlasts it.
    private func delete(_ view: RecordingView) {
        guard let commands else { return }
        let recording = view.recording
        let analytics = player.analytics
        Task {
            await player.deleteLoadedRecording {
                try await commands.deleteRecording(view.id)
                analytics.recordingDeleted(recording)
            }
        }
    }

    /// Runs a write on the recording, showing why it failed above the waveform. True when it
    /// landed.
    private func run(_ write: (CrosstuneCommands.Commands) async throws -> Void) async -> Bool {
        guard let commands else { return false }
        failure = nil
        do {
            try await write(commands)
            return true
        } catch {
            failure = failureMessage(error)
            return false
        }
    }
}
