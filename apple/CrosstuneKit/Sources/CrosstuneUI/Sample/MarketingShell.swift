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
        @State private var tuner: TunerModel
        @State private var place = Self.makePlace()

        /// - Parameter fixture: The marketing catalog, `apple/Marketing/catalog.json`.
        public init(fixture: URL) {
            self.fixture = fixture
            // The playlist must sit on the same player the shell shows.
            let player = PlayerModel()
            _player = State(initialValue: player)
            _listPlayback = State(initialValue: ListPlayback.device(player: player))
            let recorders = Self.makeRecorders()
            _recorders = State(initialValue: recorders)
            _tuner = State(initialValue: TunerModel(input: Self.makeTunerInput(), recorders: recorders))
        }

        /// Hears a steady tone at the frequency in hertz named by `-TunerTone <hertz>` when given,
        /// else the microphone, which on a simulator is the room around the Mac.
        private static func makeTunerInput() -> any TunerListening {
            guard let hertz = value("-TunerTone").flatMap(Double.init) else { return TunerInput() }
            return ToneTunerInput(frequency: hertz)
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

        /// The launch argument after `flag`, if there is one.
        private static func value(_ flag: String) -> String? {
            let arguments = CommandLine.arguments
            guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }

        /// Opens on the Tuner when given `-MarketingSidebar tuner`, else on the list named by
        /// `-MarketingList <list id>` and the tune named by `-MarketingTune <tune id>`, for the
        /// Mac captures, which cannot click their way there. Every flag takes a value: AppKit
        /// opens a stray argument as a document, and then shows no window.
        private static func makePlace() -> ShellPlace {
            let place = ShellPlace()
            if value("-MarketingSidebar") == "tuner" { place.sidebar = .tuner }
            if let list = value("-MarketingList") { place.sidebar = .list(id: list) }
            place.detailTune = value("-MarketingTune")
            return place
        }

        /// Opens the recording named by `-MarketingRecording <recording id>` on its own screen,
        /// playing at `-MarketingSpeed <percent>` when given, for the Mac capture.
        private func openRecording(in store: CrosstuneStore) async {
            guard let id = Self.value("-MarketingRecording") else { return }
            let found = try? await store.read { db -> (Recording, String?)? in
                guard let recording = try Recording.fetchOne(db, key: id) else { return nil }
                return (recording, try Tune.fetchOne(db, key: recording.tuneID)?.title)
            }
            guard let (recording, title) = found ?? nil else { return }
            player.open(.recording(recording, tuneTitle: title))
            if let speed = Self.value("-MarketingSpeed").flatMap(Int.init) { player.setSpeed(speed) }
        }

        public var body: some View {
            ZStack {
                // An empty body would never start the task that opens the store.
                Color.clear
                if let store {
                    AppShell(
                        store: store, player: player, stage: stage, recorders: recorders, tuner: tuner, place: place
                    )
                    .environment(engine)
                    .environment(listPlayback)
                    // A capture never shows the system review request.
                    .environment(\.reviewPrompt, nil)
                    .environment(\.tunerListensWhileHidden, true)
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
                    await openRecording(in: opened)
                } catch {
                    failure = String(describing: error)
                }
            }
        }
    }

    /// A tuner input that hears one steady tone and never touches the microphone.
    @MainActor
    private final class ToneTunerInput: TunerListening {
        private let frequency: Double
        private var a4 = 440.0
        private var ticks: Task<Void, Never>?

        init(frequency: Double) {
            self.frequency = frequency
        }

        func requestPermission() async -> Bool { true }

        func start(
            a4: Double, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
            onEnded: @escaping @MainActor @Sendable () -> Void,
            onYield: @escaping @MainActor @Sendable (TunerYield) -> Void
        ) async throws {
            self.a4 = a4
            ticks?.cancel()
            // A reading on a schedule, as the microphone delivers them, so the display stays live.
            ticks = Task { [weak self] in
                var atMs = 0.0
                while !Task.isCancelled, let self {
                    if let note = noteFor(frequency: self.frequency, a4: self.a4) {
                        onReading(Reading(frequency: self.frequency, note: note, atMs: atMs))
                    }
                    atMs += 50
                    try? await Task.sleep(for: .milliseconds(50))
                }
            }
        }

        func setA4(_ a4: Double) {
            self.a4 = a4
        }

        func stop() async {
            ticks?.cancel()
            ticks = nil
        }
    }
#endif
