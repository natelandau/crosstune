#if os(iOS)
    import CrosstuneStore
    import SwiftUI

    /// The regular-width iPad frame: a tab view that is a sidebar in wide windows and a top bar
    /// in narrow ones, each tab a split of its content and the tune or page it opens, Record in
    /// the bar's prominent slot, and the player in a capsule at the window's foot.
    struct PadShell: View {
        private let player: PlayerModel
        private let stage: EmbedStage
        @Bindable private var place: ShellPlace
        /// Changes when the Recordings tab should come forward.
        private let recordingsShown: Int
        private let onRecord: @MainActor () -> Void

        @Environment(\.store) private var store
        @Environment(\.listSheets) private var listSheets
        @Environment(CatalogModel.self) private var catalog: CatalogModel?
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        @Environment(\.catalogCounts) private var counts
        @Environment(\.recordCover) private var recordCover
        /// Read from inside the tabs, since the tab view sets it only for its own content.
        @State private var inSidebar = false
        @State private var rowsHidden = false
        /// Nil until the first read, so a list open before the lists load is not taken for a
        /// deleted one.
        @State private var lists: LiveQuery<[ListSummary]?>?
        @State private var deleting: ListSummary?
        @State private var tabWidth = PadTabWidth()
        /// Made once, so the screens' environment stays the same from one shell pass to the next.
        @State private var tabTunes: [Destination: ShellValue<String?>]
        @State private var scrollAnchors: [Destination: ShellValue<String?>]
        @State private var openList: ShellValue<SidebarItem>

        init(
            player: PlayerModel, stage: EmbedStage, place: ShellPlace, recordingsShown: Int,
            onRecord: @escaping @MainActor () -> Void
        ) {
            self.player = player
            self.stage = stage
            self.place = place
            self.recordingsShown = recordingsShown
            self.onRecord = onRecord
            _tabTunes = State(initialValue: Self.perDestination(\.tabTunes, of: place))
            _scrollAnchors = State(initialValue: Self.perDestination(\.scrollAnchors, of: place))
            _openList = State(
                initialValue: ShellValue {
                    PadTab.openList(place: place)
                } set: {
                    PadTab.openList($0, place: place)
                })
        }

        /// One value per destination, each reading and writing that destination's entry in `place`.
        private static func perDestination(
            _ field: ReferenceWritableKeyPath<ShellPlace, [Destination: String]>, of place: ShellPlace
        ) -> [Destination: ShellValue<String?>] {
            Dictionary(
                uniqueKeysWithValues: Destination.allCases.map { destination in
                    let value = ShellValue {
                        place[keyPath: field][destination]
                    } set: {
                        place[keyPath: field][destination] = $0
                    }
                    return (destination, value)
                })
        }

        var body: some View {
            TabView(selection: selection) {
                Tab(
                    Destination.catalog.title, systemImage: Destination.catalog.systemImage,
                    value: PadSlot.tab(.destination(.catalog))
                ) {
                    split(.catalog)
                }
                // Every choice after Any is a status, whose id is that status.
                ForEach(StatusScope.choices(counts?.value ?? nil).dropFirst()) { choice in
                    Tab(choice.label, systemImage: choice.systemImage, value: PadSlot.tab(.status(choice.id))) {
                        split(.catalog)
                    }
                    .badge(sidebarCount(choice.count))
                    .tabPlacement(.sidebarOnly)
                    .hidden(rowsHidden)
                }
                destinationTab(.recordings)
                destinationTab(.tuner)
                destinationTab(.lists)
                ForEach(loadedLists ?? []) { list in
                    Tab(list.name, systemImage: Destination.lists.systemImage, value: PadSlot.tab(.list(id: list.id))) {
                        split(.lists)
                    }
                    .badge(sidebarCount(list.count))
                    .tabPlacement(.sidebarOnly)
                    .hidden(rowsHidden)
                    .listRowActions(
                        onEdit: { listSheets?.name(.rename(listID: list.id, name: list.name)) },
                        onDelete: { deleting = list })
                }
                Tab(SidebarItem.newList, systemImage: "plus", value: PadSlot.newList) {
                    Color.clear
                }
                .tabPlacement(.sidebarOnly)
                .hidden(rowsHidden)
                .disabled(listSheets == nil)
                destinationTab(.settings)
                // Left out rather than hidden where Record is no tab, since the search role it
                // would fall back to draws a search field in the iPad's bars.
                if RecordControl.isTab {
                    Tab(value: PadSlot.record, role: RecordControl.tabRole) {
                        Color.clear
                    } label: {
                        Label {
                            Text(RecordControl.shortLabel)
                        } icon: {
                            Image(uiImage: RecordControl.tabDot(enabled: recordIsEnabled))
                        }
                    }
                    .accessibilityLabel(RecordControl.label)
                    .disabled(!recordIsEnabled)
                    .tabPlacement(.pinned)
                }
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
                PadFootSlot(player: player, onRecord: onRecord)
            }
            .confirmsListDelete($deleting)
            .modifier(PlayerPresentations(player: player, stage: stage, zoom: nil, standsWithReading: true))
            .task(id: store?.userID) {
                lists = store.map { store in LiveQuery(store, initial: nil) { try ListSummary.fetchAll($0) } }
            }
            .onChange(of: lists?.value) {
                PadTab.closeDeletedList(place: place, lists: loadedLists?.map(\.id))
            }
            // A status set outside the sidebar, as from the filter row or a stats link, opens
            // another status row, where the last status's place does not belong.
            .onChange(of: catalog?.status) {
                place.scrollAnchors[.catalog] = nil
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

        /// The chosen tab, read from the shell's place and the status filter, so a form change
        /// moves a status or list row back to its top-level tab, and a choice writes the place.
        private var selection: Binding<PadSlot> {
            Binding {
                .tab(PadTab.selected(place: place, status: catalog?.status, inSidebar: rowsShown))
            } set: { slot in
                switch slot {
                case .tab(let tab): PadTab.choose(tab, place: place, catalog: catalog, inSidebar: rowsShown)
                case .newList: listSheets?.name(.new)
                // Writes nothing, so the selection reads the current tab back.
                case .record: onRecord()
                }
            }
        }

        private var recordIsEnabled: Bool { TabSlot.recordIsEnabled(cover: recordCover) }

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

        private func destinationTab(_ destination: Destination) -> some TabContent<PadSlot> {
            Tab(destination.title, systemImage: destination.systemImage, value: PadSlot.tab(.destination(destination)))
            {
                split(destination)
            }
        }

        /// A tab's columns, with the environment its screens read.
        private func split(_ destination: Destination) -> some View {
            columns(destination)
                .environment(\.inPadSplit, true)
                .environment(\.detailTune, destination == .settings ? nil : tabTunes[destination])
                .environment(\.scrollAnchor, scrollAnchors[destination])
                .background {
                    TabBarPlacementReader { inSidebar = $0 }
                }
        }

        /// The content column beside the detail column, or the content alone for a destination
        /// with no detail. A fixed pair rather than a `NavigationSplitView`, which in a narrow
        /// portrait window floats the content column over the detail behind a scrim and, with its
        /// visibility pinned, cannot bring it back.
        @ViewBuilder private func columns(_ destination: Destination) -> some View {
            let column = content(destination)
                .toolbarTitleDisplayMode(.inlineLarge)
                .modifier(PadFootClearance(player: player))
            if PadTab.hasDetailColumn(destination) {
                PadColumns(width: tabWidth) {
                    column
                } detail: {
                    detail(destination)
                        .modifier(PadFootClearance(player: player))
                }
            } else {
                column
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
                    .environment(\.settingsPageOpener, SettingsPageOpener(place: place))
            case .catalog, .recordings, .tuner:
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

    }

    /// The foot capsule while it has anything to hold and no selection hides it. Its own view, so
    /// the player loading redraws the foot rather than the whole shell.
    private struct PadFootSlot: View {
        let player: PlayerModel
        let onRecord: @MainActor () -> Void

        @Environment(\.selecting) private var selecting
        @Environment(ListPlayback.self) private var playback: ListPlayback?

        var body: some View {
            let isShown = PadFoot.isShown(showsRecord: !RecordControl.isTab, player, playback)
            ZStack {
                if selecting?.isCovered != true && isShown {
                    GlassEffectContainer {
                        PadFoot(player: player, showsRecord: !RecordControl.isTab, onRecord: onRecord)
                    }
                    .padding(.horizontal, PadStyle.footSideMargin)
                    .padding(.bottom, PadStyle.footInset)
                    // The player's bar leaves its rise to the foot, so a capsule that arrives with
                    // it brings it in.
                    .phoneTransition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .phoneAnimation(.snappy, value: isShown)
        }
    }

    /// Leaves room under a column's last row for the foot capsule while it shows.
    private struct PadFootClearance: ViewModifier {
        let player: PlayerModel

        @Environment(ListPlayback.self) private var playback: ListPlayback?

        func body(content: Content) -> some View {
            let footShown = PadFoot.isShown(showsRecord: !RecordControl.isTab, player, playback)
            content.safeAreaPadding(.bottom, PadStyle.footClearance(footShown: footShown))
        }
    }

    /// The tab view's width, which every tab's columns share. A reference, so a resize redraws
    /// the columns that read it rather than the whole shell and every tab's screens.
    @MainActor @Observable
    private final class PadTabWidth {
        var value: CGFloat = 0
    }

    /// The content column at its share of the tab's width beside the detail column.
    private struct PadColumns<Content: View, Detail: View>: View {
        let width: PadTabWidth
        @ViewBuilder let content: Content
        @ViewBuilder let detail: Detail

        var body: some View {
            HStack(spacing: 0) {
                content
                    .frame(width: PadStyle.contentColumnWidth(in: width.value))
                Divider().ignoresSafeArea()
                detail
                    .frame(maxWidth: .infinity)
            }
            .onGeometryChange(for: CGFloat.self, of: \.size.width) { width.value = $0 }
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
