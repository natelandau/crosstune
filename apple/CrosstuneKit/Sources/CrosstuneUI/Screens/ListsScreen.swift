import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// Every list, on iPhone. iPad and Mac show them in the sidebar instead.
public struct ListsScreen: View {
    public static let addList = "Add list"
    public static let noListsTitle = "No lists yet"
    public static let noListsHint = "A list is an ordered set of tunes, like a setlist."

    @Environment(\.store) private var store
    @Environment(\.listSheets) private var listSheets
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var lists: LiveQuery<[ListSummary]?>?
    @State private var deleting: ListSummary?
    @Environment(\.stackTune) private var stackTune

    public init() {}

    public var body: some View {
        let lists = lists?.value
        List {
            ForEach(lists ?? []) { summary in
                NavigationLink(value: ListRoute(id: summary.id)) {
                    ListRow(summary)
                }
                .listRowActions(
                    onEdit: { listSheets?.name(.rename(listID: summary.id, name: summary.name)) },
                    onDelete: { deleting = summary })
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: ListRoute.self) { route in
            ListScreen(listID: route.id)
                // A destination takes the stack's environment, not this screen's.
                .environment(\.stackTune, stackTune)
        }
        .overlay {
            if lists?.isEmpty == true {
                ContentUnavailableView {
                    Label(Self.noListsTitle, systemImage: Destination.lists.systemImage)
                } description: {
                    Text(Self.noListsHint)
                } actions: {
                    Button(Self.addList) { listSheets?.name(.new) }
                        .buttonStyle(.borderedProminent)
                        .disabled(listSheets == nil)
                }
            }
        }
        .navigationTitle(Destination.lists.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(Self.addList, systemImage: "plus") { listSheets?.name(.new) }
                    .disabled(listSheets == nil)
            }
        }
        .modifier(RefreshesBySync(engine: engine))
        .confirmsListDelete($deleting)
        .task(id: store.map(ObjectIdentifier.init)) {
            guard let store else { return }
            self.lists = LiveQuery(store, initial: nil) { db in try ListSummary.fetchAll(db) }
        }
    }
}
