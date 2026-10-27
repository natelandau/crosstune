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
    // periphery:ignore - read through its binding
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
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
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
    @Environment(\.plan) private var plan
    @Environment(\.premium) private var premium
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
    @State private var confirmsDelete = false
    @State private var selection = TuneSelection()
    @State private var nameShows = true
    #if os(macOS)
        @Environment(\.openSheets) private var openSheets
        /// This screen's own Select tunes, never taken for another window's.
        @State private var selectActionID = UUID()
    #endif
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
                .pageBackground()
                .accentSelectionTint()
            #endif
            .overlay {
                if model.showArchived != nil {
                    emptyState(rows)
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
                .barTitle(
                    selection.isActive ? TuneSelection.title(selection.ids.count) : list.name,
                    shown: selection.isActive || model.showArchived == nil
                        || !nameShows
                )
            #else
                // The bar stays as it is while selecting, so nothing in it moves; the selection's
                // actions are in the list's selection bar.
                .paneBar {
                    Group {
                        if let play = offer(rows) { MacListPlayButtons(play: play) }
                        listActions(rows)
                    }
                    .disabled(selection.isActive)
                }
                .columnTitled(macTitle)
                .focusedSceneValue(
                    \.selectTunesAction,
                    MenuCommandAvailability.select(
                        isShown: true, sheetsOpen: openSheets?.isCovered == true, selecting: selection.isActive,
                        hasRows: !rows.isEmpty)
                        ? MenuAction(id: selectActionID) { selection.enter() } : nil
                )
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
            .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: zoom))
            .sheet(isPresented: $picking) {
                TunePickerSheet(listID: list.id, onLateFailure: model.report)
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
            #if DEBUG
                .opensForSample(.tunePicker) { picking = true }
                .opensForSample(.whatPlays) { showsWhatPlays = true }
            #endif
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
                    MacListTitle(name: macTitle, play: playOffer(rows), isSelecting: selection.isActive)
                        .listRowInsets(MacStyle.columnRowInsets())
                        .plainListRow()
                #else
                    // Stays in the list while selecting, hidden, so it keeps reporting its visibility.
                    ListNameHeading(name: list.name) { nameShows = $0 }
                        .opacity(selection.isActive ? 0 : 1)
                        .accessibilityHidden(selection.isActive)
                        .listRowInsets(EdgeInsets(top: PageStyle.pageMargin, leading: 20, bottom: 0, trailing: 20))
                        .plainListRow()
                    if let play = playOffer(rows) {
                        ListPlayControls(offer: play)
                            .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                            .plainListRow()
                    }
                #endif
                ForEach(rows.enumerated(), id: \.element.id) { index, entry in
                    row(entry, index: index, count: rows.count, reorderable: rows.count > 1 && !selection.isActive)
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

    /// What Play, Shuffle, and the line under them act on, or nil while they are disabled: with no
    /// tunes, while selecting, and until the access read.
    private func playOffer(_ rows: [ListEntry]) -> ListPlayAvailability? {
        selection.isActive ? nil : offer(rows)
    }

    /// ``playOffer(_:)`` whether selecting or not, for the Mac's pane bar, which keeps its
    /// controls while selecting.
    private func offer(_ rows: [ListEntry]) -> ListPlayAvailability? {
        guard !rows.isEmpty, hasReadAppleMusic else { return nil }
        let report = playReport(rows)
        let playing = listPlaying
        return ListPlayAvailability(
            report: report, canStart: listPlayback != nil && !(recorders?.isCapturing ?? false),
            playing: playing,
            onPlay: { playing == nil ? startPlaylist(report, shuffled: false) : togglePlaylist() },
            onShuffle: { startPlaylist(report, shuffled: true) },
            onWhatPlays: { showsWhatPlays = true })
    }

    /// This list as it plays, or nil while another list or nothing plays.
    private var listPlaying: ListPlayAvailability.Playing? {
        guard let listPlayback, listPlayback.listID == list.id else { return nil }
        // Until the tune loads, the transport still plays the tune being left.
        let settled = listPlayback.isSettled
        return ListPlayAvailability.Playing(
            isPlaying: settled && player?.transport?.isPlaying == true, isSettled: settled)
    }

    private func togglePlaylist() {
        guard listPlayback?.isSettled == true, let transport = player?.transport else { return }
        if transport.isPlaying { transport.pause() } else { transport.play() }
    }

    /// Controls wait for the access read, so the count never flashes a subscription skip.
    private var hasReadAppleMusic: Bool {
        player?.appleMusic?.access == nil || appleMusic != nil
    }

    private func readAppleMusic() async {
        guard let access = player?.appleMusic?.access else { return }
        appleMusic = await access.current()
    }

    private var recordingsPlay: Bool { plan.recordingsPlay }

    private func playReport(_ rows: [ListEntry]) -> PlaylistReport {
        let online = session?.hasNetwork ?? true
        return playlistReport(
            entries: rows.map { $0.playlistEntry(online: online) }, playFirst: model.playFirst,
            fullTracks: appleMusic == .fullTracks, online: online, recordingsPlay: recordingsPlay)
    }

    private func startPlaylist(_ report: PlaylistReport, shuffled: Bool) {
        guard let listPlayback else { return }
        listPlayback.start(listID: list.id, name: list.name, report: report, shuffled: shuffled)
    }

    private func openChosen() {
        guard let id = chosen else { return }
        chosen = nil
        open(id)
    }

    private func open(_ tuneID: String) {
        if let detailTune {
            detailTune.value = tuneID
        } else {
            pushed = tuneID
        }
    }

    #if os(macOS)
        /// The column title, which counts the selection in its place.
        private var macTitle: String {
            selection.isActive ? TuneSelection.selectedTitle(selection.ids.count) : list.name
        }

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

    private func row(_ entry: ListEntry, index: Int, count: Int, reorderable: Bool) -> some View {
        let position = index + 1
        let moves = MovePlace.places(at: index, count: count)
        let playAction = ListRowPlay.action(
            for: entry, playFirst: model.playFirst, loaded: { player?.holds(.recording, id: $0) ?? false },
            downloading: { transfers?.isDownloading($0) ?? false }, recordingsPlay: recordingsPlay)
        let isCurrent = ListRowPlay.isNowPlaying(
            listID: list.id, playingListID: listPlayback?.listID, currentTuneID: listPlayback?.currentTuneID,
            tuneID: entry.tune.id)
        #if os(macOS)
            // The list draws the key in the slot the row's play shares, so the two never crowd.
            let tuneRow = TuneRow(
                tune: entry.tune, userTune: entry.userTune, instruments: model.instruments, position: position,
                showsKey: false)
        #else
            let tuneRow = TuneRow(
                tune: entry.tune, userTune: entry.userTune, instruments: model.instruments, position: position)
        #endif
        let hint = ListRowText.hint(hasAction: playAction != nil, isCurrent: isCurrent, isSelecting: selection.isActive)
        let edit = { open(entry.tune.id) }
        let remove: () -> Void = { Task { await model.remove(entry) } }
        let scans = TuneRowActions.scansAction(
            tuneID: entry.tune.id, tunesWithScans: scanTunes, premium: premium, origin: .list(id: list.id),
            actions: tuneScreenActions)
        return HStack(spacing: spacing(4)) {
            if detailTune != nil || selection.isActive {
                // The list's selection drives the detail column, or is the selection.
                tuneRow
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityHint(hint)
                    .modifier(MoveActions(reorderable: reorderable) { moveButtons(entry, moves) })
                    #if os(macOS)
                        .selectionCheckbox(
                            selection.isActive, title: entry.tune.title,
                            isOn: TuneSelection.checkbox($selection, row: entry.tune.id) { model.rows.map(\.tune.id) })
                    #endif
            } else {
                Button {
                    pushed = entry.tune.id
                } label: {
                    tuneRow
                        .foregroundStyle(.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                // Not the automatic style, so the play button beside the row keeps its own tap.
                .buttonStyle(.plain)
                .accessibilityHint(hint)
                .modifier(MoveActions(reorderable: reorderable) { moveButtons(entry, moves) })
                .matchedTransitionSource(id: entry.tune.id, in: zoom)
            }
            #if os(macOS)
                // The key and play share one trailing slot, so keys line up with the catalog's
                // and titles keep their width in a narrow column. Dragging the row reorders; Move
                // is in its context menu and its accessibility actions.
                ListRowKeySlot(
                    key: KeyModeText(key: entry.tune.key, modes: entry.tune.modes),
                    revealsPlay: !selection.isActive
                        && ListRowKeySlot.revealsPlay(action: playAction, isCurrent: isCurrent),
                    pinned: isCurrent || playAction == .downloading
                ) {
                    if !selection.isActive {
                        ListRowPlayButton(entry: entry, action: playAction, listID: list.id)
                    }
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
                .tint(Palette.dangerFillStrong)
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
                .tint(Palette.neutralFill)
            if let scans { ScansRowAction(action: scans) }
            #if os(iOS)
                if reorderable { moveMenu(entry, moves) }
            #endif
        } menu: {
            if let scans { ScansRowAction(action: scans) }
            Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: edit)
            if reorderable { moveItems(entry, moves) }
            Button(ListScreen.remove, systemImage: "text.badge.xmark", role: .destructive) { remove() }
            Divider()
            Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter(with: entry.tune.id) }
        } preview: {
            TunePreview(entry: entry.catalogEntry, instruments: model.instruments)
        }
        #if os(macOS)
            .listRowBackground(isCurrent && !selection.isActive ? currentRowTint : nil)
        #else
            .listRowBackground(
                TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune)
                    && !(isCurrent && !selection.isActive)
                    ? nil : rowBackground(isCurrent: isCurrent && !selection.isActive)
            )
        #endif
        .statusRingOnFill(
            isCurrent && !selection.isActive
                || TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune)
        )
        .accessibilityFocused($focusedRow, equals: entry.tune.id)
        #if os(macOS)
            .macRowSelected(TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune))
        #endif
        .tag(entry.tune.id)
        .moveDisabled(!reorderable)
    }

    /// The playing tune's tint, or nothing, so the list's background shows through.
    @ViewBuilder private func rowBackground(isCurrent: Bool) -> some View {
        if isCurrent { currentRowTint } else { Color.clear }
    }

    /// The light tint on the tune a playing list is on.
    @ViewBuilder private var currentRowTint: some View {
        #if os(macOS)
            // Inset and rounded as the selection is, so the two read as one family.
            RoundedRectangle(cornerRadius: 6)
                .fill(Palette.tintSubtle(colorScheme))
                .padding(.horizontal, MacStyle.selectionInset)
        #else
            Palette.tintSubtle(colorScheme)
        #endif
    }

    #if os(iOS)
        /// Move as a menu on the row's swipe, since the row carries no move button.
        private func moveMenu(_ entry: ListEntry, _ moves: [MovePlace]) -> some View {
            Menu {
                Section(ListScreen.move(entry.tune.title)) {
                    moveButtons(entry, moves)
                }
            } label: {
                Label(ListScreen.reorder(entry.tune.title), systemImage: "arrow.up.arrow.down")
            }
            .tint(Palette.neutralFill)
        }
    #endif

    /// The row's moves, from its place among the rows the list draws, so building them never
    /// reads the whole list again.
    @ViewBuilder private func moveButtons(_ entry: ListEntry, _ moves: [MovePlace]) -> some View {
        ForEach(moves, id: \.self) { place in
            Button(place.label, systemImage: place.systemImage) { model.move(entry, to: place) }
        }
    }

    /// The row's move menu, in its context menu.
    private func moveItems(_ entry: ListEntry, _ moves: [MovePlace]) -> some View {
        Menu(ListScreen.moveSubmenu, systemImage: "arrow.up.arrow.down") {
            moveButtons(entry, moves)
        }
    }

    private func move(_ indices: IndexSet, _ offset: Int) {
        guard indices.count == 1, let from = indices.first else { return }
        model.move(from: from, to: MovePlace.dropTarget(from: from, offset: offset))
    }

    @ViewBuilder private func emptyState(_ rows: [ListEntry]) -> some View {
        if model.entries.isEmpty {
            ContentUnavailableView {
                Label(ListScreen.emptyTitle, systemImage: Destination.lists.systemImage)
            } description: {
                Text(ListScreen.emptyHint)
            } actions: {
                Button(ListScreen.addTunes) { picking = true }
                    .buttonStyle(.accentProminent)
            }
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label(ListScreen.allArchivedTitle, systemImage: Destination.lists.systemImage)
            } description: {
                Text(ListScreen.archivedHint)
            } actions: {
                Button(ListScreen.showArchived) { Task { await model.setShowArchived(true) } }
                    .buttonStyle(.accentProminent)
            }
        }
    }
}

extension View {
    /// A list row's swipe actions and context menu, or neither while the row is selecting. The
    /// condition sits inside each builder, since an empty menu shows nothing and the row keeps
    /// one shape either way.
    fileprivate func selectableRowActions(
        isSelecting: Bool, @ViewBuilder swipe: () -> some View, @ViewBuilder menu: () -> some View,
        @ViewBuilder preview: () -> some View
    ) -> some View {
        let swipeItems = swipe()
        let menuItems = menu()
        return swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !isSelecting { swipeItems }
        }
        .contextMenu {
            if !isSelecting { menuItems }
        } preview: {
            preview()
        }
    }
}

/// A list row's moves as accessibility actions, which have no move button on the row, so they
/// are reachable without the context menu.
private struct MoveActions<Buttons: View>: ViewModifier {
    let reorderable: Bool
    @ViewBuilder let buttons: () -> Buttons

    func body(content: Content) -> some View {
        content.accessibilityActions {
            if reorderable { buttons() }
        }
    }
}

#if os(iOS)
    /// The list's name as the first heading of the page, which scrolls away under the bar.
    private struct ListNameHeading: View {
        let name: String
        let onShows: (Bool) -> Void

        var body: some View {
            Text(name)
                .contentMask()
                .font(PageStyle.pageTitle)
                .tracking(PageStyle.pageTitleTracking)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .onScrollVisibilityChange(threshold: 0.5, onShows)
        }
    }
#endif
