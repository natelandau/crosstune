import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import Foundation
import Observation
import SwiftUI

/// A recording row's Download and Retry, handed to the sync engine, and which downloads a row
/// asked for came back empty. Shared by every screen that lists recordings, so a failure shows
/// on the row wherever the musician looks for it.
@MainActor
@Observable
public final class RecordingTransferActions {
    /// Downloads a row started that are still running, before and while the engine fetches.
    public private(set) var fetching: Set<String> = []
    /// Downloads a row started that fetched nothing, until the next try.
    public private(set) var failedDownloads: Set<String> = []

    private let engine: SyncEngine
    private let commands: CrosstuneCommands.Commands

    public init(engine: SyncEngine, store: CrosstuneStore) {
        self.engine = engine
        commands = CrosstuneCommands.Commands(store: store)
    }

    /// Fetches a ready recording's audio to this device. A fetch that brings nothing back is
    /// kept in ``failedDownloads`` so the row can say so.
    public func download(_ recordingID: String) async {
        guard fetching.insert(recordingID).inserted else { return }
        failedDownloads.remove(recordingID)
        let fetched = await engine.download(recordingID)
        fetching.remove(recordingID)
        if fetched == nil { failedDownloads.insert(recordingID) }
    }

    /// Whether a fetch of `recordingID` is under way, started here or by the engine's own pass.
    public func isDownloading(_ recordingID: String) -> Bool {
        fetching.contains(recordingID) || engine.downloading.contains(recordingID)
    }

    /// Retries a stuck upload or a failed transcode, throwing when the retry is refused.
    public func retry(_ recordingID: String, _ kind: RecordingText.Retry) async throws {
        switch kind {
        case .transcode:
            try await engine.retry(recordingID)
        case .upload:
            // The reset only puts the file back in the queue; the transfer run after a sync is
            // what sends it.
            try await commands.retryUpload(recordingID)
            Task { await engine.sync() }
        }
    }
}

/// Wires recording transfers into the shell: the rows' Download and Retry, and where the
/// player finds a recording's audio. Without an engine, as signed out, rows fetch and retry
/// nothing, and the player plays only what is on this device.
struct RecordingTransfers: ViewModifier {
    let store: CrosstuneStore
    let player: PlayerModel

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var actions: RecordingTransferActions?

    func body(content: Content) -> some View {
        content
            .environment(actions)
            .task(id: EngineKey(store: store, engine: engine)) {
                let engine = engine
                let store = store
                actions = engine.map { RecordingTransferActions(engine: $0, store: store) }
                player.audioSource = { recordingID in
                    if let engine { return await engine.download(recordingID) }
                    return await store.localAudio(recordingID: recordingID)
                }
            }
    }

    private struct EngineKey: Equatable {
        let store: ObjectIdentifier
        let engine: ObjectIdentifier?

        init(store: CrosstuneStore, engine: SyncEngine?) {
            self.store = ObjectIdentifier(store)
            self.engine = engine.map(ObjectIdentifier.init)
        }
    }
}
