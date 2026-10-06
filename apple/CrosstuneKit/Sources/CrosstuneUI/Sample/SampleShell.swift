#if DEBUG
    import CrosstuneStore
    import CrosstuneSync
    import Foundation
    import SwiftUI

    /// The shell over the sample catalog, with no account or sync, for previews and for
    /// looking at the app without signing in. Debug builds only.
    public struct SampleShell: View {
        private let playing: Bool
        private let playingRecording: Bool

        @State private var store: CrosstuneStore?
        @State private var engine: SyncEngine?
        @State private var failure: String?
        @State private var player: PlayerModel
        @State private var listPlayback: ListPlayback
        @State private var stage = EmbedStage()
        @State private var recorders = RecorderHost()

        /// - Parameters:
        ///   - playing: Starts with a link loaded in the player.
        ///   - playingRecording: Starts with a recording playing, from a tone written for it.
        public init(playing: Bool = false, playingRecording: Bool = false) {
            self.playing = playing
            self.playingRecording = playingRecording
            // The playlist must sit on the same player the shell shows.
            let player = PlayerModel()
            _player = State(initialValue: player)
            _listPlayback = State(initialValue: ListPlayback.device(player: player))
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
                        "The sample catalog did not open", systemImage: "exclamationmark.triangle",
                        description: Text(failure))
                }
            }
            .task {
                do {
                    let opened = try await SampleCatalog.makeStore(withAudio: true)
                    try await SampleScans.add(to: opened)
                    engine = SyncEngine(store: opened, api: OfflineSyncAPI(), isOffline: { true })
                    store = opened
                } catch {
                    failure = String(describing: error)
                }
                if playing, let item = SampleCatalog.links.lazy.compactMap(PlayerItem.link).first {
                    player.play(item)
                }
                if playingRecording {
                    let entry = SampleCatalog.playable
                    player.play(.recording(entry.recording, tuneTitle: entry.tuneTitle))
                }
            }
        }
    }

    /// A server that is never reachable, so the sample's sync engine shows its states without
    /// sending anything.
    struct OfflineSyncAPI: SyncAPI {
        func push(_ changes: [Change]) async throws -> [PushResult] { throw URLError(.notConnectedToInternet) }
        func pull(since: Int64) async throws -> PullPage { throw URLError(.notConnectedToInternet) }
        func events(since: Int64) async throws -> EventsPage { throw URLError(.notConnectedToInternet) }
        func storage() async throws -> StorageFigures { throw URLError(.notConnectedToInternet) }
        func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.notConnectedToInternet) }
        func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse {
            throw URLError(.notConnectedToInternet)
        }
        func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
            throw URLError(.notConnectedToInternet)
        }
        func uploadFinished(recordingID: String) async throws { throw URLError(.notConnectedToInternet) }
        func downloadURL(recordingID: String) async throws -> DownloadURL { throw URLError(.notConnectedToInternet) }
        func peaksURL(recordingID: String) async throws -> PeaksURL { throw URLError(.notConnectedToInternet) }
        func retryRecording(recordingID: String) async throws { throw URLError(.notConnectedToInternet) }
        func scanUploadSlot(scanID: String, bytes: Int64) async throws -> SignedURL {
            throw URLError(.notConnectedToInternet)
        }
        func scanUploaded(scanID: String) async throws { throw URLError(.notConnectedToInternet) }
        func scanDownload(scanID: String) async throws -> SignedURL { throw URLError(.notConnectedToInternet) }
        func putObject(_ url: URL, file: URL, contentType: String) async throws {
            throw URLError(.notConnectedToInternet)
        }
        func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.notConnectedToInternet) }
    }
#endif

#if DEBUG && os(macOS)
    import CrosstuneStore
    import SwiftUI

    /// The Mac Settings window over the sample catalog, for looking at every tab and the stats
    /// screen beside ``SampleShell`` without signing in. Debug builds only.
    public struct SampleSettings: View {
        @State private var store: CrosstuneStore?

        public init() {}

        public var body: some View {
            VStack(spacing: 0) {
                if let store {
                    MacSettingsTabs().environment(\.store, store)
                } else {
                    // Sized as the tabs are, since the window must not resize once it shows.
                    Color.clear.frame(width: MacSettingsTabs.size.width, height: MacSettingsTabs.size.height)
                }
            }
            .task {
                store = try? await SampleCatalog.makeStore()
            }
        }
    }
#endif
