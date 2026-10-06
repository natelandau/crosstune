#if os(macOS)
    import CrosstuneCommands
    import CrosstuneStore
    import GRDB
    import SwiftUI

    /// The Mac frame: a sidebar of destinations, status filters, and lists, a content column with
    /// the chosen one, and the tune or the practice view in the detail column. The player docks
    /// across the foot of the detail column.
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
        @State private var columns = NavigationSplitViewVisibility.automatic
        @State private var counts: LiveQuery<CatalogCounts?>?

        /// The lists the sidebar shows, in the musician's order.
        nonisolated static func sidebarLists(_ db: Database) throws -> [ListSummary] {
            try ListSummary.fetchAll(db)
        }

        var body: some View {
            NavigationSplitView(columnVisibility: $columns) {
                MacSidebar(
                    selection: sidebarSelection, lists: loadedLists, counts: counts?.value ?? nil,
                    canRecord: recordShows, onRecord: onRecord, newList: newList
                )
                .navigationSplitViewColumnWidth(min: 200, ideal: 240)
            } content: {
                contentWithToolbar
                    .navigationSplitViewColumnWidth(min: 300, ideal: 340)
                    .environment(\.detailTune, detailTune)
                    .environment(\.sidebarSelection, $place.sidebar)
            } detail: {
                detail
                    .environment(\.detailTune, detailTune)
                    .environment(\.sidebarSelection, $place.sidebar)
            }
            // The dock shows a link's player in full, so a play here must not leave a full player
            // waiting to open.
            .onChange(of: player.isExpanded, initial: true) {
                if player.isExpanded && player.item?.link != nil { player.isExpanded = false }
            }
            .task(id: store.userID) {
                lists = LiveQuery(store, initial: nil) { try Self.sidebarLists($0) }
                counts = LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) }
            }
            .onChange(of: recordingsShown) {
                place.sidebar = .recordings
            }
            .onChange(of: lists?.value) {
                guard let loaded = lists?.value ?? nil else { return }
                place.sidebar = place.sidebar.kept(among: loaded.map(\.list))
            }
            .onChange(of: place.sidebar, initial: true) { syncSidebar(place: place, catalog: catalog) }
            .onChange(of: catalog?.status) { syncSidebar(place: place, catalog: catalog) }
        }

        /// The detail column's tune as the screens see it. The practice view takes the column, and
        /// opening any tune closes it.
        private var detailTune: Binding<String?> {
            practiceAwareDetailTune(place, player: player, window: window)
        }

        @ViewBuilder private var detail: some View {
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

        /// True while the sidebar is open, so its own record button stands in for the toolbar's.
        private var sidebarHoldsRecord: Bool {
            columns != .doubleColumn && columns != .detailOnly
        }

        /// A row is always chosen: clearing the selection chooses the catalog the content column
        /// falls back to anyway.
        private var sidebarSelection: Binding<SidebarItem?> {
            Binding {
                place.sidebar
            } set: {
                pickSidebarRow($0 ?? .catalog, place: place, catalog: catalog)
            }
        }

        /// The lists, nil until the first read.
        private var loadedLists: [ListSummary]? { lists?.value ?? nil }

        private func newList() {
            listSheets?.name(.new)
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
