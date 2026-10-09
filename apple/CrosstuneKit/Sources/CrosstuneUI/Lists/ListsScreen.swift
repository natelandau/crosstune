import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
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
    @Environment(\.colorScheme) private var colorScheme
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @State private var playable: LiveQuery<ListsPlayOffers.Snapshot?>?
    /// Whether this device plays Apple Music in full, nil until read.
    @State private var appleMusic: AppleMusicAccessState?

    public init() {}

    public var body: some View {
        let lists = lists?.value
        let offers = offers
        List {
            ForEach(lists ?? []) { summary in
                let report = offers[summary.id]
                NavigationLink(value: ListRoute(id: summary.id)) {
                    HStack(spacing: 0) {
                        ListRow(summary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ListsRowPlayButton(summary: summary, report: report) { report in
                            start(summary, report: report, shuffled: listPlayback?.isShuffled ?? false)
                        }
                    }
                }
                .scaledRowInsets()
                .listRowActions(
                    onPlay: report.map { report in { shuffled in start(summary, report: report, shuffled: shuffled) } },
                    onEdit: { listSheets?.name(.rename(listID: summary.id, name: summary.name)) },
                    onDelete: { deleting = summary }
                )
                .listRowBackground(listPlayback?.listID == summary.id ? BrandStyle.setFill(colorScheme) : nil)
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
                        .buttonStyle(.slateProminent)
                        .disabled(listSheets == nil)
                }
            }
        }
        .screenView(.lists)
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
            let settingsRow = settingsID(clerkUserID: store.userID)
            self.playable = LiveQuery(store, initial: nil) { db in
                try ListsPlayOffers.Snapshot.fetch(db, settingsID: settingsRow)
            }
        }
        .task {
            guard let access = player?.appleMusic?.access else { return }
            appleMusic = await access.current()
        }
    }

    /// What each list would play now, by list id.
    private var offers: [String: PlaylistReport] {
        // Unread until the Apple Music access reads, where there is one to read.
        let fullTracks: Bool? = player?.appleMusic?.access == nil ? false : appleMusic.map { $0 == .fullTracks }
        return ListsPlayOffers.reports(
            playable?.value ?? nil, canStart: listPlayback != nil && !(recorders?.isCapturing ?? false),
            fullTracks: fullTracks, online: session?.hasNetwork ?? true)
    }

    /// Starting a playlist stops whatever was loaded.
    private func start(_ summary: ListSummary, report: PlaylistReport, shuffled: Bool) {
        guard let listPlayback else { return }
        player?.close()
        listPlayback.start(listID: summary.id, name: summary.name, report: report, shuffled: shuffled)
    }
}
