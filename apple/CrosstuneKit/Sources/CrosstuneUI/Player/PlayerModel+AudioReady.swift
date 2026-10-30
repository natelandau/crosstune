import CrosstuneAudio
import Foundation

extension PlayerModel {
    /// Whether the recording's audio is loaded and playable.
    var isRecordingAudioReady: Bool {
        recordingAudio == .loaded && !audio.hasFailed
    }
}
