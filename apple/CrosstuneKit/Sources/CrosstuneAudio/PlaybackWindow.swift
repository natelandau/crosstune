import AVFAudio
import CrosstuneStore
import Foundation

/// The part of a loaded file that plays, in seconds into the file: a recording's trim range,
/// offset to wherever the file's audio starts in the source. Playback positions count from
/// `from`, so the player's timeline is the trimmed one.
public struct PlaybackWindow: Equatable, Sendable {
    public let from: TimeInterval
    public let to: TimeInterval

    /// Never starts before the file does, and never ends before it starts.
    public init(from: TimeInterval, to: TimeInterval) {
        self.from = max(0, from)
        self.to = max(self.from, to)
    }

    public var length: TimeInterval { to - from }

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

    /// This window held within a file `fileDuration` seconds long.
    func clamped(to fileDuration: TimeInterval) -> PlaybackWindow {
        PlaybackWindow(from: min(from, fileDuration), to: min(to, fileDuration))
    }

    /// The frames to schedule to play from `position` seconds into the window to its end, nil
    /// when nothing is left.
    func segment(at position: TimeInterval, sampleRate: Double, fileLength: AVAudioFramePosition)
        -> PlaybackSegment?
    {
        let end = min(AVAudioFramePosition((to * sampleRate).rounded()), fileLength)
        let start = AVAudioFramePosition(((from + max(0, position)) * sampleRate).rounded())
        guard start < end else { return nil }
        let count = AVAudioFrameCount(clamping: end - start)
        return PlaybackSegment(startFrame: start, frameCount: count)
    }
}

/// A run of frames in a file for the player node to play.
struct PlaybackSegment: Equatable {
    let startFrame: AVAudioFramePosition
    let frameCount: AVAudioFrameCount
}

/// Where playback stands on the trimmed timeline: where the scheduled segment starts, plus the
/// frames the player node has played of it, held within `duration`.
func playbackPosition(
    segmentStart: TimeInterval, playedFrames: AVAudioFramePosition, sampleRate: Double, duration: TimeInterval
) -> TimeInterval {
    let played = Double(max(0, playedFrames)) / sampleRate
    return clampedPosition(segmentStart + played, duration: duration)
}
