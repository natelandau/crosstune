import CrosstuneAudio
import CrosstuneStore
import Foundation

extension PlaybackWindow {
    /// The trim range of `recording` within `file`, whose audio is `fileDuration` seconds long.
    /// A downloaded file can start partway through the source, so every offset is relative to
    /// `file.blobStartMs`, the start of the audio actually on disk, which still lines up when
    /// the file predates the recording's latest trim.
    public static func make(recording: Recording, file: RecordingFile, fileDuration: TimeInterval) -> PlaybackWindow {
        let fileMs = fileDuration * 1000
        let sourceEndMs = (recording.trimEndMs ?? recording.sourceDurationMs).map(Double.init) ?? fileMs
        let blobStartMs = Double(file.blobStartMs)
        func inFile(_ ms: Double) -> TimeInterval { min(max(0, ms), fileMs) / 1000 }
        return PlaybackWindow(
            from: inFile(Double(recording.trimStartMs) - blobStartMs), to: inFile(sourceEndMs - blobStartMs))
    }
}
