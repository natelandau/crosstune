import CrosstuneStore
import CrosstuneSync
import GRDB
import SwiftUI

/// Follows the loaded link's stored row, so a title resolved after the paste reaches the player
/// and a link removed here or on another device takes the player with it.
struct PlayerLinkWatch: ViewModifier {
    let store: CrosstuneStore
    let player: PlayerModel

    func body(content: Content) -> some View {
        content.task(id: loadedLinkID) {
            guard let linkID = loadedLinkID else { return }
            let rows = ValueObservation.tracking { db in try RecordingLink.fetchOne(db, key: linkID) }
                .removeDuplicates()
                .values(in: store.database)
            do {
                for try await row in rows {
                    player.linkChanged(id: linkID, to: row)
                }
            } catch {
                // A store that stops answering leaves the loaded player as it is.
            }
        }
    }

    private var loadedLinkID: String? {
        player.item?.kind == .link ? player.item?.id : nil
    }
}

/// Follows the loaded recording's stored row, its audio file, and its tune, so a rename, trim,
/// speed, or pitch here or on another device reaches the player, a new revision of the audio
/// replaces the old, and a recording deleted anywhere takes the player with it.
struct PlayerRecordingWatch: ViewModifier {
    let store: CrosstuneStore
    let player: PlayerModel

    private struct Loaded: Equatable, Sendable {
        let recording: Recording?
        let file: RecordingFile?
        let tuneTitle: String?
    }

    func body(content: Content) -> some View {
        content.task(id: loadedRecordingID) {
            guard let recordingID = loadedRecordingID else { return }
            let rows = ValueObservation.tracking { db in
                let recording = try Recording.fetchOne(db, key: recordingID)
                let tune = try recording?.tuneID.flatMap { try Tune.fetchOne(db, key: $0) }
                return Loaded(
                    recording: recording, file: try RecordingFile.fetchOne(db, key: recordingID),
                    tuneTitle: tune?.deletedAt == nil ? tune?.title : nil)
            }
            .removeDuplicates()
            .values(in: store.database)
            do {
                for try await loaded in rows {
                    let audioFile = loaded.file.flatMap { file in
                        store.localAudio(file).map { RecordingAudioFile(url: $0, file: file) }
                    }
                    player.recordingChanged(
                        id: recordingID, to: loaded.recording, audioFile: audioFile, tuneTitle: loaded.tuneTitle)
                }
            } catch {
                // A store that stops answering leaves the loaded player as it is.
            }
        }
    }

    private var loadedRecordingID: String? {
        player.item?.kind == .recording ? player.item?.id : nil
    }
}
