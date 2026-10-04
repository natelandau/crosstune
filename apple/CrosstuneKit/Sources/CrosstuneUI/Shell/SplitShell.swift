import CrosstuneCommands
import CrosstuneStore
import GRDB
import SwiftUI

/// The iPad and Mac frame: a sidebar of destinations and lists, a content column with the
/// chosen one, the tune in the detail column, and the player in a bar at the bottom.
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
    /// Nil until the first read, so a list chosen before the lists load is not taken for a deleted one.
    @State private var lists: LiveQuery<[ListSummary]?>?
    @State private var deleting: ListSummary?
    @State private var playerFrame = CGRect.zero
    /// The sidebar's trailing edge across the shell, which the player panel keeps to the right of.
    @State private var sidebarEdge: CGFloat = 0
    @State private var columns = NavigationSplitViewVisibility.automatic

    private nonisolated static let shellSpace = "SplitShell"

    /// The lists the sidebar shows, in the musician's order.
    nonisolated static func sidebarLists(_ db: Database) throws -> [ListSummary] {
        try ListSummary.fetchAll(db)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebar
                #if os(macOS)
                    .safeAreaBar(edge: .bottom) {
                        SidebarRecordButton(action: onRecord)
                        .disabled(!recordShows)
                        .padding(12)
                    }
                    .onGeometryChange(for: CGFloat.self) {
                        $0.frame(in: .named(Self.shellSpace)).maxX
                    } action: {
                        sidebarEdge = $0
                    }
                #endif
                .clearsPlayer(playerFrame)
        } content: {
            contentColumn
                .clearsPlayer(playerFrame)
                .navigationSplitViewColumnWidth(min: 300, ideal: 340)
                .environment(\.detailTune, $place.detailTune)
                .environment(\.sidebarSelection, $place.sidebar)
        } detail: {
            Group {
                if let detailTune = place.detailTune {
                    TuneScreen(tuneID: detailTune)
                } else {
                    TuneDetailPlaceholder()
                }
            }
            .clearsPlayer(playerFrame)
            .environment(\.detailTune, $place.detailTune)
            .environment(\.sidebarSelection, $place.sidebar)
        }
        .coordinateSpace(.named(Self.shellSpace))
        .playerBar(player, stage: stage, frame: $playerFrame, leading: sidebarHoldsRecord ? sidebarEdge : 0)
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
        // The panel always shows a link's player in full, so a play here must not leave the
        // iPhone's full player waiting to open if the window turns compact.
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
    }

    /// A selecting screen's toolbar holds only what acts on the selection.
    private var recordShows: Bool { selecting?.isCovered != true }

    /// True while the Mac sidebar is open, so its own record button stands in for the
    /// toolbar's, and the player panel stays clear of it, leaving the button at the sidebar's foot.
    private var sidebarHoldsRecord: Bool {
        #if os(macOS)
            columns != .doubleColumn && columns != .detailOnly
        #else
            false
        #endif
    }

    private var sidebar: some View {
        // A row is always chosen: clearing the selection, as a Mac allows, chooses the catalog
        // the content column falls back to anyway.
        List(
            selection: Binding<SidebarItem?> {
                place.sidebar
            } set: {
                place.sidebar = $0 ?? .catalog
            }
        ) {
            row(.catalog).tag(SidebarItem.catalog)
            row(.recordings).tag(SidebarItem.recordings)
            listsSection
            #if os(iOS)
                Section {
                    row(.settings).tag(SidebarItem.settings)
                }
            #endif
        }
        #if os(macOS)
            // Right-clicking the sidebar's empty space starts a list; a list row keeps its own menu.
            .contextMenu(forSelectionType: SidebarItem.self) { items in
                if items.isEmpty { newListButton }
            }
        #endif
        .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        .confirmsListDelete($deleting)
    }

    /// The lists, nil until the first read.
    private var loadedLists: [ListSummary]? { lists?.value ?? nil }

    private var listsSection: some View {
        Section {
            ForEach(loadedLists ?? []) { list in
                listRow(list)
            }
            #if os(iOS)
                newListButton
            #endif
        } header: {
            #if os(macOS)
                SidebarSectionHeader(Destination.lists.title, add: SidebarItem.newList, onAdd: newList)
                    .disabled(listSheets == nil)
                    .contextMenu { newListButton }
            #else
                Text(Destination.lists.title)
            #endif
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

    private var newListButton: some View {
        Button(SidebarItem.newList, systemImage: "plus", action: newList)
            .disabled(listSheets == nil)
    }

    private func newList() {
        listSheets?.name(.new)
    }

    private func row(_ destination: Destination) -> some View {
        Label(destination.title, systemImage: destination.systemImage)
    }

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
