import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// One tune, opened from any tune row: pushed on iPhone, in the detail column on iPad and Mac.
/// Its key and title, its facts, how it sounds, its lyrics and scans, and the musician's notes.
public struct TuneScreen: View {
    public static let fallbackTitle = "Tune"
    public static let gone = "This tune is gone"
    public static let recordingsHeader = "Recordings"
    /// The section that holds a tune's scans and images.
    public static let scansHeader = "Scans and images"
    public static let notesHeader = TuneFieldLabels.notes
    public static let addRecording = "Add recording"
    public static let newRecording = "New recording"
    public static let addLink = "Add link…"
    public static let addToList = "Add to list"
    /// The toolbar menu's item, which opens the list picker.
    public static let addToListItem = "Add to list…"
    public static let openLyrics = "Open lyrics"
    /// More's first item, which opens the whole tune form.
    public static let editAllDetails = "Edit all details"

    /// The form's target for a tune, opened on `focus` when given.
    static func formTarget(_ detail: TuneDetail, focus: TuneFormFocus?) -> TuneFormTarget {
        .edit(tuneID: detail.tune.id, userTuneID: detail.userTune.id, focus: focus)
    }
    /// The add line, which offers the sections a tune lacks: its name, then each action's
    /// name and the words it shows after its plus.
    public static let addToTune = "Add to this tune"
    public static let addScan = "Add scan or image"
    public static let addScanText = "Scan or image"
    public static let addLyrics = "Add lyrics"
    public static let addLyricsText = "Lyrics"
    public static let moreActions = "More actions"
    public static let remove = "Remove"
    public static let addToRecordings = "Add to recordings"

    /// Wide layouts put More on the title's row, as the tune's own control; the phone keeps it
    /// in the bar.
    nonisolated static func moreOnTitleRow(mac: Bool, compactWidth: Bool) -> Bool {
        mac || !compactWidth
    }

    private let tuneID: String

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.plan) private var plan
    @Environment(\.inPadSplit) private var inPadSplit
    @Environment(\.heldDraftChanged) private var heldDraftChanged
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: TuneModel?
    /// The next tune's model while it reads, so the page on screen stays until the next one
    /// can cross-fade over it.
    @State private var arriving: TuneModel?
    /// The tune the new-tune draft on this screen made, whose page replaces the draft.
    @State private var held: HeldDraft?

    public init(tuneID: String) {
        self.tuneID = tuneID
    }

    /// Whether the next tune can replace the page on screen: once it has read, or once its
    /// read has failed, so a failure never leaves the last tune standing.
    nonisolated static func arrivalSettled(phase: TuneModel.Phase, readFailed: Bool) -> Bool {
        phase != .loading || readFailed
    }

    /// The Mac and the iPad's split hold the page on screen until the next tune reads; a page
    /// pushed on the iPhone's stack keeps its push.
    private var holdsPage: Bool {
        #if os(macOS)
            true
        #else
            inPadSplit
        #endif
    }

    private var arrivalAnimation: Animation? {
        #if os(macOS)
            reduceMotion ? nil : .spring(duration: 0.25)
        #else
            PhoneMotion.resolve(reduceMotion: reduceMotion).animation(.spring(duration: 0.25))
        #endif
    }

    public var body: some View {
        Group {
            if let source = NewTuneDraft.source(of: tuneID) {
                NewTuneScreen(source: source) { held = $0 }
                    // Each draft starts empty with its own source, as the menu's New tune over the
                    // catalog's draft does.
                    .id(tuneID)
            } else if holdsPage {
                heldPage
            } else {
                pushedPage
            }
        }
        .task(id: tuneID) { load() }
        .onChange(of: held, initial: true) { heldDraftChanged?(held) }
        .onChange(of: plan.map(ObjectIdentifier.init), initial: true) { followPlan() }
    }

    private var heldPage: some View {
        ZStack {
            if let model {
                content(model)
                    // The page on screen stays while the next tune reads, but its actions
                    // would act on the tune being left.
                    .environment(\.tunePageLeaving, arriving != nil)
                    // A new tune starts with fresh sheets and dialogs, so switching tunes
                    // never carries one over.
                    .id(model.tuneID)
                    .transition(PageFade())
            } else if let held = heldDraft {
                HeldDraftPage(held: held)
            }
        }
        .onChange(
            of: arriving.map { Self.arrivalSettled(phase: $0.phase, readFailed: $0.readFailed) }, initial: true
        ) {
            guard let arriving, Self.arrivalSettled(phase: arriving.phase, readFailed: arriving.readFailed)
            else { return }
            // The page a draft became shows in the draft's place, with nothing to fade.
            let animation = held?.tuneID == arriving.tuneID ? nil : arrivalAnimation
            withAnimation(animation) { model = arriving }
            self.arriving = nil
        }
    }

    @ViewBuilder private var pushedPage: some View {
        if let model, model.tuneID == tuneID,
            heldDraft == nil || Self.arrivalSettled(phase: model.phase, readFailed: model.readFailed)
        {
            content(model)
                // A new tune starts with fresh sheets and dialogs, so switching tunes in the
                // detail column never carries one over.
                .id(tuneID)
        } else if let held = heldDraft {
            HeldDraftPage(held: held)
        } else {
            // Loading is silence.
            Color.clear
        }
    }

    /// The draft this screen showed, while its tune is the one on show.
    private var heldDraft: HeldDraft? {
        held.flatMap { $0.tuneID == tuneID ? $0 : nil }
    }

    private func content(_ model: TuneModel) -> some View {
        let held = held.flatMap { $0.tuneID == model.tuneID ? $0 : nil }
        return TuneContent(model: model, draftLayout: held?.factsLayout)
            .environment(\.focusesKeyTile, held?.created.byReturn == true)
    }

    /// The held draft while `tuneID` is still its tune, nil once the screen shows anything else,
    /// so a tune opened again later arrives as any page does.
    nonisolated static func keptHeld(_ held: HeldDraft?, showing tuneID: String) -> HeldDraft? {
        held?.tuneID == tuneID ? held : nil
    }

    private func load() {
        held = Self.keptHeld(held, showing: tuneID)
        guard let store else { return }
        guard NewTuneDraft.source(of: tuneID) == nil else {
            // The draft stands alone, so no page from before it shows again as its tune reads.
            model = nil
            arriving = nil
            return
        }
        let next = TuneModel(store: store, tuneID: tuneID, analytics: analytics, plan: plan)
        if holdsPage { arriving = next } else { model = next }
    }

    /// The plan is replaced when the account changes, which may come after the model was made.
    private func followPlan() {
        model?.scans.plan = plan
        arriving?.scans.plan = plan
    }
}

extension EnvironmentValues {
    /// True while the next tune reads under the page on screen.
    @Entry var tunePageLeaving = false
    /// Told the new-tune draft a tune screen holds whenever it changes, nil once it holds none,
    /// so a test can watch how long a draft's title lasts.
    @Entry var heldDraftChanged: HeldDraftWatch?
}

/// Hears the new-tune draft a tune screen holds. Equal only to itself, so the environment
/// compares it rather than a closure, which it cannot.
struct HeldDraftWatch: Equatable {
    private let id = UUID()
    private let heard: @MainActor (HeldDraft?) -> Void

    init(_ heard: @escaping @MainActor (HeldDraft?) -> Void) {
        self.heard = heard
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id
    }

    @MainActor func callAsFunction(_ held: HeldDraft?) {
        heard(held)
    }
}

/// A page's cross-fade. The page fading out takes no hits, so a tap during the fade lands on
/// the arriving page.
private struct PageFade: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content
            .opacity(phase.isIdentity ? 1 : 0)
            .allowsHitTesting(phase.isIdentity)
    }
}

private struct TuneContent: View {
    let model: TuneModel
    /// The layout the new-tune draft this page replaces read, nil for any other page.
    var draftLayout: FactsLayout?

    @Environment(\.detailTune) private var detailTune
    @Environment(\.spacing) private var spacing
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    #if DEBUG
        @Environment(\.tuneScreenActions) private var actions
    #endif
    @State private var form: TuneFormTarget?
    @State private var confirmsDelete = false
    /// Whether this visit's screen view is sent, so a page back from a failed delete is not
    /// counted again.
    // periphery:ignore - read through its binding
    @State private var visited = false
    @Environment(\.tunePageLeaving) private var leaving
    @Environment(AddedTuneOffer.self) private var addedTune: AddedTuneOffer?
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        page
            // The Added banner's Undo deleted this tune, which leaves the musician where they were.
            .onChange(of: addedTune?.undone) { _, undone in
                if undone == model.tuneID { leave() }
            }
    }

    @ViewBuilder private var page: some View {
        switch model.phase {
        case .loading:
            if model.readFailed {
                ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
                    .navigationTitle(TuneScreen.fallbackTitle)
            } else {
                Color.clear
            }
        case .gone:
            ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
                .navigationTitle(TuneScreen.fallbackTitle)
        case .deleting(let title):
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                Text(DeleteTuneMessage.deleting)
                    .font(.platform(.footnote))
                    .foregroundStyle(.inkSecondary)
                if let failure = model.failure(at: .screen) {
                    FailureText(failure)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
            .navigationTitle(title)
        case .shown(let detail):
            TunePage(
                model: model, detail: detail, draftLayout: draftLayout,
                more: moreOnPage ? moreHandlers(detail) : nil, onAddLyrics: { addLyrics(detail) }
            )
            .screenView(.tune, visit: $visited, stillShown: { model.phase.isShown })
            .modifier(RefreshesBySync(engine: engine))
            .navigationTitle(detail.tune.title)
            #if os(macOS)
                // Empty, so the page's title keeps the baseline every column's title shares.
                .paneBar {}
            #else
                .toolbar {
                    if !moreOnPage { toolbar(detail) }
                }
            #endif
            .sheet(item: $form) { target in
                TuneFormSheet(target: target) { _ in }
            }
            .coversShell(confirmsDelete)
            .confirmationDialog(detail.deleteTitle, isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button(DeleteTuneMessage.delete, role: .destructive) {
                    Task {
                        if await model.delete() { leave() }
                    }
                }
            } message: {
                Text(detail.deleteMessage)
            }
            #if DEBUG
                .modifier(
                    OpensTuneSurfaces(detail: detail, actions: actions, edit: { edit(detail) }) {
                        confirmsDelete = true
                    })
            #endif
        }
    }

    private var moreOnPage: Bool {
        #if os(macOS)
            TuneScreen.moreOnTitleRow(mac: true, compactWidth: false)
        #else
            TuneScreen.moreOnTitleRow(mac: false, compactWidth: sizeClass == .compact)
        #endif
    }

    private func moreHandlers(_ detail: TuneDetail) -> TuneMoreHandlers {
        TuneMoreHandlers(editAll: { edit(detail) }, delete: { confirmsDelete = true })
    }

    #if os(iOS)
        @ToolbarContentBuilder private func toolbar(_ detail: TuneDetail) -> some ToolbarContent {
            ToolbarItem(placement: .primaryAction) {
                TuneMoreMenu(
                    model: model, detail: detail, onEditAll: { edit(detail) }, onDelete: { confirmsDelete = true }
                )
                .disabled(leaving)
            }
        }
    #endif

    private func edit(_ detail: TuneDetail) {
        form = TuneScreen.formTarget(detail, focus: nil)
    }

    private func addLyrics(_ detail: TuneDetail) {
        form = TuneScreen.formTarget(detail, focus: .lyrics)
    }

    /// Leaves a deleted tune: back to the screen that pushed it, or an empty detail column.
    private func leave() {
        if let detailTune {
            detailTune.value = nil
        } else {
            dismiss()
        }
    }
}

#if DEBUG
    /// Opens the surface the sample launch names from the tune page, by the page's own actions.
    private struct OpensTuneSurfaces: ViewModifier {
        let detail: TuneDetail
        let actions: TuneScreenActions
        let edit: @MainActor () -> Void
        let delete: @MainActor () -> Void

        func body(content: Content) -> some View {
            let tuneID = detail.tune.id
            content
                .opensForSample(.tuneEdit, edit)
                .opensForSample(.deleteTune, delete)
                .opensForSample(.listPicker) { actions.addToList?(detail.userTune.id) }
                .opensForSample(.link) { actions.addLink?(tuneID) }
                .opensForSample(.findRecordings) { actions.findRecordings?(tuneID, nil) }
                .opensForSample(.lyrics) { actions.readLyrics?(tuneID) }
                .opensForSample(.scans) { actions.viewScans?(tuneID, 0, .tune) }
        }
    }
#endif

/// More actions, on the title's row on wide layouts and in the bar on the phone: Edit all
/// details, Add to list, Archive or Unarchive, and Delete after a separator.
struct TuneMoreMenu: View {
    let model: TuneModel
    let detail: TuneDetail
    let onEditAll: () -> Void
    let onDelete: () -> Void

    @Environment(\.tuneScreenActions) private var actions

    enum Entry: Hashable {
        case editAll
        case addToList
        case archive(archived: Bool)
        case delete
    }

    /// The menu's items in order, leaving out Add to list where there is no list picker to open.
    nonisolated static func entries(archived: Bool, canAddToList: Bool) -> [Entry] {
        [.editAll] + (canAddToList ? [.addToList] : []) + [.archive(archived: archived), .delete]
    }

    var body: some View {
        let archived = detail.isArchived
        Menu {
            ForEach(Self.entries(archived: archived, canAddToList: actions.addToList != nil), id: \.self) { entry in
                switch entry {
                case .editAll:
                    Button(TuneScreen.editAllDetails, systemImage: "pencil", action: onEditAll)
                case .addToList:
                    Button(TuneScreen.addToListItem, systemImage: "text.badge.plus") {
                        actions.addToList?(detail.userTune.id)
                    }
                case .archive(let archived):
                    Button(
                        TuneRowActions.archiveLabel(archived: archived),
                        systemImage: TuneRowActions.archiveSystemImage(archived: archived)
                    ) {
                        Task { await model.setArchived(!archived) }
                    }
                case .delete:
                    Divider()
                    Button(DeleteTuneMessage.delete, systemImage: "trash", role: .destructive, action: onDelete)
                }
            }
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                // On the label, since on the menu the style would reach its items too.
                .labelStyle(.iconOnly)
        }
        #if os(macOS)
            .help(TuneScreen.moreActions)
        #endif
    }
}

/// More's items the screen carries out, for a More drawn on the page.
struct TuneMoreHandlers {
    let editAll: () -> Void
    let delete: () -> Void
}

/// The tune page's sheets and confirmations, presented from the page's own state.
struct TunePresentations: ViewModifier {
    let model: TuneModel
    @Binding var editing: RecordingView?
    @Binding var deleting: RecordingView?
    @Binding var addingScans: ScanAddChoice?
    @Binding var deletingScan: Scan?

    @Environment(PlayerModel.self) private var player: PlayerModel?

    func body(content: Content) -> some View {
        content
            .sheet(item: $editing) { view in
                EditRecordingSheet(view: view)
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
            .modifier(
                ScanImport(
                    choice: $addingScans,
                    onPick: { picks, via in Task { await model.scans.add(picks, via: via) } },
                    onFailure: { model.scans.report($0) })
            )
            .coversShell(deletingScan != nil)
            .confirmationDialog(
                ScanCopy.deleteTitle,
                isPresented: $deletingScan.isPresent(),
                titleVisibility: .visible, presenting: deletingScan
            ) { scan in
                Button(ScanCopy.delete, role: .destructive) {
                    Task { await model.scans.delete(scan.id) }
                }
            } message: { scan in
                Text(ScanCopy.deleteMessage(scan))
            }
            .onChange(of: model.scans.announcement) { _, announcement in
                if let announcement { AccessibilityNotification.Announcement(announcement.text).post() }
            }
    }

    private func delete(_ view: RecordingView) {
        // The player lets go of the audio before its file goes.
        if player?.holds(.recording, id: view.id) == true { player?.close() }
        Task { await model.deleteRecording(view.recording) }
    }
}

/// The Recordings header's add control: record, paste a link, or find a recording.
struct TuneMediaAddMenu: View {
    let model: TuneModel
    let detail: TuneDetail

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.openURL) private var openURL
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?

    var body: some View {
        Menu {
            Button(TuneScreen.newRecording, systemImage: RecordControl.systemImage) {
                actions.record?(detail.tune.id)
            }
            .disabled(actions.record == nil)
            Button(TuneScreen.addLink, systemImage: "link") {
                actions.addLink?(detail.tune.id)
            }
            .disabled(actions.addLink == nil)
            findRecordings
        } label: {
            Label(TuneScreen.addRecording, systemImage: "plus")
                // On the label itself, since on the menu the style would reach its items too.
                .labelStyle(.iconOnly)
        }
        .disabled(actions.record == nil && actions.addLink == nil && actions.findRecordings == nil)
        #if os(macOS)
            .help(TuneScreen.addRecording)
        #endif
    }

    /// Refused rather than disabled while offline, so the item keeps its name and its reason
    /// shows beneath it.
    private var findRecordings: some View {
        let offline = session?.isOffline ?? false
        let entry = FindRecordingsEntry(providers: detail.searchProviders)
        return Button {
            model.findRecordings(
                entry, for: detail, offline: offline, engine: engine, openSheet: actions.findRecordings,
                open: { openURL($0) })
        } label: {
            Label {
                Text(entry.label)
                if offline { Text(FindRecordingsModel.searchNeedsConnection) }
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        }
        .disabled(entry.isDisabled(sheetAvailable: actions.findRecordings != nil))
    }
}

/// The tune's recordings, then its links, one row each with its context actions.
struct TuneMediaRows: View {
    let model: TuneModel
    let detail: TuneDetail
    @Binding var editing: RecordingView?
    @Binding var deleting: RecordingView?

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openURL) private var openURL
    @Environment(\.premium) private var premium
    @Environment(\.plan) private var plan
    /// Whether a free plan's recordings line is open to the rows below it, for this visit only.
    @State private var showsRecordings = false

    var body: some View {
        let collapses = !plan.recordingsPlay && !detail.recordings.isEmpty
        #if os(macOS)
            if blocksPlay(showsRecordings: !collapses || showsRecordings) {
                Text(MediaText.stopRecordingToPlay)
                    .font(MacStyle.secondary)
                    .foregroundStyle(Palette.inkSecondary)
            }
        #endif
        if collapses {
            RecordingsLine(count: detail.recordings.count, isExpanded: $showsRecordings)
        }
        if !collapses || showsRecordings {
            #if os(macOS)
                ForEach(detail.recordings) { recording in
                    recordingRow(recording)
                }
            #else
                SwipeRows(data: detail.recordings, rowGap: TunePageColumn.mediaRowGap) { recording in
                    recordingRow(recording)
                }
            #endif
        }
        ForEach(detail.links) { link in
            linkRow(link)
        }
    }

    #if os(macOS)
        /// Whether a take under way stands a shown row's play down, which the Mac says once
        /// above the rows rather than under each.
        private func blocksPlay(showsRecordings: Bool) -> Bool {
            guard recorders?.isCapturing == true else { return false }
            let recording =
                showsRecordings
                && detail.recordings.contains { entry in
                    RecordingRowContent.blocksPlay(
                        entry.recording, file: entry.file,
                        loaded: player?.holds(.recording, id: entry.recording.id) ?? false,
                        downloading: transfers?.isDownloading(entry.recording.id) ?? false)
                }
            return recording
                || detail.links.contains { link in
                    LinkRowContent(
                        link: link, embeddable: Embed.for(link) != nil,
                        loaded: player?.holds(.link, id: link.id) ?? false, playBlocked: true
                    ).notice != nil
                }
        }
    #endif

    private func recordingRow(_ entry: TuneRecording) -> some View {
        let view = RecordingView(
            recording: entry.recording, file: entry.file, tuneID: detail.tune.id, tuneTitle: detail.tune.title)
        // The screen's own title above already names the tune.
        let pinned = detail.userTune.playRecordingID == view.id
        return HStack {
            Self.item(view) { kind in retry(view.id, kind) }
            if pinned { PinnedMark() }
        }
        .newTakeHighlight(view.id)
        .recordingRowActions(
            Self.rowHandlers(
                view, pinned: pinned,
                togglePin: { Task { await model.setPlaySource(.recording(id: view.id), pinned: pinned) } },
                open: { openURL($0) }, edit: { editing = view },
                removeFromTune: { Task { await model.unfileRecording(view.recording) } },
                delete: { deleting = view }))
    }

    /// A recording row's actions on the page: every recording here is filed under the tune
    /// being looked at, so it offers Remove from tune but neither Add to tune nor Go to tune.
    static func rowHandlers(
        _ view: RecordingView, pinned: Bool, togglePin: @escaping () -> Void, open: @escaping (URL) -> Void,
        edit: @escaping () -> Void, removeFromTune: @escaping () -> Void, delete: @escaping () -> Void
    ) -> RecordingRowHandlers {
        RecordingRowHandlers(
            filed: true, pinned: pinned, onTogglePin: togglePin,
            originLabel: RecordingText.originLabel(view.recording.origin),
            onOpenOrigin: RecordingRowActions.originPage(view.recording).map { page in { open(page) } },
            onEdit: edit, onAddToTune: nil, onRemoveFromTune: removeFromTune, onDelete: delete)
    }

    /// A recording's row on the page. A free plan shows it only under the recordings line, so
    /// its tap is reported as coming from the line.
    static func item(_ view: RecordingView, onRetry: @escaping (RecordingText.Retry) -> Void) -> RecordingItem {
        RecordingItem(view: view, source: .tune, tuneNamedAbove: true, premiumEntry: .recordingsLine, onRetry: onRetry)
    }

    private func retry(_ recordingID: String, _ kind: RecordingText.Retry) {
        guard let transfers else { return }
        Task { await model.runMediaAction { try await transfers.retry(recordingID, kind) } }
    }

    private func linkRow(_ link: RecordingLink) -> some View {
        let row = LinkRowContent(
            link: link, embeddable: Embed.for(link) != nil, loaded: player?.holds(.link, id: link.id) ?? false,
            playBlocked: recorders?.isCapturing ?? false)
        let pinned = detail.userTune.playLinkID == link.id
        let togglePin: () -> Void = { Task { await model.setPlaySource(.link(id: link.id), pinned: pinned) } }
        let remove = Button(TuneScreen.remove, systemImage: "trash", role: .destructive) {
            Task { await model.removeLink(link.id) }
        }
        let addToRecordings: (() -> Void)? =
            canAddToRecordings(link: link, recordings: detail.recordings.map(\.recording))
            ? {
                guard premium?.gate(.recordings, from: .addToRecordings) ?? true else { return }
                Task { await model.addRecordingFromLink(link.id) }
            } : nil
        return HStack {
            MediaRow(link: row) { tap in
                switch tap {
                case .play: if let item = PlayerItem.link(link) { player?.play(item, origin: .row, source: .tune) }
                case .close: player?.close()
                case .open(let url):
                    model.reportOpened(link)
                    openURL(url)
                }
            }
            .environment(
                \.openURL,
                OpenURLAction { url in
                    model.reportOpened(link)
                    return .systemAction
                })
            if pinned { PinnedMark() }
        }
        .contextMenu {
            PinAction(pinned: pinned, onTogglePin: togglePin)
            if let addToRecordings {
                Button(TuneScreen.addToRecordings, systemImage: "square.and.arrow.down", action: addToRecordings)
            }
            remove
        }
    }
}
