import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// One tune, opened from any tune row: pushed on iPhone, in the detail column on iPad and Mac.
/// What it is, with the musician's status among its facets, how it sounds, the lists it is in, and their notes.
public struct TuneScreen: View {
    public static let fallbackTitle = "Tune"
    public static let gone = "This tune is gone"
    public static let composerLabel = TuneFieldLabels.composer
    public static let recordingsHeader = "Recordings"
    public static let listsHeader = "Lists"
    public static let notesHeader = TuneFieldLabels.notes
    public static let addRecording = "Add recording"
    public static let newRecording = "New recording"
    public static let addLink = "Add link…"
    /// The Lists header's add control, a glyph named in words.
    public static let addToList = "Add to list"
    /// The toolbar menu's item, which opens the list picker.
    public static let addToListItem = "Add to list…"
    public static let notInList = "Not in any list yet."
    public static let openLyrics = "Open lyrics"
    public static let noMediaTitle = "Nothing recorded yet"
    public static let noMediaHint = "Record one, find one, or paste a link to one."
    public static let moreActions = "More actions"
    public static let remove = "Remove"
    public static let addToRecordings = "Add to recordings"

    private let tuneID: String

    @Environment(\.store) private var store
    @State private var model: TuneModel?
    #if os(macOS)
        /// The next tune's model while it reads, so the page on screen stays until the next one
        /// can cross-fade over it.
        @State private var arriving: TuneModel?
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #endif

    public init(tuneID: String) {
        self.tuneID = tuneID
    }

    #if os(macOS)
        /// Whether the next tune can replace the page on screen: once it has read, or once its
        /// read has failed, so a failure never leaves the last tune standing.
        nonisolated static func arrivalSettled(phase: TuneModel.Phase, readFailed: Bool) -> Bool {
            phase != .loading || readFailed
        }
    #endif

    public var body: some View {
        #if os(macOS)
            ZStack {
                if let model {
                    TuneContent(model: model)
                        // The page on screen stays while the next tune reads, but its actions
                        // would act on the tune being left.
                        .environment(\.tunePageLeaving, arriving != nil)
                        // A new tune starts with fresh sheets and dialogs, so switching tunes
                        // never carries one over.
                        .id(model.tuneID)
                        .transition(PageFade())
                }
            }
            .task(id: tuneID) {
                guard let store else { return }
                arriving = TuneModel(store: store, tuneID: tuneID)
            }
            .onChange(
                of: arriving.map { Self.arrivalSettled(phase: $0.phase, readFailed: $0.readFailed) }, initial: true
            ) {
                guard let arriving, Self.arrivalSettled(phase: arriving.phase, readFailed: arriving.readFailed)
                else { return }
                withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { model = arriving }
                self.arriving = nil
            }
        #else
            Group {
                if let model, model.tuneID == tuneID {
                    TuneContent(model: model)
                        // A new tune starts with fresh sheets and dialogs, so switching tunes in the
                        // detail column never carries one over.
                        .id(tuneID)
                } else {
                    // Loading is silence.
                    Color.clear
                }
            }
            .task(id: tuneID) {
                guard let store else { return }
                model = TuneModel(store: store, tuneID: tuneID)
            }
        #endif
    }
}

#if os(macOS)
    extension EnvironmentValues {
        /// True while the next tune reads under the page on screen.
        @Entry var tunePageLeaving = false
    }

    /// A page's cross-fade. The page fading out takes no clicks, so its pane bar never answers
    /// over the arriving page's.
    private struct PageFade: Transition {
        func body(content: Content, phase: TransitionPhase) -> some View {
            content
                .opacity(phase.isIdentity ? 1 : 0)
                .allowsHitTesting(phase.isIdentity)
        }
    }
#endif

private struct TuneContent: View {
    let model: TuneModel

    @Environment(\.detailTune) private var detailTune
    @Environment(\.spacing) private var spacing
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var form: TuneFormTarget?
    @State private var confirmsDelete = false
    #if os(macOS)
        @Environment(\.tunePageLeaving) private var leaving
    #endif

    var body: some View {
        switch model.phase {
        case .loading:
            #if os(macOS)
                if model.readFailed {
                    ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
                        .navigationTitle(TuneScreen.fallbackTitle)
                } else {
                    Color.clear
                }
            #else
                Color.clear
            #endif
        case .gone:
            ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
                .navigationTitle(TuneScreen.fallbackTitle)
        case .deleting(let title):
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                Text(DeleteTuneMessage.deleting)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let failure = model.failure(at: .screen) {
                    FailureText(failure)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // The inset grouped list's content margin, fixed so the text lines up with it.
            .padding(20)
            .navigationTitle(title)
        case .shown(let detail):
            TuneBody(model: model, detail: detail)
                .modifier(RefreshesBySync(engine: engine))
                .navigationTitle(detail.tune.title)
                #if os(macOS)
                    .paneBar {
                        Group {
                            Button(TuneRowActions.edit) {
                                form = .edit(tuneID: detail.tune.id, userTuneID: detail.userTune.id)
                            }
                            TuneMoreMenu(model: model, detail: detail) { confirmsDelete = true }
                        }
                        .disabled(leaving)
                    }
                #else
                    .toolbar { toolbar(detail) }
                #endif
                .sheet(item: $form) { target in
                    TuneFormSheet(target: target) { _ in }
                }
                .coversShell(confirmsDelete)
                .confirmationDialog(DeleteTuneMessage.title, isPresented: $confirmsDelete, titleVisibility: .visible) {
                    Button(DeleteTuneMessage.delete, role: .destructive) {
                        Task {
                            if await model.delete() { leave() }
                        }
                    }
                } message: {
                    Text(detail.deleteMessage)
                }
        }
    }

    @ToolbarContentBuilder private func toolbar(_ detail: TuneDetail) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button(TuneRowActions.edit) {
                form = .edit(tuneID: detail.tune.id, userTuneID: detail.userTune.id)
            }
        }
        ToolbarItem(placement: .primaryAction) {
            TuneMoreMenu(model: model, detail: detail) { confirmsDelete = true }
        }
    }

    /// Leaves a deleted tune: back to the screen that pushed it, or an empty detail column.
    private func leave() {
        if let detailTune {
            detailTune.wrappedValue = nil
        } else {
            dismiss()
        }
    }
}

/// The toolbar's More actions menu: Add to list, Archive or Unarchive, and Delete after a
/// separator.
private struct TuneMoreMenu: View {
    let model: TuneModel
    let detail: TuneDetail
    let onDelete: () -> Void

    @Environment(\.tuneScreenActions) private var actions

    var body: some View {
        let archived = detail.isArchived
        Menu {
            Button(TuneScreen.addToListItem, systemImage: "text.badge.plus") {
                actions.addToList?(detail.userTune.id)
            }
            .disabled(actions.addToList == nil)
            Button(
                TuneRowActions.archiveLabel(archived: archived),
                systemImage: TuneRowActions.archiveSystemImage(archived: archived)
            ) {
                Task { await model.setArchived(!archived) }
            }
            Divider()
            Button(DeleteTuneMessage.delete, systemImage: "trash", role: .destructive, action: onDelete)
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                #if os(macOS)
                    // On the label, since on the menu the style would reach its items too.
                    .labelStyle(.iconOnly)
                #endif
        }
        #if os(macOS)
            .help(TuneScreen.moreActions)
        #endif
    }
}

private struct TuneBody: View {
    let model: TuneModel
    let detail: TuneDetail

    #if os(macOS)
        var body: some View {
            MacTunePage(model: model, detail: detail)
        }
    #else
        @Environment(\.tuneScreenActions) private var actions
        @State private var deleting: RecordingView?
        @State private var editing: RecordingView?
        @State private var addingScans: ScanAddChoice?
        @State private var deletingScan: Scan?
        @Environment(\.spacing) private var spacing

        var body: some View {
            list
                .modifier(
                    TunePresentations(
                        model: model, editing: $editing, deleting: $deleting, addingScans: $addingScans,
                        deletingScan: $deletingScan))
        }

        private var list: some View {
            List {
                Section {
                    TuneHeader(model: model, detail: detail)
                        .listRowInsets(
                            EdgeInsets(top: spacing.rowInset, leading: 4, bottom: spacing.rowInset, trailing: 4)
                        )
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                TuneMediaSection(model: model, detail: detail, editing: $editing, deleting: $deleting)
                ScansSection(
                    model: model.scans, tuneID: detail.tune.id, adding: $addingScans, deleting: $deletingScan)
                if detail.hasLyrics {
                    Section {
                        Button(TuneScreen.openLyrics, systemImage: "text.quote") {
                            actions.readLyrics?(detail.tune.id)
                        }
                        .disabled(actions.readLyrics == nil)
                    }
                }
                TuneListsSection(model: model, detail: detail)
                if detail.notes != nil || detail.learned() != nil {
                    Section {
                        VStack(alignment: .leading, spacing: spacing(6)) {
                            if let learned = detail.learned() {
                                Text(learned)
                                    .font(.footnote)
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            if let notes = detail.notes {
                                Text(notes)
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(.vertical, spacing(4))
                    } header: {
                        SectionTitle(TuneScreen.notesHeader)
                    }
                    .headerProminence(.increased)
                }
            }
            .listStyle(.insetGrouped)
        }
    #endif
}

/// The tune body's sheets and confirmations, shared by the iPad and iPhone list and the Mac page
/// so both present the same ones from the same state.
struct TunePresentations: ViewModifier {
    let model: TuneModel
    @Binding var editing: RecordingView?
    @Binding var deleting: RecordingView?
    @Binding var addingScans: ScanAddChoice?
    @Binding var deletingScan: Scan?

    @Environment(\.commands) private var commands
    @Environment(PlayerModel.self) private var player: PlayerModel?

    func body(content: Content) -> some View {
        content
            .sheet(item: $editing) { view in
                EditRecordingSheet(view: view)
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
            .modifier(
                ScanImport(
                    choice: $addingScans,
                    onPick: { picks in Task { await model.scans.add(picks) } },
                    onFailure: { model.scans.report($0) })
            )
            .coversShell(deletingScan != nil)
            .confirmationDialog(
                ScanCopy.deleteTitle,
                isPresented: Binding {
                    deletingScan != nil
                } set: {
                    if !$0 { deletingScan = nil }
                },
                titleVisibility: .visible, presenting: deletingScan
            ) { scan in
                Button(ScanCopy.delete, role: .destructive) {
                    Task { await model.scans.delete(scan.id) }
                }
            } message: { scan in
                Text(ScanCopy.deleteMessage(scan))
            }
            // Only a new move, never a failed one taking its announcement back.
            .sensoryFeedback(.impact(weight: .light), trigger: model.scans.announcement) { _, new in new != nil }
            .onChange(of: model.scans.announcement) { _, announcement in
                if let announcement { AccessibilityNotification.Announcement(announcement.text).post() }
            }
    }

    private func delete(_ view: RecordingView) {
        // The player lets go of the audio before its file goes.
        if player?.holds(.recording, id: view.id) == true { player?.close() }
        Task { await model.runMediaAction { try await commands?.deleteRecording(view.id) } }
    }
}

#if os(iOS)
    /// Everything above the rows: the tune's other names and composer, and its facets in one
    /// wrapping row, key first. Status shows here but is set only in the edit sheet.
    private struct TuneHeader: View {
        let model: TuneModel
        let detail: TuneDetail

        @Environment(\.spacing) private var spacing

        var body: some View {
            VStack(alignment: .leading, spacing: spacing(12)) {
                if detail.alternateTitles != nil || detail.tune.composer != nil {
                    VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                        // Another name for the tune sits with the title rather than among the facets.
                        if let alternateTitles = detail.alternateTitles {
                            Text(alternateTitles)
                        }
                        if let composer = detail.tune.composer {
                            Text("\(TuneScreen.composerLabel): \(composer)")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                FlowLayout {
                    ForEach(Array(detail.facets.enumerated()), id: \.offset) { _, facet in
                        FacetView(facet: facet)
                    }
                }
                if let failure = model.failure(at: .screen) {
                    FailureText(failure)
                }
            }
        }
    }

    /// One facet: the key as its colored pill, the status as its dot and label, anything else as a
    /// plain capsule, archived in the cautionary tone.
    private struct FacetView: View {
        let facet: TuneFacet

        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.spacing) private var spacing

        var body: some View {
            switch facet {
            case .key(let key):
                KeyPill(key)
                    .accessibilityLabel("\(TuneRowText.keyPrefix) \(key)")
            case .text(let text):
                capsule(Text(text), fill: neutralFill(colorScheme), ink: AnyShapeStyle(.primary))
            case .status(let status):
                capsule(StatusDot(status), fill: neutralFill(colorScheme), ink: AnyShapeStyle(.primary))
            case .archived:
                capsule(
                    Text(TuneRowText.archived), fill: AnyShapeStyle(Color.orange.opacity(0.18)),
                    ink: AnyShapeStyle(Color.orange))
            }
        }

        private func capsule(_ content: some View, fill: AnyShapeStyle, ink: AnyShapeStyle) -> some View {
            content
                .font(.subheadline)
                .foregroundStyle(ink)
                .rowLineLimit()
                .padding(.horizontal, spacing(12))
                .padding(.vertical, spacing.chipVertical)
                .background(fill, in: .capsule)
        }
    }

    /// How the tune sounds: the musician's recordings first, then the links, under one header whose
    /// add control offers both ways to add one.
    private struct TuneMediaSection: View {
        let model: TuneModel
        let detail: TuneDetail
        @Binding var editing: RecordingView?
        @Binding var deleting: RecordingView?

        var body: some View {
            Section {
                if detail.recordings.isEmpty && detail.links.isEmpty {
                    ContentUnavailableView {
                        Label(TuneScreen.noMediaTitle, systemImage: "waveform")
                    } description: {
                        Text(TuneScreen.noMediaHint)
                    }
                }
                TuneMediaRows(model: model, detail: detail, editing: $editing, deleting: $deleting)
            } header: {
                SectionTitle(TuneScreen.recordingsHeader) {
                    TuneMediaAddMenu(model: model, detail: detail)
                }
            } footer: {
                if let failure = model.failure(at: .media) {
                    FailureText(failure)
                }
            }
            .headerProminence(.increased)
        }
    }

#endif

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
            var search: FindRecordingsModel.Search?
            if let engine {
                search = { q, providers, country in
                    await engine.searchRecordings(q: q, providers: providers, country: country)
                }
            }
            let tuneID = detail.tune.id
            let query = FindRecordingsSnapshot.prefill(detail.tune)
            Task {
                await model.chooseFindRecordings(
                    entry, tuneID: tuneID, query: query, offline: offline, search: search,
                    openSheet: actions.findRecordings, open: { openURL($0) })
            }
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

/// The tune's recordings, then its links, one row each with its swipe and context actions.
struct TuneMediaRows: View {
    let model: TuneModel
    let detail: TuneDetail
    @Binding var editing: RecordingView?
    @Binding var deleting: RecordingView?

    @Environment(\.commands) private var commands
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openURL) private var openURL

    var body: some View {
        ForEach(detail.recordings) { recording in
            recordingRow(recording)
                .scaledRowInsets()
                .pageRowWidth()
        }
        ForEach(detail.links) { link in
            linkRow(link)
                .scaledRowInsets()
                .pageRowWidth()
        }
    }

    private func recordingRow(_ entry: TuneRecording) -> some View {
        let view = RecordingView(
            recording: entry.recording, file: entry.file, tuneID: detail.tune.id, tuneTitle: detail.tune.title)
        // The screen's own title above already names the tune.
        let pinned = detail.userTune.playRecordingID == view.id
        return HStack {
            RecordingItem(view: view, tuneNamedAbove: true) { kind in
                retry(view.id, kind)
            }
            if pinned { PinnedMark() }
        }
        .recordingRowActions(
            filed: true, pinned: pinned,
            onTogglePin: { Task { await model.setPlaySource(.recording(id: view.id), pinned: pinned) } },
            originLabel: RecordingText.originLabel(view.recording.origin),
            onOpenOrigin: RecordingRowActions.originPage(view.recording).map { page in { openURL(page) } },
            onEdit: { editing = view },
            // Every recording here is already filed under the tune being looked at.
            onAddToTune: nil,
            onRemoveFromTune: {
                Task {
                    await model.runMediaAction { try await commands?.updateRecording(view.id, tuneID: .value(nil)) }
                }
            },
            onDelete: { deleting = view })
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
            ? { Task { await model.addRecordingFromLink(link.id) } } : nil
        return HStack {
            MediaRow(link: row) { tap in
                switch tap {
                case .play: if let item = PlayerItem.link(link) { player?.play(item, origin: .row) }
                case .close: player?.close()
                case .open(let url): openURL(url)
                }
            }
            if pinned { PinnedMark() }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            remove
            PinAction(pinned: pinned, onTogglePin: togglePin, short: true).tint(.indigo)
            if let addToRecordings {
                Button(TuneScreen.addToRecordings, systemImage: "square.and.arrow.down", action: addToRecordings)
                    .tint(.teal)
            }
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

extension View {
    /// Caps a media row on the Mac's tune page, so Retry and the pin stay near the row's title
    /// across a wide page.
    fileprivate func pageRowWidth() -> some View {
        #if os(macOS)
            frame(maxWidth: MacStyle.pageRowMaxWidth, alignment: .leading)
        #else
            self
        #endif
    }
}

#if os(iOS)
    /// The lists the tune is in, each opening its list, with an add control on the header.
    private struct TuneListsSection: View {
        let model: TuneModel
        let detail: TuneDetail

        @Environment(\.tuneScreenActions) private var actions

        var body: some View {
            Section {
                ForEach(detail.lists) { membership in
                    listRow(membership)
                }
            } header: {
                SectionTitle(TuneScreen.listsHeader) {
                    Button(TuneScreen.addToList, systemImage: "plus") {
                        actions.addToList?(detail.userTune.id)
                    }
                    .disabled(actions.addToList == nil)
                }
            } footer: {
                if let failure = model.failure(at: .lists) {
                    FailureText(failure)
                } else if detail.lists.isEmpty {
                    Text(TuneScreen.notInList)
                }
            }
            .headerProminence(.increased)
        }

        private func listRow(_ membership: TuneMembership) -> some View {
            let list = membership.list
            let remove = RemoveFromListButton(model: model, membership: membership)
            return OpensList(listID: list.id) { inSplitView in
                if inSplitView {
                    HStack {
                        Label(list.name, systemImage: Destination.lists.systemImage)
                            .foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .contentShape(.rect)
                } else {
                    Label(list.name, systemImage: Destination.lists.systemImage)
                }
            }
            .rowLineLimit()
            .swipeActions(edge: .trailing, allowsFullSwipe: false) { remove }
            .contextMenu { remove }
        }
    }

#endif

/// Opens a list from the tune it holds: in the split view's content column, or pushed where
/// there is no split view. `label` is told which, since a pushed link draws its own chevron.
struct OpensList<Label: View>: View {
    let listID: String
    @ViewBuilder let label: (_ inSplitView: Bool) -> Label

    @Environment(\.sidebarSelection) private var sidebarSelection

    var body: some View {
        if let sidebarSelection {
            Button {
                sidebarSelection.wrappedValue = .list(id: listID)
            } label: {
                label(true)
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink {
                ListScreen(listID: listID)
            } label: {
                label(false)
            }
        }
    }
}

/// Takes the tune out of one of its lists.
struct RemoveFromListButton: View {
    let model: TuneModel
    let membership: TuneMembership

    var body: some View {
        Button(TuneScreen.remove, systemImage: "text.badge.xmark", role: .destructive) {
            Task { await model.removeFromList(itemID: membership.itemID) }
        }
    }
}

/// A section header that names what its rows belong to, with an optional control at its
/// trailing edge.
struct SectionTitle<Accessory: View>: View {
    let title: String
    let accessory: Accessory

    init(_ title: String, @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.accessory = accessory()
    }

    var body: some View {
        HStack {
            Text(title)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            accessory
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
    }
}

extension SectionTitle where Accessory == EmptyView {
    init(_ title: String) {
        self.init(title) { EmptyView() }
    }
}

/// A failed write's message, in red beside the control that made it.
struct FailureText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.red)
    }
}
