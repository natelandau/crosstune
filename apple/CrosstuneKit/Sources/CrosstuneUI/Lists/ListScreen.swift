import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// One list: its tunes in order, reordered by dragging or from each row's move menu, with the
/// sheets that add, rename, and edit them. Pushed on iPhone, in the content column on iPad and
/// Mac.
public struct ListScreen: View {
    public static let fallbackTitle = "List"
    public static let gone = "This list is gone"
    public static let addTunes = TunePickerSheet.title
    public static let rename = "Rename"
    public static let showArchived = CatalogFilterSheet.showArchived
    public static let deleteList = "Delete list"
    public static let remove = TuneScreen.remove
    public static let emptyTitle = "Nothing in this list"
    public static let emptyHint = "Add tunes to start this list."
    public static let allArchivedTitle = "Every tune here is archived"
    /// Names the toggle, so the hint follows a rename of it.
    public static let archivedHint = "Turn on \(showArchived) to see them."

    /// The move button's spoken name.
    public static func reorder(_ title: String) -> String {
        "Reorder \(title)"
    }

    /// The context menu's submenu that holds the move menu's places.
    public static let moveSubmenu = "Move"

    /// The move menu's title.
    public static func move(_ title: String) -> String {
        "Move \(title)"
    }

    private let listID: String

    @Environment(\.analytics) private var analytics
    @Environment(\.store) private var store
    @State private var model: ListModel?

    public init(listID: String) {
        self.listID = listID
    }

    public var body: some View {
        Group {
            if let model, model.listID == listID {
                ListContent(model: model)
                    // A new list starts with fresh sheets and dialogs.
                    .id(listID)
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        .task(id: listID) {
            guard let store else { return }
            model = ListModel(store: store, listID: listID, analytics: analytics)
        }
    }
}

private struct ListContent: View {
    @Environment(\.spacing) private var spacing
    let model: ListModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.sidebarSelection) private var sidebarSelection
    /// Whether this visit's screen view is sent, so a list back from a failed delete is not
    /// counted again.
    @State private var visited = false

    var body: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .gone:
            ContentUnavailableView(ListScreen.gone, systemImage: Destination.lists.systemImage)
                .navigationTitle(ListScreen.fallbackTitle)
        case .deleting(let name):
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                Text(DeleteTuneMessage.deleting)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let failure = model.failure {
                    FailureText(failure)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // The inset grouped list's content margin, fixed so the text lines up with it.
            .padding(20)
            .navigationTitle(name)
        case .shown(let contents):
            ListTunes(model: model, list: contents.list, onDeleted: leave)
                .screenView(.list, visit: $visited, stillShown: { model.phase.isShown })
        }
    }

    /// Leaves a deleted list: back to the lists, or the catalog in the split view.
    private func leave() {
        if let sidebarSelection {
            sidebarSelection.value = .catalog
        } else {
            dismiss()
        }
    }
}

private struct ListTunes: View {
    let model: ListModel
    let list: TuneList
    let onDeleted: () -> Void

    @Environment(\.detailTune) private var detailTune
    @Environment(\.listSheets) private var listSheets
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(ScanTunes.self) private var scanTunes: ScanTunes?
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    /// Whether this device plays Apple Music in full, nil until read.
    @State private var appleMusic: AppleMusicAccessState?
    @State private var showsWhatPlays = false
    /// A tune chosen in the What plays sheet, opened once the sheet has gone.
    @State private var chosen: String?
    @State private var pushed: String?
    @State private var picking = false
    /// A tune the picker asked to create, opened once the picker has gone.
    @State private var creating: TuneFormTarget?
    @State private var form: TuneFormTarget?
    @State private var confirmsDelete = false
    @State private var selection = TuneSelection()
    /// Whether the Mac column title, and the actions on its line, are on screen.
    @State private var titleInView = true
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing
    @AccessibilityFocusState private var focusedRow: String?
    @Namespace private var zoom

    var body: some View {
        let rows = model.rows
        content(rows)
            #if os(macOS)
                .macColumnList()
            #else
                .listStyle(.plain)
            #endif
            .overlay {
                if let showArchived = model.showArchived {
                    emptyState(rows, showArchived: showArchived)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = model.failure {
                    FailureText(failure)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, spacing.stackGap)
                }
            }
            #if os(iOS)
                .toolbar {
                    if !selection.isActive { toolbar(rows) }
                }
                .navigationTitle(selection.isActive ? TuneSelection.title(selection.ids.count) : list.name)
                .toolbarTitleDisplayMode(.inlineLarge)
            #else
                // The list's own actions ride on its title's line, and take the pane bar only
                // once the title has scrolled away, so the bar adds no empty band at rest.
                .paneBar {
                    if !selection.isActive && !titleInView { listActions(rows) }
                }
                .columnTitled(
                    selection.isActive ? TuneSelection.title(selection.ids.count) : list.name,
                    alwaysShown: selection.isActive, onTitleShows: { titleInView = $0 })
            #endif
            .selectionMode(
                $selection, rows: rows.map(\.catalogEntry), instruments: model.instruments,
                list: SelectionList(
                    id: list.id, name: list.name,
                    itemIDs: Dictionary(
                        rows.map { ($0.tune.id, $0.item.id) }, uniquingKeysWith: { first, _ in first })),
                focusedRow: $focusedRow
            )
            .task { await readAppleMusic() }
            .onChange(of: scenePhase) {
                if scenePhase == .active { Task { await readAppleMusic() } }
            }
            .onChange(of: session?.hasNetwork) { Task { await readAppleMusic() } }
            .modifier(RefreshesBySync(engine: engine))
            // The menu's New tune files the tune in this list, as the picker's add row does.
            .newTuneContext(listID: list.id)
            .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: zoom))
            .sheet(isPresented: $picking, onDismiss: openCreated) {
                TunePickerSheet(
                    listID: list.id,
                    onCreate: { creating = .new(title: $0, listID: list.id, source: .list) },
                    onLateFailure: model.report)
            }
            .sheet(isPresented: $showsWhatPlays, onDismiss: openChosen) {
                WhatPlaysSheet(
                    report: playReport(rows),
                    titles: Dictionary(
                        rows.map { ($0.tune.id, $0.tune.title) }, uniquingKeysWith: { first, _ in first }),
                    access: appleMusic, onChoose: { chosen = $0 },
                    onAllow: {
                        guard let access = player?.appleMusic?.access else { return }
                        Task {
                            let answer = await access.request()
                            appleMusic = answer
                            player?.analytics.appleMusicAnswered(answer)
                        }
                    },
                    onOpenSettings: {
                        if let url = AppleMusicRowAction.systemSettingsURL { openURL(url) }
                    })
            }
            .sheet(item: $form) { target in
                TuneFormSheet(target: target) { _ in }
            }
            .coversShell(confirmsDelete)
            .confirmationDialog(
                DeleteListMessage.title(list.name), isPresented: $confirmsDelete, titleVisibility: .visible
            ) {
                Button(DeleteListMessage.delete, role: .destructive) {
                    Task {
                        if await model.delete() { onDeleted() }
                    }
                }
            } message: {
                Text(DeleteListMessage.message)
            }
            .onChange(of: model.announcement) { _, announcement in
                if let announcement { AccessibilityNotification.Announcement(announcement.text).post() }
            }
    }

    @ViewBuilder private func content(_ rows: [ListEntry]) -> some View {
        // The rows wait for the archived setting, so an archived tune never flashes in or out.
        // Reordering stops while selecting.
        let reorder: ((IndexSet, Int) -> Void)? = selection.isActive ? nil : { move($0, $1) }
        let chosen = TuneSelection.listBinding($selection, visible: rows.map(\.tune.id), detailTune: detailTune)
        if model.showArchived != nil {
            List(selection: chosen) {
                #if os(macOS)
                    MacListTitle(name: list.name, play: playOffer(rows)) {
                        if !selection.isActive { listActions(rows) }
                    }
                    // With no pane bar above it at rest, the title keeps its own room under the
                    // toolbar.
                    .listRowInsets(MacStyle.columnRowInsets(top: 4, bottom: 8))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
                #else
                    if let play = playOffer(rows) {
                        ListPlayControls(offer: play)
                            .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .selectionDisabled()
                    }
                #endif
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                    row(entry, position: index + 1, reorderable: rows.count > 1 && !selection.isActive)
                        .tuneRowInsets()
                }
                .onMove(perform: reorder)
            }
            .keepsScrollAnchor(rows: rows.map(\.id))
        } else {
            Color.clear
        }
    }

    @ToolbarContentBuilder private func toolbar(_ rows: [ListEntry]) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { addTunesButton }
        // The menu states the archived setting, so it waits until the setting is read.
        if let showArchived = model.showArchived {
            // One Menu keeps its divider and destructive styling; loose secondary items lose the divider.
            ToolbarItem(placement: .primaryAction) { moreMenu(rows, showArchived: showArchived) }
        }
    }

    /// What Play, Shuffle, and the line under them act on, or nil while they stand down: with no
    /// tunes, while selecting, and until the access read.
    private func playOffer(_ rows: [ListEntry]) -> ListPlayOffer? {
        guard !rows.isEmpty, !selection.isActive, hasReadAppleMusic else { return nil }
        let report = playReport(rows)
        return ListPlayOffer(
            report: report, canStart: listPlayback != nil && !(recorders?.isCapturing ?? false),
            onPlay: { startPlaylist(report, shuffled: false) },
            onShuffle: { startPlaylist(report, shuffled: true) },
            onWhatPlays: { showsWhatPlays = true })
    }

    /// Controls wait for the access read, so the count never flashes a subscription skip.
    private var hasReadAppleMusic: Bool {
        player?.appleMusic?.access == nil || appleMusic != nil
    }

    private func readAppleMusic() async {
        guard let access = player?.appleMusic?.access else { return }
        appleMusic = await access.current()
    }

    private func playReport(_ rows: [ListEntry]) -> PlaylistReport {
        let online = session?.hasNetwork ?? true
        return playlistReport(
            entries: rows.map { $0.playlistEntry(online: online) }, playFirst: model.playFirst,
            fullTracks: appleMusic == .fullTracks, online: online)
    }

    private func startPlaylist(_ report: PlaylistReport, shuffled: Bool) {
        guard let listPlayback else { return }
        listPlayback.start(listID: list.id, name: list.name, report: report, shuffled: shuffled)
    }

    private func openChosen() {
        guard let id = chosen else { return }
        chosen = nil
        if let detailTune {
            detailTune.value = id
        } else {
            pushed = id
        }
    }

    #if os(macOS)
        /// Add tunes and the More menu, as glyphs with their names as tooltips.
        @ViewBuilder private func listActions(_ rows: [ListEntry]) -> some View {
            addTunesButton.labelStyle(.iconOnly).help(ListScreen.addTunes)
            if let showArchived = model.showArchived {
                moreMenu(rows, showArchived: showArchived).help(TuneScreen.moreActions)
            }
        }
    #endif

    private var addTunesButton: some View {
        Button(ListScreen.addTunes, systemImage: "plus") { picking = true }
    }

    private func moreMenu(_ rows: [ListEntry], showArchived: Bool) -> some View {
        Menu {
            moreItems(rows, showArchived: showArchived)
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                .labelStyle(.iconOnly)
        }
    }

    @ViewBuilder private func moreItems(_ rows: [ListEntry], showArchived: Bool) -> some View {
        if !rows.isEmpty {
            Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter() }
        }
        Button(ListScreen.rename, systemImage: "pencil") {
            listSheets?.name(.rename(listID: list.id, name: list.name))
        }
        .disabled(listSheets == nil)
        Toggle(
            ListScreen.showArchived, systemImage: "archivebox",
            isOn: Binding {
                showArchived
            } set: { show in
                Task { await model.setShowArchived(show) }
            })
        Divider()
        Button(ListScreen.deleteList, systemImage: "trash", role: .destructive) { confirmsDelete = true }
    }

    private func row(_ entry: ListEntry, position: Int, reorderable: Bool) -> some View {
        let playAction = ListRowPlay.action(
            for: entry, playFirst: model.playFirst, loaded: { player?.holds(.recording, id: $0) ?? false },
            downloading: { transfers?.isDownloading($0) ?? false })
        let isCurrent = ListRowPlay.isNowPlaying(
            listID: list.id, playingListID: listPlayback?.listID, currentTuneID: listPlayback?.currentTuneID,
            tuneID: entry.tune.id)
        let tuneRow = TuneRow(
            tune: entry.tune, userTune: entry.userTune, instruments: model.instruments, position: position)
        let hint = ListRowText.hint(hasAction: playAction != nil, isCurrent: isCurrent, isSelecting: selection.isActive)
        let edit = { form = .edit(tuneID: entry.tune.id, userTuneID: entry.userTune.id) }
        let remove: () -> Void = { Task { await model.remove(entry) } }
        let scans = TuneRowActions.scansAction(
            tuneID: entry.tune.id, tunesWithScans: scanTunes, origin: .list(id: list.id), actions: tuneScreenActions)
        return HStack(spacing: spacing(4)) {
            if detailTune != nil || selection.isActive {
                // The list's selection drives the detail column, or is the selection.
                tuneRow
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityHint(hint)
                    .modifier(MoveActions(entry: entry, reorderable: reorderable, buttons: moveButtons))
            } else {
                Button {
                    pushed = entry.tune.id
                } label: {
                    tuneRow
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                // Not the automatic style, so the play button beside the row keeps its own tap.
                .buttonStyle(.plain)
                .accessibilityHint(hint)
                .modifier(MoveActions(entry: entry, reorderable: reorderable, buttons: moveButtons))
                .matchedTransitionSource(id: entry.tune.id, in: zoom)
            }
            #if os(macOS)
                // Only play holds a place at the trailing edge, so titles keep their width in a
                // narrow column. Dragging the row reorders; Move is in its context menu and its
                // accessibility actions.
                if !selection.isActive {
                    ListRowPlayButton(entry: entry, action: playAction, listID: list.id)
                        .revealedOnHover(pinned: isCurrent || playAction == .downloading)
                }
            #else
                if !selection.isActive {
                    ListRowPlayButton(entry: entry, action: playAction, listID: list.id)
                }
            #endif
        }
        #if os(macOS)
            .revealsActionsOnHover()
        #endif
        // Before the row's tag, background, and move rule: the visibility watch wraps the row, and
        // a wrapper around them hides them from the list.
        .scrollAnchorRow(entry.id)
        .selectableRowActions(isSelecting: selection.isActive) {
            Button(ListScreen.remove, systemImage: "text.badge.xmark", role: .destructive) { remove() }
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
                .tint(.gray)
            if let scans { ScansRowAction(action: scans) }
            #if os(iOS)
                if reorderable { moveMenu(entry) }
            #endif
        } menu: {
            if let scans { ScansRowAction(action: scans) }
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
            if reorderable { moveItems(entry) }
            Button(ListScreen.remove, systemImage: "text.badge.xmark", role: .destructive) { remove() }
            Divider()
            Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter(with: entry.tune.id) }
        } preview: {
            TunePreview(entry: entry.catalogEntry, instruments: model.instruments)
        }
        .listRowBackground(isCurrent && !selection.isActive ? currentRowTint : nil)
        .accessibilityFocused($focusedRow, equals: entry.tune.id)
        .tag(entry.tune.id)
        .moveDisabled(!reorderable)
    }

    /// The light wash on the tune a playing list is on.
    @ViewBuilder private var currentRowTint: some View {
        #if os(macOS)
            // Inset and rounded as the selection is, so the two read as one family.
            RoundedRectangle(cornerRadius: 6)
                .fill(MacStyle.accent.opacity(0.12))
                .padding(.horizontal, MacStyle.selectionInset)
        #else
            BrandStyle.setFill(colorScheme)
        #endif
    }

    #if os(iOS)
        /// Move as a menu on the row's swipe, since the row carries no move button.
        private func moveMenu(_ entry: ListEntry) -> some View {
            Menu {
                Section(ListScreen.move(entry.tune.title)) {
                    moveButtons(entry)
                }
            } label: {
                Label(ListScreen.reorder(entry.tune.title), systemImage: "arrow.up.arrow.down")
            }
            .tint(.gray)
        }
    #endif

    @ViewBuilder private func moveButtons(_ entry: ListEntry) -> some View {
        ForEach(model.places(for: entry), id: \.self) { place in
            Button(place.label, systemImage: place.systemImage) { model.move(entry, to: place) }
        }
    }

    /// The row's move menu, in its context menu.
    private func moveItems(_ entry: ListEntry) -> some View {
        Menu(ListScreen.moveSubmenu, systemImage: "arrow.up.arrow.down") {
            moveButtons(entry)
        }
    }

    private func move(_ indices: IndexSet, _ offset: Int) {
        guard indices.count == 1, let from = indices.first else { return }
        model.move(from: from, to: MovePlace.dropTarget(from: from, offset: offset))
    }

    @ViewBuilder private func emptyState(_ rows: [ListEntry], showArchived: Bool) -> some View {
        if model.entries.isEmpty {
            ContentUnavailableView {
                Label(ListScreen.emptyTitle, systemImage: Destination.lists.systemImage)
            } description: {
                Text(ListScreen.emptyHint)
            } actions: {
                Button(ListScreen.addTunes) { picking = true }
                    .buttonStyle(.slateProminent)
            }
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label(ListScreen.allArchivedTitle, systemImage: Destination.lists.systemImage)
            } description: {
                Text(ListScreen.archivedHint)
            } actions: {
                Button(ListScreen.showArchived) { Task { await model.setShowArchived(true) } }
                    .buttonStyle(.slateProminent)
            }
        }
    }

    private func openCreated() {
        form = creating
        creating = nil
    }
}

extension View {
    /// A list row's swipe actions and context menu, or neither while the row is selecting.
    @ViewBuilder
    fileprivate func selectableRowActions(
        isSelecting: Bool, @ViewBuilder swipe: () -> some View, @ViewBuilder menu: () -> some View,
        @ViewBuilder preview: () -> some View
    ) -> some View {
        if isSelecting {
            self
        } else {
            self
                .swipeActions(edge: .trailing, allowsFullSwipe: false, content: swipe)
                .contextMenu(menuItems: menu, preview: preview)
        }
    }
}

/// A list row's moves as accessibility actions, which have no move button on the row, so they
/// are reachable without the context menu.
private struct MoveActions<Buttons: View>: ViewModifier {
    let entry: ListEntry
    let reorderable: Bool
    let buttons: (ListEntry) -> Buttons

    func body(content: Content) -> some View {
        content.accessibilityActions {
            if reorderable { buttons(entry) }
        }
    }
}
