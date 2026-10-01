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

/// What to schedule and where to start with a loop chosen, every position and loop in seconds
/// on the trimmed timeline. Repeat follows Logic's cycle convention: playback wraps only when it
/// reaches the loop end from inside the loop.
enum LoopSchedule {
    /// How many copies of the loop wait behind the one playing, so the node never runs dry
    /// while a completion is on its way.
    static let queuedCopies = 2

    /// Whether `position` is in `loop`, which holds its start but not its end.
    static func contains(_ loop: PlaybackWindow, _ position: TimeInterval) -> Bool {
        position >= loop.from && position < loop.to
    }

    /// Where playback should stand once Repeat or the loop changes, or play starts: the loop
    /// start for a repeating loop the position is outside, and the position otherwise.
    static func entry(position: TimeInterval, loop: PlaybackWindow?, repeat repeating: Bool) -> TimeInterval {
        guard repeating, let loop, !contains(loop, position) else { return position }
        return loop.from
    }

    /// The frames of one pass of `loop` within `window` and the file, nil when nothing of it is.
    static func loopSegment(
        _ loop: PlaybackWindow, window: PlaybackWindow, sampleRate: Double, fileLength: AVAudioFramePosition
    ) -> PlaybackSegment? {
        let held = PlaybackWindow(from: window.from + loop.from, to: min(window.from + loop.to, window.to))
        return held.segment(at: 0, sampleRate: sampleRate, fileLength: fileLength)
    }

    /// The segments to schedule to play from `position`. Up to a repeating loop's end, inside or
    /// before it, then the loop ``queuedCopies`` times; otherwise on to the window end. Empty
    /// when nothing is left.
    static func next(
        position: TimeInterval, loop: PlaybackWindow?, repeat repeating: Bool, window: PlaybackWindow,
        sampleRate: Double, fileLength: AVAudioFramePosition
    ) -> [PlaybackSegment] {
        let toWindowEnd = window.segment(at: position, sampleRate: sampleRate, fileLength: fileLength)
        guard repeating, let loop, position < loop.to,
            let pass = loopSegment(loop, window: window, sampleRate: sampleRate, fileLength: fileLength)
        else { return toWindowEnd.map { [$0] } ?? [] }
        let leadStart = AVAudioFramePosition(((window.from + max(0, position)) * sampleRate).rounded())
        let leadEnd = pass.startFrame + AVAudioFramePosition(pass.frameCount)
        // A position within half a frame of the loop end has nothing left to lead in with.
        let lead =
            leadStart < leadEnd
            ? PlaybackSegment(startFrame: leadStart, frameCount: AVAudioFrameCount(clamping: leadEnd - leadStart))
            : pass
        return [lead] + Array(repeating: pass, count: queuedCopies)
    }
}

/// One pass of a repeating loop as the node plays it: where it starts on the trimmed timeline
/// and how many frames it lasts.
struct LoopRun: Equatable {
    let from: TimeInterval
    let frames: AVAudioFramePosition
}

/// What one schedule gave the player node: a lead segment from `start`, then, when a loop
/// repeats, pass after pass of it.
struct ScheduledRun: Equatable {
    let start: TimeInterval
    let leadFrames: AVAudioFramePosition
    let loop: LoopRun?

    /// Where playback stands after the node has played `playedFrames` of this run. Past the
    /// lead, a repeating run folds back into the loop by whole passes, so the position never
    /// runs past the loop end however late a pass's completion arrives.
    func position(playedFrames: AVAudioFramePosition, sampleRate: Double, duration: TimeInterval) -> TimeInterval {
        guard let loop, loop.frames > 0, playedFrames >= leadFrames else {
            return playbackPosition(
                segmentStart: start, playedFrames: playedFrames, sampleRate: sampleRate, duration: duration)
        }
        let into = (playedFrames - leadFrames) % loop.frames
        return clampedPosition(loop.from + Double(into) / sampleRate, duration: duration)
    }
}

/// Where playback stands on the trimmed timeline: where the scheduled segment starts, plus the
/// frames the player node has played of it, held within `duration`.
func playbackPosition(
    segmentStart: TimeInterval, playedFrames: AVAudioFramePosition, sampleRate: Double, duration: TimeInterval
) -> TimeInterval {
    let played = Double(max(0, playedFrames)) / sampleRate
    return clampedPosition(segmentStart + played, duration: duration)
}
