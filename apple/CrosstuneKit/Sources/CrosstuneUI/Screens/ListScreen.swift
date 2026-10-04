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

    /// The move menu's title.
    public static func move(_ title: String) -> String {
        "Move \(title)"
    }

    private let listID: String

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
            model = ListModel(store: store, listID: listID)
        }
    }
}

private struct ListContent: View {
    @Environment(\.spacing) private var spacing
    let model: ListModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.sidebarSelection) private var sidebarSelection

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
                    FailureLine(failure)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // The inset grouped list's content margin, fixed so the text lines up with it.
            .padding(20)
            .navigationTitle(name)
        case .shown(let contents):
            ListTunes(model: model, list: contents.list, onDeleted: leave)
        }
    }

    /// Leaves a deleted list: back to the lists, or the catalog in the split view.
    private func leave() {
        if let sidebarSelection {
            sidebarSelection.wrappedValue = .catalog
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
    /// How far the rows are pulled down past their top.
    @State private var overscroll: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.spacing) private var spacing
    @AccessibilityFocusState private var focusedRow: String?
    @Namespace private var zoom

    var body: some View {
        let rows = model.rows
        content(rows)
            .listStyle(.plain)
            #if os(iOS)
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    max(0, -(geometry.contentOffset.y + geometry.contentInsets.top))
                } action: { _, pulled in
                    overscroll = pulled
                }
            #endif
            .overlay {
                if let showArchived = model.showArchived {
                    emptyState(rows, showArchived: showArchived)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = model.failure {
                    FailureLine(failure)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, spacing.stackGap)
                }
            }
            // Inside the Mac's pane bar, so the bar stays at the top of the pane.
            .safeAreaInset(edge: .top, spacing: 0) {
                if !rows.isEmpty, !selection.isActive, hasReadAppleMusic {
                    ListPlayControls(
                        report: playReport(rows), canStart: listPlayback != nil && !(recorders?.isCapturing ?? false),
                        onPlay: { startPlaylist(playReport(rows), shuffled: false) },
                        onShuffle: { startPlaylist(playReport(rows), shuffled: true) },
                        onWhatPlays: { showsWhatPlays = true }
                    )
                    // Pinned while the rows scroll, but a pull past the top carries the controls
                    // down with the title and rows.
                    .offset(y: overscroll)
                }
            }
            #if os(iOS)
                .toolbar {
                    if !selection.isActive { toolbar(rows) }
                }
            #else
                .paneBar {
                    if !selection.isActive {
                        addTunesButton.labelStyle(.iconOnly)
                        if let showArchived = model.showArchived { moreMenu(rows, showArchived: showArchived) }
                    }
                }
            #endif
            .navigationTitle(selection.isActive ? TuneSelection.title(selection.ids.count) : list.name)
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
                    onCreate: { creating = .new(title: $0, listID: list.id) },
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
                        Task { appleMusic = await access.request() }
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
            // Only a new move, never a failed one taking its announcement back.
            .sensoryFeedback(.impact(weight: .light), trigger: model.announcement) { _, new in new != nil }
            .onChange(of: model.announcement) { _, announcement in
                if let announcement { AccessibilityNotification.Announcement(announcement.text).post() }
            }
    }

    @ViewBuilder private func content(_ rows: [ListEntry]) -> some View {
        // The rows wait for the archived setting, so an archived tune never flashes in or out.
        // Reordering stops while selecting.
        let reorder: ((IndexSet, Int) -> Void)? = selection.isActive ? nil : { move($0, $1) }
        let chosen: Binding<Set<String>>? = TuneSelection.listBinding(
            $selection, visible: rows.map(\.tune.id), detailTune: detailTune)
        if model.showArchived != nil {
            List(selection: chosen) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                    row(entry, position: index + 1, reorderable: rows.count > 1 && !selection.isActive)
                        .scaledRowInsets()
                }
                .onMove(perform: reorder)
            }
        } else {
            Color.clear
        }
    }

    @ToolbarContentBuilder private func toolbar(_ rows: [ListEntry]) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { addTunesButton }
        // The menu states the archived setting, so it waits until the setting is read.
        if let showArchived = model.showArchived {
            ToolbarItem(placement: .primaryAction) { moreMenu(rows, showArchived: showArchived) }
        }
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

    /// Starting a playlist stops whatever was loaded.
    private func startPlaylist(_ report: PlaylistReport, shuffled: Bool) {
        guard let listPlayback else { return }
        player?.close()
        listPlayback.start(listID: list.id, name: list.name, report: report, shuffled: shuffled)
    }

    private func openChosen() {
        guard let id = chosen else { return }
        chosen = nil
        if let detailTune {
            detailTune.wrappedValue = id
        } else {
            pushed = id
        }
    }

    private var addTunesButton: some View {
        Button(ListScreen.addTunes, systemImage: "plus") { picking = true }
    }

    private func moreMenu(_ rows: [ListEntry], showArchived: Bool) -> some View {
        Menu {
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
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                .labelStyle(.iconOnly)
        }
    }

    private func row(_ entry: ListEntry, position: Int, reorderable: Bool) -> some View {
        let playAction = ListRowPlay.action(
            for: entry, playFirst: model.playFirst, loaded: { player?.holds(.recording, id: $0) ?? false },
            downloading: { transfers?.isDownloading($0) ?? false })
        let tuneRow = TuneRow(
            tune: entry.tune, userTune: entry.userTune, instruments: model.instruments, position: position
        )
        let isCurrent = ListRowPlay.isNowPlaying(
            listID: list.id, playingListID: listPlayback?.listID, currentTuneID: listPlayback?.currentTuneID,
            tuneID: entry.tune.id)
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
            } else {
                Button {
                    pushed = entry.tune.id
                } label: {
                    tuneRow
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                // Not the automatic style, so the row's move button beside it keeps its own tap.
                .buttonStyle(.plain)
                .accessibilityHint(hint)
                .matchedTransitionSource(id: entry.tune.id, in: zoom)
            }
            if !selection.isActive {
                ListRowPlayButton(entry: entry, action: playAction, listID: list.id)
            }
            if reorderable {
                moveMenu(entry, isChosen: detailTune?.wrappedValue == entry.tune.id)
                // Dragging works anywhere on the row; the grip only shows that it can, so at the
                // accessibility text sizes it gives its width to the title.
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "line.3.horizontal")
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
        }
        .selectableRowActions(isSelecting: selection.isActive) {
            Button(ListScreen.remove, systemImage: "text.badge.xmark", role: .destructive) { remove() }
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
                .tint(.gray)
            if let scans { ScansRowAction(action: scans) }
        } menu: {
            if let scans { ScansRowAction(action: scans) }
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
            Button(ListScreen.remove, systemImage: "text.badge.xmark", role: .destructive) { remove() }
            Divider()
            Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter(with: entry.tune.id) }
        } preview: {
            TunePreview(entry: entry.catalogEntry, instruments: model.instruments)
        }
        .listRowBackground(isCurrent && !selection.isActive ? Color.accentColor.opacity(0.12) : nil)
        .accessibilityFocused($focusedRow, equals: entry.tune.id)
        .tag(entry.tune.id)
        .moveDisabled(!reorderable)
    }

    /// `isChosen` rows sit on the accent fill, which would swallow a tinted glyph.
    private func moveMenu(_ entry: ListEntry, isChosen: Bool) -> some View {
        Menu {
            Section(ListScreen.move(entry.tune.title)) {
                ForEach(model.places(for: entry), id: \.self) { place in
                    Button(place.label, systemImage: place.systemImage) { model.move(entry, to: place) }
                }
            }
        } label: {
            Label(ListScreen.reorder(entry.tune.title), systemImage: "arrow.up.arrow.down")
                .labelStyle(.iconOnly)
                .foregroundStyle(isChosen ? AnyShapeStyle(.primary) : AnyShapeStyle(.tint))
                .frame(minWidth: minimumTapTarget)
                .tapTarget()
        }
        .menuIndicator(.hidden)
        .buttonStyle(.borderless)
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
                    .buttonStyle(.borderedProminent)
            }
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label(ListScreen.allArchivedTitle, systemImage: Destination.lists.systemImage)
            } description: {
                Text(ListScreen.archivedHint)
            } actions: {
                Button(ListScreen.showArchived) { Task { await model.setShowArchived(true) } }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private func openCreated() {
        form = creating
        creating = nil
    }
}

/// A failed write's message, in red above the rows.
private struct FailureLine: View {
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
