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
    @Environment(\.plan) private var plan
    @State private var playable: LiveQuery<ListsPlayability.Snapshot?>?
    /// Whether this device plays Apple Music in full, nil until read.
    @State private var appleMusic: AppleMusicAccessState?
    /// What each list would play now, by list id, rebuilt only when what decides it changes
    /// rather than on each redraw, since it walks every entry of every list.
    @State private var reports: [String: PlaylistReport] = [:]

    public init() {}

    public var body: some View {
        let lists = lists?.value
        List {
            ForEach(lists ?? []) { summary in
                let report = reports[summary.id]
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
                #if os(macOS)
                    .listRowBackground(listPlayback?.listID == summary.id ? BrandStyle.setFill(colorScheme) : nil)
                #else
                    .listRowBackground(
                        listPlayback?.listID == summary.id ? BrandStyle.setFill(colorScheme) : Color.clear)
                #endif
            }
        }
        .listStyle(.plain)
        .paperGround()
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
                        .buttonStyle(.accentProminent)
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
            #if os(iOS)
                AccountToolbarItem()
            #endif
        }
        .modifier(RefreshesBySync(engine: engine))
        .confirmsListDelete($deleting)
        .task(id: store.map(ObjectIdentifier.init)) {
            guard let store else { return }
            self.lists = LiveQuery(store, initial: nil) { db in try ListSummary.fetchAll(db) }
            let settingsRow = settingsID(clerkUserID: store.userID)
            self.playable = LiveQuery(store, initial: nil) { db in
                try ListsPlayability.Snapshot.fetch(db, settingsID: settingsRow)
            }
        }
        .task {
            guard let access = player?.appleMusic?.access else { return }
            appleMusic = await access.current()
        }
        .onChange(of: playabilityInputs, initial: true) { _, inputs in
            reports = ListsPlayability.reports(
                inputs.snapshot, canStart: inputs.canStart, fullTracks: inputs.fullTracks, online: inputs.online,
                recordingsPlay: inputs.recordingsPlay)
        }
    }

    private struct PlayabilityInputs: Equatable {
        var snapshot: ListsPlayability.Snapshot?
        var canStart: Bool
        var fullTracks: Bool?
        var online: Bool
        var recordingsPlay: Bool
    }

    private var playabilityInputs: PlayabilityInputs {
        PlayabilityInputs(
            snapshot: playable?.value ?? nil, canStart: listPlayback != nil && !(recorders?.isCapturing ?? false),
            // Unread until the Apple Music access reads, where there is one to read.
            fullTracks: player?.appleMusic?.access == nil ? false : appleMusic.map { $0 == .fullTracks },
            online: session?.hasNetwork ?? true, recordingsPlay: plan.recordingsPlay)
    }

    private func start(_ summary: ListSummary, report: PlaylistReport, shuffled: Bool) {
        guard let listPlayback else { return }
        listPlayback.start(listID: summary.id, name: summary.name, report: report, shuffled: shuffled)
    }
}
