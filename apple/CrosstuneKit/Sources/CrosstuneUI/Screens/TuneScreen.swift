import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// One tune, opened from any tune row: pushed on iPhone, in the detail column on iPad and Mac.
/// What it is, the musician's status for it, how it sounds, the lists it is in, and their notes.
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
    public static let noMediaHint = "Record one, or paste a link to one."
    public static let moreActions = "More actions"
    public static let remove = "Remove"

    private let tuneID: String

    @Environment(\.store) private var store
    @State private var model: TuneModel?

    public init(tuneID: String) {
        self.tuneID = tuneID
    }

    public var body: some View {
        Group {
            if let model, model.tuneID == tuneID {
                TuneContent(model: model)
                    // A new tune starts with fresh sheets, dialogs, and rail, so switching tunes
                    // in the detail column never carries one over or buzzes as a status change.
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
    }
}

private struct TuneContent: View {
    let model: TuneModel

    @Environment(\.detailTune) private var detailTune
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var form: TuneFormTarget?
    @State private var confirmsDelete = false

    var body: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .gone:
            ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
                .navigationTitle(TuneScreen.fallbackTitle)
        case .deleting(let title):
            VStack(alignment: .leading, spacing: 8) {
                Text(DeleteTuneMessage.deleting)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let failure = model.failure(at: .screen) {
                    FailureText(failure)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
            .navigationTitle(title)
        case .shown(let detail):
            TuneBody(model: model, detail: detail)
                .modifier(RefreshesBySync(engine: engine))
                .navigationTitle(detail.tune.title)
                .toolbar { toolbar(detail) }
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
        }
    }
}

private struct TuneBody: View {
    let model: TuneModel
    let detail: TuneDetail

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.commands) private var commands
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @State private var renaming: RecordingView?
    @State private var deleting: RecordingView?

    var body: some View {
        List {
            Section {
                TuneHeader(model: model, detail: detail)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            TuneMediaSection(model: model, detail: detail, renaming: $renaming, deleting: $deleting)
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
                    VStack(alignment: .leading, spacing: 6) {
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
                    .padding(.vertical, 4)
                } header: {
                    SectionTitle(TuneScreen.notesHeader)
                }
                .headerProminence(.increased)
            }
        }
        #if os(iOS)
            .listStyle(.insetGrouped)
        #else
            .listStyle(.inset)
        #endif
        .sheet(item: $renaming) { view in
            RenameRecordingSheet(view: view)
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

    private func delete(_ view: RecordingView) {
        // The player lets go of the audio before its file goes.
        if player?.holds(.recording, id: view.id) == true { player?.close() }
        Task { await model.runMediaAction { try await commands?.deleteRecording(view.id) } }
    }
}

/// Everything above the rows: the tune's other names and composer, its facets in one wrapping
/// row, key first, and the status rail, which writes on each press.
private struct TuneHeader: View {
    let model: TuneModel
    let detail: TuneDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if detail.alternateTitles != nil || detail.tune.composer != nil {
                VStack(alignment: .leading, spacing: 2) {
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
            if !detail.facets.isEmpty {
                FlowLayout {
                    ForEach(Array(detail.facets.enumerated()), id: \.offset) { _, facet in
                        FacetView(facet: facet)
                    }
                }
            }
            StatusRail(
                status: Binding {
                    detail.userTune.status
                } set: { status in
                    Task { await model.setStatus(status) }
                })
            if let failure = model.failure(at: .screen) {
                FailureText(failure)
            }
        }
    }
}

/// One facet: the key as its colored pill, anything else as a plain capsule, archived in the
/// cautionary tone.
private struct FacetView: View {
    let facet: TuneFacet

    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 32

    var body: some View {
        switch facet {
        case .key(let key):
            KeyPill(key)
                .accessibilityLabel("\(TuneRowText.keyPrefix) \(key)")
        case .text(let text):
            capsule(text, fill: neutralFill(colorScheme), ink: AnyShapeStyle(.primary))
        case .archived:
            capsule(
                TuneRowText.archived, fill: AnyShapeStyle(Color.orange.opacity(0.18)),
                ink: AnyShapeStyle(Color.orange))
        }
    }

    private func capsule(_ text: String, fill: AnyShapeStyle, ink: AnyShapeStyle) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(ink)
            .rowLineLimit()
            .padding(.horizontal, 12)
            .frame(minHeight: height)
            .background(fill, in: .capsule)
    }
}

/// How the tune sounds: the musician's recordings first, then the links, under one header whose
/// add control offers both ways to add one.
private struct TuneMediaSection: View {
    let model: TuneModel
    let detail: TuneDetail

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.commands) private var commands
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openURL) private var openURL
    @Binding var renaming: RecordingView?
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
            ForEach(detail.recordings) { recording in
                recordingRow(recording)
            }
            ForEach(detail.links) { link in
                linkRow(link)
            }
        } header: {
            SectionTitle(TuneScreen.recordingsHeader) {
                Menu {
                    Button(TuneScreen.newRecording, systemImage: RecordControl.systemImage) {
                        actions.record?(detail.tune.id)
                    }
                    .disabled(actions.record == nil)
                    Button(TuneScreen.addLink, systemImage: "link") {
                        actions.addLink?(detail.tune.id)
                    }
                    .disabled(actions.addLink == nil)
                } label: {
                    Label(TuneScreen.addRecording, systemImage: "plus")
                }
                .disabled(actions.record == nil && actions.addLink == nil)
            }
        } footer: {
            if let failure = model.failure(at: .media) {
                FailureText(failure)
            }
        }
        .headerProminence(.increased)
    }

    private func recordingRow(_ entry: TuneRecording) -> some View {
        let view = RecordingView(
            recording: entry.recording, file: entry.file, tuneID: detail.tune.id, tuneTitle: detail.tune.title)
        // The screen's own title above already names the tune.
        return RecordingItem(view: view, tuneNamedAbove: true) { kind in
            retry(view.id, kind)
        }
        .recordingRowActions(
            filed: true,
            onRename: { renaming = view },
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
        let remove = Button(TuneScreen.remove, systemImage: "trash", role: .destructive) {
            Task { await model.removeLink(link.id) }
        }
        return MediaRow(link: row) { tap in
            switch tap {
            case .play: if let item = PlayerItem.link(link) { player?.play(item) }
            case .close: player?.close()
            case .open(let url): openURL(url)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { remove }
        .contextMenu { remove }
    }
}

/// The lists the tune is in, each opening its list, with an add control on the header.
private struct TuneListsSection: View {
    let model: TuneModel
    let detail: TuneDetail

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.sidebarSelection) private var sidebarSelection

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

    @ViewBuilder private func listRow(_ membership: TuneMembership) -> some View {
        let list = membership.list
        let remove = Button(TuneScreen.remove, systemImage: "text.badge.xmark", role: .destructive) {
            Task { await model.removeFromList(itemID: membership.itemID) }
        }
        Group {
            if let sidebarSelection {
                // The split view shows the list in its content column rather than pushing it.
                Button {
                    sidebarSelection.wrappedValue = .list(id: list.id)
                } label: {
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
                }
                .buttonStyle(.plain)
            } else {
                NavigationLink {
                    ListScreen(listID: list.id)
                } label: {
                    Label(list.name, systemImage: Destination.lists.systemImage)
                }
            }
        }
        .rowLineLimit()
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { remove }
        .contextMenu { remove }
    }
}

/// A section header that names what its rows belong to, with an optional control at its
/// trailing edge.
private struct SectionTitle<Accessory: View>: View {
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
private struct FailureText: View {
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
