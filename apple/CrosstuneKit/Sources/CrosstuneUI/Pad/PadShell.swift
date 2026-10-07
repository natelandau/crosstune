#if os(iOS)
    import CrosstuneStore
    import SwiftUI

    /// The regular-width iPad frame: a tab view that is a sidebar in wide windows and a top bar
    /// in narrow ones, each tab a split of its content and the tune or page it opens, with
    /// Record and the player in one capsule at the window's foot.
    struct PadShell: View {
        private let player: PlayerModel
        private let stage: EmbedStage
        @Bindable private var place: ShellPlace
        /// Changes when the Recordings tab should come forward.
        private let recordingsShown: Int
        private let onRecord: @MainActor () -> Void

        @Environment(\.store) private var store
        @Environment(\.listSheets) private var listSheets
        @Environment(\.selecting) private var selecting
        @Environment(CatalogModel.self) private var catalog: CatalogModel?
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        /// Read from inside the tabs, since the tab view sets it only for its own content.
        @State private var inSidebar = false
        @State private var rowsHidden = false
        /// Nil until the first read, so a list open before the lists load is not taken for a
        /// deleted one.
        @State private var lists: LiveQuery<[ListSummary]?>?
        @State private var counts: LiveQuery<CatalogCounts?>?
        @State private var deleting: ListSummary?
        @State private var tabWidth: CGFloat = 0

        init(
            player: PlayerModel, stage: EmbedStage, place: ShellPlace, recordingsShown: Int,
            onRecord: @escaping @MainActor () -> Void
        ) {
            self.player = player
            self.stage = stage
            self.place = place
            self.recordingsShown = recordingsShown
            self.onRecord = onRecord
        }

        var body: some View {
            TabView(selection: selection) {
                Tab(
                    Destination.catalog.title, systemImage: Destination.catalog.systemImage,
                    value: Slot.tab(.destination(.catalog))
                ) {
                    split(.catalog)
                }
                // Every choice after Any is a status, whose id is that status.
                ForEach(StatusScope.choices(counts?.value ?? nil).dropFirst()) { choice in
                    Tab(choice.label, systemImage: choice.systemImage, value: Slot.tab(.status(choice.id))) {
                        split(.catalog)
                    }
                    .badge(sidebarCount(choice.count))
                    .tabPlacement(.sidebarOnly)
                    .hidden(rowsHidden)
                }
                destinationTab(.recordings)
                destinationTab(.lists)
                ForEach(loadedLists ?? []) { list in
                    Tab(list.name, systemImage: Destination.lists.systemImage, value: Slot.tab(.list(id: list.id))) {
                        split(.lists)
                    }
                    .badge(sidebarCount(list.count))
                    .tabPlacement(.sidebarOnly)
                    .hidden(rowsHidden)
                    .listRowActions(
                        onEdit: { listSheets?.name(.rename(listID: list.id, name: list.name)) },
                        onDelete: { deleting = list })
                }
                Tab(SidebarItem.newList, systemImage: "plus", value: Slot.newList) {
                    Color.clear
                }
                .tabPlacement(.sidebarOnly)
                .hidden(rowsHidden)
                .disabled(listSheets == nil)
                destinationTab(.settings)
            }
            .tabViewStyle(.sidebarAdaptable)
            // The sidebar breaks its rows' words at accessibility sizes, so the window starts in
            // the top bar there. The person's toggle still wins.
            .defaultAdaptableTabBarPlacement(dynamicTypeSize.isAccessibilitySize ? .tabBar : .automatic)
            .tabViewSidebarHeader {
                // The header has no Select All competing for its edge, so the badge stays while selecting.
                SyncBadgeItem(hidesWhileSelecting: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay(alignment: .bottom) {
                if selecting?.isCovered != true {
                    GlassEffectContainer {
                        PadFoot(player: player, onRecord: onRecord)
                    }
                    .padding(.horizontal, PadStyle.footSideMargin)
                    .padding(.bottom, PadStyle.footInset)
                }
            }
            .confirmsListDelete($deleting)
            .modifier(PlayerPresentations(player: player, stage: stage, zoom: nil, standsWithReading: true))
            .task(id: store?.userID) {
                lists = store.map { store in LiveQuery(store, initial: nil) { try ListSummary.fetchAll($0) } }
                counts = store.map { store in LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) } }
            }
            .onChange(of: lists?.value) {
                PadTab.closeDeletedList(place: place, lists: loadedLists?.map(\.id))
            }
            // Out of the sidebar the status and list rows hide, or the top bar keeps the last one
            // chosen as an extra item that crowds out the tabs. They hide a turn after the form
            // change, since hiding them within it leaves the columns' top inset under the bar.
            .task(id: inSidebar) {
                if inSidebar {
                    rowsHidden = false
                } else {
                    await Task.yield()
                    if !Task.isCancelled { rowsHidden = true }
                }
            }
            .onChange(of: recordingsShown) {
                place.tab = .recordings
            }
        }

        /// A place in the tab view. New list never stays chosen: choosing it opens the new list
        /// sheet.
        private enum Slot: Hashable {
            case tab(PadTab)
            case newList
        }

        /// The chosen tab, read from the shell's place and the status filter, so a form change
        /// moves a status or list row back to its top-level tab, and a choice writes the place.
        private var selection: Binding<Slot> {
            Binding {
                .tab(PadTab.selected(place: place, status: catalog?.status, inSidebar: rowsShown))
            } set: { slot in
                switch slot {
                case .tab(let tab): PadTab.choose(tab, place: place, catalog: catalog, inSidebar: rowsShown)
                case .newList: listSheets?.name(.new)
                }
            }
        }

        /// Whether the sidebar's status and list rows show. A hidden row cannot be chosen, so a row
        /// shows as chosen, and a choice reads as the sidebar's, only once the rows show.
        private var rowsShown: Bool { inSidebar && !rowsHidden }

        /// A row's count, shown only in the sidebar: the top bar keeps the last chosen row as an
        /// extra item, where a count would read as a notification badge.
        private func sidebarCount(_ count: Int?) -> Int {
            inSidebar ? count ?? 0 : 0
        }

        /// The lists, nil until the first read.
        private var loadedLists: [ListSummary]? { lists?.value ?? nil }

        private func destinationTab(_ destination: Destination) -> some TabContent<Slot> {
            Tab(destination.title, systemImage: destination.systemImage, value: Slot.tab(.destination(destination))) {
                split(destination)
            }
        }

        /// The content column beside the detail column. A fixed pair rather than a
        /// `NavigationSplitView`, which in a narrow portrait window floats the content column over
        /// the detail behind a scrim and, with its visibility pinned, cannot bring it back.
        private func split(_ destination: Destination) -> some View {
            HStack(spacing: 0) {
                content(destination)
                    .toolbarTitleDisplayMode(.inlineLarge)
                    .safeAreaPadding(.bottom, PadStyle.footClearance)
                    .frame(width: PadStyle.contentColumnWidth(in: tabWidth))
                Divider().ignoresSafeArea()
                detail(destination)
                    .safeAreaPadding(.bottom, PadStyle.footClearance)
                    .frame(maxWidth: .infinity)
            }
            .onGeometryChange(for: CGFloat.self, of: \.size.width) { tabWidth = $0 }
            .environment(\.inPadSplit, true)
            .environment(\.detailTune, destination == .settings ? nil : tune(destination))
            .environment(\.scrollAnchor, scrollAnchor(destination))
            .background {
                TabBarPlacementReader { inSidebar = $0 }
            }
        }

        @ViewBuilder private func content(_ destination: Destination) -> some View {
            let screen = column(destination)
            switch destination {
            case .lists:
                NavigationStack(path: $place.listPath) { screen }
            case .settings:
                NavigationStack { screen }
                    // A row the root opens replaces the detail column's page rather than pushing here.
                    .environment(
                        \.settingsPageOpener,
                        SettingsPageOpener(current: place.settingsPage) { place.settingsPage = $0 })
            case .catalog, .recordings:
                NavigationStack { screen }
            }
        }

        @ViewBuilder private func column(_ destination: Destination) -> some View {
            let screen = DestinationScreen(destination: destination)
            if destination == .catalog {
                // The sidebar's header holds the badge in the sidebar form.
                screen.syncBadgeToolbar(leading: true, isShown: !inSidebar)
            } else {
                screen
            }
        }

        @ViewBuilder private func detail(_ destination: Destination) -> some View {
            if destination == .settings {
                NavigationStack {
                    SettingsDetail(page: place.settingsPage)
                }
                // A tune pushed over one page does not belong to the next.
                .id(place.settingsPage)
            } else {
                NavigationStack {
                    PadDetail(tuneID: place.tabTunes[destination])
                }
                // A tune page opens one of its lists on the Lists tab, never over the detail column.
                .environment(\.sidebarSelection, openList)
            }
        }

        private func tune(_ destination: Destination) -> Binding<String?> {
            Binding {
                place.tabTunes[destination]
            } set: {
                place.tabTunes[destination] = $0
            }
        }

        private func scrollAnchor(_ destination: Destination) -> Binding<String?> {
            Binding {
                place.scrollAnchors[destination]
            } set: {
                place.scrollAnchors[destination] = $0
            }
        }

        private var openList: Binding<SidebarItem> {
            Binding {
                PadTab.openList(place: place)
            } set: { item in
                PadTab.openList(item, place: place)
            }
        }
    }

    /// Reports whether the tab view around it shows as a sidebar.
    private struct TabBarPlacementReader: View {
        let onChange: @MainActor (Bool) -> Void

        @Environment(\.tabBarPlacement) private var placement

        var body: some View {
            Color.clear
                .onChange(of: placement == .sidebar, initial: true) { _, inSidebar in onChange(inSidebar) }
        }
    }
#endif
