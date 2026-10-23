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
        /// This window's identity for the shared player.
        let window: UUID
        /// Changes when the Recordings screen should come forward.
        let recordingsShown: Int
        let onRecord: @MainActor () -> Void

        @Environment(\.listSheets) private var listSheets
        @Environment(\.selecting) private var selecting
        @Environment(\.catalogCounts) private var counts
        @Environment(CatalogModel.self) private var catalog: CatalogModel?
        /// Nil until the first read, so a list chosen before the lists load is not taken for a deleted one.
        @State private var lists: LiveQuery<[ListSummary]?>?
        /// One value for both layouts, since a visibility means a different set of columns in a
        /// two-column split than in a three-column one.
        @State private var sidebarHidden = false
        /// The detail column's tune as the screens see it. The practice view takes the column, and
        /// opening any tune closes it.
        @State private var detailTune: ShellValue<String?>
        @State private var openedRow: ShellValue<SidebarItem>

        init(
            store: CrosstuneStore, player: PlayerModel, stage: EmbedStage, place: ShellPlace, window: UUID,
            recordingsShown: Int, onRecord: @escaping @MainActor () -> Void
        ) {
            self.store = store
            self.player = player
            self.stage = stage
            self.place = place
            self.window = window
            self.recordingsShown = recordingsShown
            self.onRecord = onRecord
            _detailTune = State(initialValue: practiceAwareDetailTune(place, player: player, window: window))
            _openedRow = State(
                initialValue: ShellValue {
                    place.sidebar
                } set: {
                    place.sidebar = $0
                })
        }

        /// The lists the sidebar shows, in the musician's order.
        nonisolated static func sidebarLists(_ db: Database) throws -> [ListSummary] {
            try ListSummary.fetchAll(db)
        }

        /// Whether `item` fills the content and detail columns rather than pairing a content
        /// column with the tune it opens. The tuner opens nothing to show beside it.
        nonisolated static func fillsDetail(_ item: SidebarItem) -> Bool {
            item == .tuner
        }

        /// Whether the sidebar is hidden with `columns`. A two-column split's double column is the
        /// sidebar and the detail; a three-column split's is the content and the detail.
        nonisolated static func sidebarHidden(_ columns: NavigationSplitViewVisibility, twoColumn: Bool) -> Bool {
            if columns == .detailOnly { return true }
            return !twoColumn && columns == .doubleColumn
        }

        /// The columns that show, with the sidebar hidden or not.
        nonisolated static func visibility(sidebarHidden: Bool, twoColumn: Bool) -> NavigationSplitViewVisibility {
            guard sidebarHidden else { return .all }
            return twoColumn ? .detailOnly : .doubleColumn
        }

        var body: some View {
            split
                .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
                // The dock shows a link's player in full, so a play here must not leave a full player
                // waiting to open.
                .onChange(of: player.isExpanded, initial: true) {
                    if player.isExpanded && player.item?.link != nil { player.isExpanded = false }
                }
                .task(id: store.userID) {
                    lists = LiveQuery(store, initial: nil) { try Self.sidebarLists($0) }
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

        @ViewBuilder private var split: some View {
            // The two layouts are different split views, so moving between them rebuilds the
            // sidebar, which keeps its selection in the place and scrolls back to it.
            if Self.fillsDetail(place.sidebar) {
                NavigationSplitView(columnVisibility: columns(twoColumn: true)) {
                    sidebar
                } detail: {
                    withShellToolbar(DestinationScreen(destination: .tuner))
                        .playerDock(player, stage: stage)
                        .columnGround()
                        .environment(\.detailTune, detailTune)
                        .environment(\.sidebarSelection, openedRow)
                }
            } else {
                NavigationSplitView(columnVisibility: columns(twoColumn: false)) {
                    sidebar
                } content: {
                    withShellToolbar(content)
                        .columnGround()
                        .navigationSplitViewColumnWidth(min: 300, ideal: 340)
                        .environment(\.detailTune, detailTune)
                        .environment(\.sidebarSelection, openedRow)
                } detail: {
                    detail
                        .columnGround()
                        .environment(\.detailTune, detailTune)
                        .environment(\.sidebarSelection, openedRow)
                }
            }
        }

        private var sidebar: some View {
            MacSidebar(
                selection: sidebarSelection, lists: loadedLists, counts: counts?.value ?? nil,
                canRecord: recordShows, onRecord: onRecord, newList: newList
            )
            .navigationSplitViewColumnWidth(min: 200, ideal: 240)
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
        private var sidebarHoldsRecord: Bool { !sidebarHidden }

        private func columns(twoColumn: Bool) -> Binding<NavigationSplitViewVisibility> {
            Binding {
                Self.visibility(sidebarHidden: sidebarHidden, twoColumn: twoColumn)
            } set: {
                sidebarHidden = Self.sidebarHidden($0, twoColumn: twoColumn)
            }
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

        /// The first column after the sidebar, with Record while the sidebar is hidden and the
        /// sync badge.
        private func withShellToolbar(_ column: some View) -> some View {
            column
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

    extension View {
        /// A content or detail column on the paper ground, with no toolbar hairline until its
        /// content scrolls under the bar.
        fileprivate func columnGround() -> some View {
            background(Palette.ground)
                .scrollEdgeEffectStyle(.soft, for: .top)
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
