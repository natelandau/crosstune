import CrosstuneCommands
import CrosstuneStore
import GRDB
import SwiftUI

/// The iPad and Mac frame: a sidebar of destinations and lists, a content column with the
/// chosen one, and the tune in the detail column. The player floats in a panel at the foot of
/// the iPad's window and docks across the foot of the Mac's detail column.
struct SplitShell: View {
    let store: CrosstuneStore
    let player: PlayerModel
    let stage: EmbedStage
    @Bindable var place: ShellPlace
    /// Changes when the Recordings screen should come forward.
    let recordingsShown: Int
    let onRecord: @MainActor () -> Void

    @Environment(\.listSheets) private var listSheets
    @Environment(\.selecting) private var selecting
    @Environment(\.playerWindow) private var window
    @Environment(CatalogModel.self) private var catalog: CatalogModel?
    /// Nil until the first read, so a list chosen before the lists load is not taken for a deleted one.
    @State private var lists: LiveQuery<[ListSummary]?>?
    #if !os(macOS)
        @State private var deleting: ListSummary?
    #endif
    #if !os(macOS)
        @State private var playerFrame = CGRect.zero
    #endif
    @State private var columns = NavigationSplitViewVisibility.automatic
    #if os(macOS)
        @State private var counts: LiveQuery<CatalogCounts?>?
    #endif

    /// The lists the sidebar shows, in the musician's order.
    nonisolated static func sidebarLists(_ db: Database) throws -> [ListSummary] {
        try ListSummary.fetchAll(db)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebar
                #if os(macOS)
                    .navigationSplitViewColumnWidth(min: 200, ideal: 240)
                #else
                    .clearsPlayer(playerFrame)
                #endif
        } content: {
            contentColumn
                #if !os(macOS)
                    .clearsPlayer(playerFrame)
                #endif
                .navigationSplitViewColumnWidth(min: 300, ideal: 340)
                .environment(\.detailTune, detailTune)
                .environment(\.sidebarSelection, $place.sidebar)
        } detail: {
            detail
                .environment(\.detailTune, detailTune)
                .environment(\.sidebarSelection, $place.sidebar)
        }
        #if !os(macOS)
            .playerBar(player, stage: stage, frame: $playerFrame)
            .sheet(
                isPresented: Binding {
                    player.showsExpanded(in: window) && player.item?.kind == .recording
                } set: {
                    player.isExpanded = $0
                }
            ) {
                RecordingScreen(player: player)
                .presentationSizing(.page)
            }
        #endif
        // The panel always shows a link's player in full, so a play here must not leave the
        // iPhone's full player waiting to open if the window turns compact.
        .onChange(of: player.isExpanded, initial: true) {
            if player.isExpanded && player.item?.link != nil { player.isExpanded = false }
        }
        .task(id: store.userID) {
            lists = LiveQuery(store, initial: nil) { try Self.sidebarLists($0) }
            #if os(macOS)
                counts = LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) }
            #endif
        }
        .onChange(of: recordingsShown) {
            place.sidebar = .recordings
        }
        .onChange(of: lists?.value) {
            guard let loaded = lists?.value ?? nil else { return }
            place.sidebar = place.sidebar.kept(among: loaded.map(\.list))
        }
        #if os(macOS)
            .onChange(of: place.sidebar, initial: true) { syncSidebar(place: place, catalog: catalog) }
            .onChange(of: catalog?.status) { syncSidebar(place: place, catalog: catalog) }
        #endif
    }

    /// The detail column's tune as the screens see it. On a Mac, the practice view takes the
    /// column, and opening any tune closes it.
    private var detailTune: Binding<String?> {
        #if os(macOS)
            practiceAwareDetailTune(place, player: player, window: window)
        #else
            $place.detailTune
        #endif
    }

    @ViewBuilder private var detail: some View {
        #if os(macOS)
            let practicing = MacDetail.pick(player, in: window, tune: place.detailTune) == .practice
            ZStack {
                // The page stays mounted under the practice view, so closing it returns to the
                // page as it was left, scrolled where it was.
                tunePage
                    .playerDock(player, stage: stage)
                    .opacity(practicing ? 0 : 1)
                    .disabled(practicing)
                    .accessibilityHidden(practicing)
                if practicing {
                    // The practice view is the player in full, so the dock under it is hidden too.
                    // Its mode selector and controls hold a fixed width, so the column never
                    // squeezes it narrower than they need.
                    RecordingScreen(player: player)
                        .frame(minWidth: RecordingScreen.minimumWidth)
                }
            }
        #else
            tunePage
                .clearsPlayer(playerFrame)
        #endif
    }

    @ViewBuilder private var tunePage: some View {
        if let detailTune = place.detailTune {
            TuneScreen(tuneID: detailTune)
        } else {
            TuneDetailPlaceholder()
        }
    }

    /// A selecting screen's toolbar holds only what acts on the selection.
    private var recordShows: Bool { selecting?.isCovered != true }

    /// True while the Mac sidebar is open, so its own record button stands in for the toolbar's.
    private var sidebarHoldsRecord: Bool {
        #if os(macOS)
            columns != .doubleColumn && columns != .detailOnly
        #else
            false
        #endif
    }

    /// A row is always chosen: clearing the selection, as a Mac allows, chooses the catalog the
    /// content column falls back to anyway.
    private var sidebarSelection: Binding<SidebarItem?> {
        Binding {
            place.sidebar
        } set: {
            #if os(macOS)
                pickSidebarRow($0 ?? .catalog, place: place, catalog: catalog)
            #else
                place.sidebar = $0 ?? .catalog
            #endif
        }
    }

    @ViewBuilder private var sidebar: some View {
        #if os(macOS)
            MacSidebar(
                selection: sidebarSelection, lists: loadedLists, counts: counts?.value ?? nil,
                canRecord: recordShows, onRecord: onRecord, newList: newList
            )
        #else
            List(selection: sidebarSelection) {
                row(.catalog).tag(SidebarItem.catalog)
                row(.recordings).tag(SidebarItem.recordings)
                listsSection
                Section {
                    row(.settings).tag(SidebarItem.settings)
                }
            }
            .confirmsListDelete($deleting)
        #endif
    }

    /// The lists, nil until the first read.
    private var loadedLists: [ListSummary]? { lists?.value ?? nil }

    private func newList() {
        listSheets?.name(.new)
    }

    #if !os(macOS)
        private var listsSection: some View {
            Section {
                ForEach(loadedLists ?? []) { list in
                    listRow(list)
                }
                Button(SidebarItem.newList, systemImage: "plus", action: newList)
                    .disabled(listSheets == nil)
            } header: {
                Text(Destination.lists.title)
            }
        }

        private func listRow(_ list: ListSummary) -> some View {
            Label(list.name, systemImage: Destination.lists.systemImage)
                .badge(list.count)
                .tag(SidebarItem.list(id: list.id))
                .listRowActions(
                    onEdit: { listSheets?.name(.rename(listID: list.id, name: list.name)) },
                    onDelete: { deleting = list })
        }

        private func row(_ destination: Destination) -> some View {
            Label(destination.title, systemImage: destination.systemImage)
        }
    #endif

    /// A link in a column with no stack of its own replaces the detail column, so Settings,
    /// which pushes its stats screen, gets a stack that keeps the push in its column.
    @ViewBuilder private var contentColumn: some View {
        if place.sidebar == .settings {
            NavigationStack(path: $place.settingsPath) { contentWithToolbar }
        } else {
            contentWithToolbar
        }
    }

    private var contentWithToolbar: some View {
        content
            .toolbar {
                if recordShows && !sidebarHoldsRecord {
                    ToolbarItem(placement: .navigation) {
                        RecordToolbarButton(action: onRecord)
                    }
                }
            }
            .syncBadgeToolbar()
    }

    @ViewBuilder private var content: some View {
        if case .list(let id) = place.sidebar {
            ListScreen(listID: id)
                // Each list starts with fresh sheets, dialogs, and moves.
                .id(id)
        } else if let destination = place.sidebar.destination {
            DestinationScreen(destination: destination)
        }
    }
}

#if os(macOS)
    /// The musician picked `item` in the Mac sidebar. Picking the Catalog row or a status row is
    /// the only thing that writes the status filter, so a programmatic jump to the catalog
    /// never clears a status the musician set.
    @MainActor
    func pickSidebarRow(_ item: SidebarItem, place: ShellPlace, catalog: CatalogModel?) {
        if case .some(let status) = item.statusFilter, let catalog {
            StatusScope.choose(status, in: catalog)
        }
        place.sidebar = item
        syncSidebar(place: place, catalog: catalog)
    }

    /// Keeps a catalog row in step with the status filter in force, so a set status always shows
    /// as the selected row: after a jump to the catalog, a status set from a stats link or another
    /// window, or a failed write that put the stored filters back.
    @MainActor
    func syncSidebar(place: ShellPlace, catalog: CatalogModel?) {
        guard place.sidebar.statusFilter != nil else { return }
        let row = SidebarItem.catalogRow(status: catalog?.status)
        if place.sidebar != row { place.sidebar = row }
    }
#endif
