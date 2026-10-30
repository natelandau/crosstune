import CrosstuneStore
import CrosstuneSync
import Foundation
import GRDB

/// Where a recording's audio comes from. A split piece the server has not cut yet plays its
/// range from the parent's file; only playback reads the parent's file.
enum RecordingAudioLookup {
    /// The parent whose file stands in for `recording`'s own until the server has cut the piece.
    static func parentID(of recording: Recording?) -> String? {
        guard let recording, RecordingLimits.waitsForCut(recording) else { return nil }
        return recording.splitFromID
    }

    /// The recording's own audio on this device, else its parent's for a piece with none.
    static func audioFile(
        recording: Recording?, own: RecordingFile?, parent: RecordingFile?, store: CrosstuneStore
    ) -> RecordingAudioFile? {
        if let own, let url = store.localAudio(own) { return RecordingAudioFile(url: url, file: own) }
        guard parentID(of: recording) != nil, let parent, let url = store.localAudio(parent) else { return nil }
        return RecordingAudioFile(url: url, file: parent)
    }

    /// Fetches the recording's own audio, then reads the files it plays from. A piece the server
    /// has not cut yet has no audio to fetch and plays the parent's file only if it is already on
    /// this device: the parent is never downloaded for a short piece.
    static func fetch(
        _ recordingID: String, store: CrosstuneStore, download: @Sendable (String) async -> URL?
    ) async -> RecordingAudioFile? {
        let row = (try? await store.read { db in try Recording.fetchOne(db, key: recordingID) }) ?? nil
        _ = await download(recordingID)
        let files = try? await store.read { db in
            (
                own: try RecordingFile.fetchOne(db, key: recordingID),
                parent: try parentID(of: row).flatMap { try RecordingFile.fetchOne(db, key: $0) }
            )
        }
        // A file of the piece's own on this device plays whatever the download answered.
        return audioFile(recording: row, own: files?.own, parent: files?.parent, store: store)
    }
}
