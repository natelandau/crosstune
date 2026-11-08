import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import CrosstuneSync
import Observation
import SwiftUI

/// Where a recording page sits, and how it goes away.
struct RecordingPageParent {
    /// Whether the page shows its own Close, where no Back leads away from it, as in a detail
    /// column.
    let showsClose: Bool
    /// Takes the page away, back to what it was opened over: the Close, and a recording that is
    /// deleted while the page is open.
    let leave: @MainActor () -> Void
}

/// A recording's own page, which belongs to the recording it was opened for, not to the player:
/// opening it never changes playback, and Play on it loads the recording. Playback its Play
/// starts belongs to the page, which stops it as it leaves; see ``PlayerModel/pagePlays(in:)``.
/// A compact page shows Practice and Details as tabs under its header; a wide one shows practice
/// with the attributes column beside it. On iPhone and a compact iPad it is pushed on the tab's
/// stack; on a regular iPad and on the Mac it fills the detail column.
struct RecordingPage: View {
    let recordingID: String
    let parent: RecordingPageParent

    /// Where the Plan sheet reports it was opened from, for every blocked play on the page.
    static let planEntry = PremiumEntry.recordingPage

    var body: some View {
        // A page for another recording is another page, with its own state.
        RecordingPageContent(recordingID: recordingID, parent: parent)
            .id(recordingID)
    }
}

private struct RecordingPageContent: View {
    let recordingID: String
    let parent: RecordingPageParent

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(PlayerModel.self) private var player: PlayerModel?
    /// Made once the store is at hand, so a pass that rebuilds this view makes no model.
    @State private var model: RecordingPageModel?

    var body: some View {
        Group {
            if let model, let rows = model.rows, let player {
                RecordingPageBody(model: model, rows: rows, player: player)
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        .screenView(.recording)
        .task(id: store.map(ObjectIdentifier.init)) {
            guard let store else { return }
            let model = model ?? RecordingPageModel(recordingID: recordingID, parent: parent, analytics: analytics)
            self.model = model
            model.follow(store)
        }
    }
}

/// The page once its recording's rows have been read.
private struct RecordingPageBody: View {
    @Bindable var model: RecordingPageModel
    let rows: ScreenRows
    let player: PlayerModel

    @Environment(\.store) private var store
    @Environment(\.commands) private var commands
    @Environment(\.plan) private var plan
    @Environment(\.premium) private var premium
    @Environment(\.inPadSplit) private var inPadSplit
    @Environment(\.openURL) private var openURL
    @Environment(\.openTune) private var openTune
    @Environment(\.openRecordingPage) private var openRecordingPage
    @Environment(\.playerWindow) private var window
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @State private var tab = RecordingPageTab.practice
    @State private var width: CGFloat?
    @State private var practice: PracticeModel?

    private struct PeaksKey: Equatable {
        let fileName: String?
        let fileRev: String?
        let rowRev: String?
    }

    private var recordingsPlay: Bool { plan.recordingsPlay }

    private var blockedReason: String? { RecordingPageArrangement.playBlockedReason(recordingsPlay: recordingsPlay) }

    private var allowsWide: Bool {
        #if os(macOS)
            true
        #else
            inPadSplit
        #endif
    }

    private func layout(width: CGFloat, tab: RecordingPageTab? = nil) -> RecordingPageLayout {
        RecordingPageArrangement.layout(
            width: width, allowsWide: allowsWide, tab: tab ?? self.tab, recordingsPlay: recordingsPlay)
    }

    /// Takes a request for this page still to report: shows the tab it asks for, and reports the open in the layout that shows.
    private func takeOpen(width: CGFloat) {
        guard let open = openRecordingPage?.takeUnreported(of: model.recordingID) else { return }
        if let requested = open.tab { tab = requested }
        model.reportOpen(open, layout: layout(width: width, tab: open.tab))
    }

    private var title: String { RecordingText.title(rows.recording, tuneTitle: rows.tuneTitle) }

    var body: some View {
        Color.clear
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .overlay {
                if let width {
                    let shown = layout(width: width)
                    arranged(shown)
                        .modifier(PracticePageFill(fillsPage: shown == .practice))
                        .onChange(of: openRecordingPage?.unreported, initial: true) { takeOpen(width: width) }
                }
            }
            .navigationTitle(title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        RecordingPageBarHeader(title: title, subtitle: model.subtitle)
                    }
                    if model.parent.showsClose {
                        ToolbarItem(placement: .cancellationAction) {
                            Button {
                                model.parent.leave()
                            } label: {
                                Label(RecordingScreenText.close, systemImage: "xmark")
                            }
                            .help(RecordingScreenText.close)
                            // Escape belongs to practice's chain, which closes the name field and
                            // deselects before it closes the page.
                            .keyboardShortcut(nil)
                        }
                    }
                    ToolbarItem(placement: .primaryAction) { menu }
                }
            #else
                // The heading in the content shows the title, so the toolbar does not show it twice.
                .toolbar(removing: .title)
                .paneBar {
                    if model.parent.showsClose {
                        Button(RecordingScreenText.close) { model.parent.leave() }
                        .buttonStyle(.macSecondary)
                        .help(RecordingScreenText.close)
                    }
                    menu
                }
            #endif
            .navigationDestination(item: $model.route) { route in
                Group {
                    switch route {
                    case .trim:
                        if let trim = model.trim {
                            TrimScreen(model: trim, player: player, peaks: shownPeaks, onDone: model.leaveEditor)
                                .modifier(PracticePageFill(fillsPage: true))
                        }
                    case .split:
                        if let split = model.split {
                            SplitScreen(model: split, player: player, peaks: shownPeaks, onDone: model.leaveEditor)
                                .modifier(PracticePageFill(fillsPage: true))
                        }
                    }
                }
                .onAppear { model.shown(.editor, on: player, window: window, practice: practice) }
                .onDisappear { model.hidden(.editor) }
            }
            .onAppear {
                makePractice()
                model.shown(.page, on: player, window: window, practice: practice)
            }
            .onChange(of: recordingsPlay) { _, _ in makePractice() }
            // The shell's commands can arrive after the page first shows.
            .onChange(of: commands == nil) { _, _ in makePractice() }
            // Play on the page loads the recording, and the visit starts with it.
            .onChange(of: practice?.isCurrent == true) { _, isCurrent in
                if isCurrent { model.openVisit(practice) }
                practice?.currentChanged()
            }
            .onChange(of: model.route == nil) { _, isEmpty in
                // However the trim or split screen went, back swipe included, it holds nothing after.
                guard isEmpty else { return }
                model.closeEditors()
            }
            // Making the practice follows the rows first read, so only a change follows here.
            .onChange(of: rows) { _, rows in follow(rows) }
            // True once a trim from elsewhere has landed, and a save under way has finished.
            .onChange(of: model.trim?.mustGiveWay == true || model.split?.mustGiveWay == true) { _, mustGiveWay in
                guard mustGiveWay else { return }
                model.editorGaveWay()
            }
            .task(
                id: PeaksKey(
                    fileName: rows.file?.peaksFileName, fileRev: rows.file?.peaksRev, rowRev: rows.recording.peaksRev)
            ) {
                guard let store else { return }
                await model.loadPeaks(rows, store: store, engine: engine)
            }
            .onDisappear {
                practice?.flushOwnSettings()
                player.flushSettings()
                model.hidden(.page)
            }
            .coversShell(model.deleting != nil)
            .confirmationDialog(
                RecordingsModel.deleteTitle, item: $model.deleting, titleVisibility: .visible
            ) { view in
                Button(RecordingRowActions.delete, role: .destructive) {
                    model.delete(view, commands: commands, player: player)
                }
            } message: { view in
                Text(RecordingsModel.deleteMessage(view))
            }
    }

    @ViewBuilder private func arranged(_ layout: RecordingPageLayout) -> some View {
        VStack(spacing: 0) {
            #if os(macOS)
                RecordingPageHeader(title: title, subtitle: model.subtitle)
            #endif
            if RecordingPageArrangement.showsTabs(layout) {
                RecordingPageTabPicker(tab: $tab, recordingsPlay: recordingsPlay, onBlocked: offerPlan)
                if layout == .practice {
                    practiceArea
                } else {
                    RecordingDetailsTab(
                        practice: practice, rows: rows, player: player, notice: model.pageNotice,
                        blockedReason: blockedReason, unavailableReason: unavailableReason, onBlocked: offerPlan
                    ) {
                        attributes(.card)
                    }
                }
            } else {
                HStack(alignment: .top, spacing: PageStyle.attributesColumnGap) {
                    practiceArea
                        .frame(minWidth: RecordingScreen.minimumWidth, maxWidth: .infinity)
                    ScrollView {
                        attributes(.column)
                            .padding(.top, 16)
                    }
                    .frame(width: PageStyle.attributesColumnWidth)
                }
            }
        }
    }

    private var practiceArea: some View {
        RecordingPracticeArea(
            practice: practice, rows: rows, peaks: shownPeaks, notice: model.pageNotice,
            blockedReason: blockedReason, unavailableReason: unavailableReason, onBlocked: offerPlan,
            onClose: { if model.parent.showsClose { model.parent.leave() } })
    }

    @ViewBuilder private func attributes(_ layout: AttributesLayout) -> some View {
        if let fields = model.fields {
            RecordingPageAttributes(
                rows: rows, attributeRows: model.attributeRows, fields: fields, layout: layout, onGoToTune: goToTune)
        }
    }

    /// Opens the recording's tune, from the Tune row's editor and the menu.
    private var goToTune: (() -> Void)? {
        guard let tuneID = rows.tuneID, let openTune else { return nil }
        return { openTune(tuneID) }
    }

    /// Why the recording cannot load or play now: for one the player holds, its audio's state;
    /// for one it does not, what stops Play loading it.
    private var unavailableReason: String? {
        guard let practice else { return nil }
        let downloading = transfers?.isDownloading(rows.recording.id) == true
        let offline = session?.isOffline == true
        guard practice.isCurrent else {
            return RecordingScreenText.loadUnavailableReason(
                rows.recording, file: rows.file, downloading: downloading, offline: offline)
        }
        return RecordingScreenText.screenUnavailableReason(file: rows.file, downloading: downloading)
            ?? RecordingPlayerText.status(player.recordingAudio, hasFailed: player.audio.hasFailed, offline: offline)
    }

    private var shownPeaks: ShownPeaks? { model.shownPeaks(rows.recording) }

    private func offerPlan() {
        _ = premium?.gate(.recordings, from: RecordingPage.planEntry)
    }

    /// Makes the page's practice once the commands it writes through are at hand and the plan
    /// lets recordings play; a plan that stops them takes it away.
    private func makePractice() {
        guard recordingsPlay else {
            practice?.leave()
            practice = nil
            model.closeVisit()
            return
        }
        guard practice == nil, let commands else { return }
        let made = PracticeModel(
            player: player, recording: rows.recording, file: rows.file, writer: .commands(commands),
            page: model.screen)
        practice = made
        follow(rows)
        model.openVisit(made)
    }

    private func follow(_ rows: ScreenRows) {
        guard let practice else { return }
        practice.follow(rows.recording, file: rows.file)
        practice.partStructure = rows.partStructure
        practice.tuneTitle = rows.tuneTitle
        practice.followLoops(rows.loops)
        model.followInEditors(rows)
    }

    // MARK: The menu

    /// The page's audio state, which belongs to the player only while it holds this recording.
    private var audio: RecordingAudio? {
        if transfers?.isDownloading(rows.recording.id) == true { return .fetching }
        return player.holds(.recording, id: rows.recording.id) ? player.recordingAudio : nil
    }

    private var trimDisabledReason: String? {
        RecordingScreenText.trimDisabledReason(
            rows.recording, file: rows.file, audio: audio, offline: session?.isOffline == true)
    }

    private var splitDisabledReason: String? {
        RecordingScreenText.splitDisabledReason(
            rows.recording, file: rows.file, audio: audio, offline: session?.isOffline == true)
    }

    private var menu: some View {
        RecordingPageMenu(
            rows: rows, goesToTune: goToTune != nil, trimDisabledReason: trimDisabledReason,
            splitDisabledReason: splitDisabledReason, recordingsPlay: recordingsPlay
        ) { item in
            model.trimNotice = nil
            choose(item)
        }
    }

    private func choose(_ item: RecordingMenuItem) {
        switch item {
        case .trim:
            model.openTrim(
                rows, disabledReason: trimDisabledReason, recordingsPlay: recordingsPlay, commands: commands,
                player: player)
        case .split:
            model.openSplit(
                rows, disabledReason: splitDisabledReason, recordingsPlay: recordingsPlay, commands: commands,
                player: player)
        case .pin(let pinned): model.togglePin(pinned: pinned, rows: rows, commands: commands)
        case .goToTune: goToTune?()
        case .openOrigin(_, let page): openURL(page)
        case .delete: model.deleting = rows.view
        }
    }
}

extension EnvironmentValues {
    /// Whether the practice view fills the page, as in the Practice tab, rather than sitting
    /// beside the attributes. Sets the practice layout, which never follows the appearance.
    @Entry var practiceIsFullPage = false
}

/// Lays practice out to fill the page in the Practice tab and the trim and split screens on
/// iPhone and iPad. Set where each screen is declared, since a pushed screen takes the stack's
/// environment.
struct PracticePageFill: ViewModifier {
    let fillsPage: Bool

    func body(content: Content) -> some View {
        // One path whichever tab shows, so a switch keeps the page's identity.
        #if os(iOS)
            content
                .environment(\.practiceIsFullPage, fillsPage)
        #else
            content
        #endif
    }
}
