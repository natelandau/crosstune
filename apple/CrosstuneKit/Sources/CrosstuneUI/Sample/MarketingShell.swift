#if DEBUG
    import CrosstuneAudio
    import CrosstuneStore
    import CrosstuneSync
    import Foundation
    import SwiftUI

    /// The shell over the marketing catalog, with no account or sync, for the marketing site's
    /// captures. Debug builds only.
    public struct MarketingShell: View {
        private let fixture: URL

        @State private var store: CrosstuneStore?
        @State private var engine: SyncEngine?
        @State private var failure: String?
        @State private var player: PlayerModel
        @State private var listPlayback: ListPlayback
        @State private var stage = EmbedStage()
        @State private var recorders: RecorderHost

        /// - Parameter fixture: The marketing catalog, `site/capture/catalog.json`.
        public init(fixture: URL) {
            self.fixture = fixture
            // The playlist must sit on the same player the shell shows.
            let player = PlayerModel()
            _player = State(initialValue: player)
            _listPlayback = State(initialValue: ListPlayback.device(player: player))
            _recorders = State(initialValue: Self.makeRecorders())
        }

        /// Records from the file named by `-RecordFromFile <path>` when given, else the microphone.
        private static func makeRecorders() -> RecorderHost {
            let arguments = CommandLine.arguments
            guard let flag = arguments.firstIndex(of: "-RecordFromFile"), flag + 1 < arguments.count else {
                return RecorderHost()
            }
            let url = URL(fileURLWithPath: arguments[flag + 1])
            return RecorderHost(makeInput: { FileInput(url: url) })
        }

        public var body: some View {
            ZStack {
                // An empty body would never start the task that opens the store.
                Color.clear
                if let store {
                    AppShell(store: store, player: player, stage: stage, recorders: recorders)
                        .environment(engine)
                        .environment(listPlayback)
                } else if let failure {
                    ContentUnavailableView(
                        "The marketing catalog did not open", systemImage: "exclamationmark.triangle",
                        description: Text(failure))
                }
            }
            .task {
                do {
                    let opened = try await MarketingCatalog.makeStore(fixture: fixture)
                    engine = SyncEngine(store: opened, api: OfflineSyncAPI(), isOffline: { true })
                    store = opened
                } catch {
                    failure = String(describing: error)
                }
            }
        }
    }
#endif
