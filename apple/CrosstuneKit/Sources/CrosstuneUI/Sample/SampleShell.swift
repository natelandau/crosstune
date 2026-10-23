#if DEBUG
    import CrosstuneAudio
    import CrosstuneStore
    import CrosstuneSync
    import Foundation
    import SwiftUI

    /// The shell over the sample catalog, with no account or sync, for previews and for
    /// looking at the app without signing in. Debug builds only.
    public struct SampleShell: View {
        private let playing: Bool
        private let playingRecording: Bool
        private let samplePlan: SamplePlan?
        private let screen: SampleScreen?

        @State private var store: CrosstuneStore?
        @State private var engine: SyncEngine?
        @State private var failure: String?
        @State private var player: PlayerModel
        @State private var listPlayback: ListPlayback
        @State private var stage = EmbedStage()
        @State private var recorders: RecorderHost
        @State private var tuner: TunerModel
        @State private var plan: PlanModel?
        @State private var noticeClaim = NoticeClaim()
        @State private var place: ShellPlace
        #if os(macOS)
            @Environment(\.openSettings) private var openSettings
        #endif

        /// Where the record screen's take reads its audio, since a capture must not record the room.
        private static let recordTone = FileManager.default.temporaryDirectory.appending(
            path: "crosstune-sample-take.m4a")

        /// - Parameters:
        ///   - playing: Starts with a link loaded in the player.
        ///   - playingRecording: Starts with a recording playing, from a tone written for it.
        ///   - plan: Stores this entitlements row, so the plan gates the shell. Nil leaves the
        ///     plan unknown, which gates nothing, unless `screen` needs a plan to show.
        ///   - screen: Opens on this surface, with the Settings window too for one shown there.
        public init(
            playing: Bool = false, playingRecording: Bool = false, plan: SamplePlan? = nil,
            screen: SampleScreen? = nil
        ) {
            self.playing = playing
            self.playingRecording = playingRecording
            samplePlan = plan ?? screen?.plan
            self.screen = screen
            _place = State(initialValue: screen?.place() ?? ShellPlace())
            let recorders =
                screen == .record ? RecorderHost(makeInput: { FileInput(url: Self.recordTone) }) : RecorderHost()
            _recorders = State(initialValue: recorders)
            _tuner = State(initialValue: TunerModel(input: TunerInput(), recorders: recorders))
            // The playlist must sit on the same player the shell shows.
            let player = PlayerModel()
            _player = State(initialValue: player)
            _listPlayback = State(initialValue: ListPlayback.device(player: player))
        }

        public var body: some View {
            ZStack {
                // An empty body would never start the task that opens the store.
                Color.clear
                if screen?.isSignedOut == true {
                    WelcomeView(notice: nil)
                } else if let store {
                    AppShell(
                        store: store, player: player, stage: stage, recorders: recorders, tuner: tuner, place: place
                    )
                    .environment(engine)
                    .environment(listPlayback)
                    // A capture never shows the system review request.
                    .environment(\.reviewPrompt, nil)
                    .environment(\.plan, plan)
                    .environment(\.noticeClaim, noticeClaim)
                } else if let failure {
                    ContentUnavailableView(
                        "The sample catalog did not open", systemImage: "exclamationmark.triangle",
                        description: Text(failure))
                }
            }
            .environment(\.sampleScreen, screen)
            .task {
                guard screen?.isSignedOut != true else { return }
                do {
                    let empty = screen?.isEmpty == true
                    let opened = try await SampleCatalog.makeStore(withAudio: true, empty: empty)
                    if !empty { try await SampleScans.add(to: opened) }
                    if screen == .record {
                        try? FileManager.default.removeItem(at: Self.recordTone)
                        try await SampleAudio.writeTone(to: Self.recordTone, seconds: 30)
                    }
                    if let samplePlan {
                        try await samplePlan.store(in: opened, now: Date())
                        plan = PlanModel(store: opened)
                        player.plan = plan
                    }
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
                if screen == .practice {
                    let entry = SampleCatalog.playable
                    player.open(.recording(entry.recording, tuneTitle: entry.tuneTitle), playing: false)
                }
                #if os(macOS)
                    if let tab = SampleScreen.settingsTab() ?? screen?.settingsTab {
                        MacSettingsTabs.select(tab)
                        openSettings()
                    }
                #endif
            }
        }
    }

    /// A server that is never reachable, so the sample's sync engine shows its states without
    /// sending anything.
    struct OfflineSyncAPI: SyncAPI {
        func push(_ changes: [Change]) async throws -> [PushResult] { throw URLError(.notConnectedToInternet) }
        func pull(since: Int64) async throws -> PullPage { throw URLError(.notConnectedToInternet) }
        func events(since: Int64) async throws -> EventsPage { throw URLError(.notConnectedToInternet) }
        func recordNotice(_ notice: PlanNotice) async throws { throw URLError(.notConnectedToInternet) }
        func refreshBilling() async throws { throw URLError(.notConnectedToInternet) }
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
        private let samplePlan: SamplePlan?
        private let screen: SampleScreen?
        @State private var store: CrosstuneStore?
        @State private var plan: PlanModel?

        /// - Parameters:
        ///   - plan: Stores this entitlements row, so the Plan group has a plan to show.
        ///   - screen: Opens the sheet this surface names, when a tab of this window holds it.
        public init(plan: SamplePlan? = nil, screen: SampleScreen? = nil) {
            samplePlan = plan ?? screen?.plan
            self.screen = screen
        }

        public var body: some View {
            VStack(spacing: 0) {
                if let store {
                    MacSettingsTabs()
                        .environment(\.store, store)
                        .environment(\.plan, plan)
                        .environment(\.sampleScreen, screen)
                } else {
                    // Sized as the tabs are, since the window must not resize once it shows.
                    Color.clear.frame(width: MacSettingsTabs.size.width, height: MacSettingsTabs.size.height)
                }
            }
            .task {
                guard let opened = try? await SampleCatalog.makeStore() else { return }
                if let samplePlan, (try? await samplePlan.store(in: opened, now: Date())) != nil {
                    plan = PlanModel(store: opened)
                }
                store = opened
            }
        }
    }
#endif
