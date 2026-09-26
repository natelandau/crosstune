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
    /// Nil until the first read, so a list chosen before the lists load is not taken for a deleted one.
    @State private var lists: LiveQuery<[ListSummary]?>?
    @State private var deleting: ListSummary?
    @State private var playerHeight: CGFloat = 0

    /// The lists the sidebar shows, in the musician's order.
    nonisolated static func sidebarLists(_ db: Database) throws -> [ListSummary] {
        try ListSummary.fetchAll(db)
    }

    var body: some View {
        NavigationSplitView {
            sidebar
                .safeAreaPadding(.bottom, playerHeight)
        } content: {
            content
                .safeAreaPadding(.bottom, playerHeight)
                .toolbar {
                    // A selecting screen's toolbar holds only what acts on the selection.
                    if selecting?.isCovered != true {
                        ToolbarItem(placement: .navigation) {
                            RecordToolbarButton(action: onRecord)
                        }
                    }
                }
                .syncBadgeToolbar()
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
            .safeAreaPadding(.bottom, playerHeight)
            .environment(\.detailTune, $place.detailTune)
            .environment(\.sidebarSelection, $place.sidebar)
        }
        .playerBar(player, stage: stage, height: $playerHeight)
        // The panel always shows the player in full, so a play here must not leave the iPhone's
        // full player waiting to open if the window turns compact.
        .onChange(of: player.isExpanded, initial: true) {
            if player.isExpanded { player.isExpanded = false }
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
            Section(Destination.lists.title) {
                ForEach(lists?.value ?? nil ?? []) { list in
                    Label(list.name, systemImage: Destination.lists.systemImage)
                        .badge(list.count)
                        .tag(SidebarItem.list(id: list.id))
                        .listRowActions(
                            onEdit: { listSheets?.name(.rename(listID: list.id, name: list.name)) },
                            onDelete: { deleting = list })
                }
                Button(SidebarItem.newList, systemImage: "plus") { listSheets?.name(.new) }
                    .disabled(listSheets == nil)
            }
            #if os(iOS)
                Section {
                    row(.settings).tag(SidebarItem.settings)
                }
            #endif
        }
        .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        .confirmsListDelete($deleting)
    }

    private func row(_ destination: Destination) -> some View {
        Label(destination.title, systemImage: destination.systemImage)
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
