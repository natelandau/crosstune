import CrosstuneVocabulary
import Foundation

/// What the system's Now Playing surfaces show for the loaded audio: the lock screen, Control
/// Center, and the Mac's menu bar.
public struct NowPlaying: Equatable, Sendable {
    public let title: String
    /// The tune the audio is a recording of, when it has one.
    public let tuneTitle: String?

    public init(title: String, tuneTitle: String?) {
        self.title = title
        self.tuneTitle = tuneTitle
    }
}

/// How a track stopped playing without being told to.
public enum TrackEnd: Equatable, Sendable {
    /// Played to its natural end.
    case finished
    /// MusicKit's next moved off the song.
    case next
    /// MusicKit's previous moved off the song, `elapsed` seconds into it.
    case previous(elapsed: TimeInterval)
}

/// Play, pause, and a place in the audio: what a scrubber and a play button need from any player.
@MainActor
public protocol PlaybackTransport: AnyObject {
    /// Whether audio is playing now, as opposed to loaded and paused or not loaded.
    var isPlaying: Bool { get }
    /// Seconds into what plays; for a recording, into the playback window, so 0 is the trim start.
    var elapsed: TimeInterval { get }
    /// The length of what plays, nil until it is known.
    var duration: TimeInterval? { get }
    /// Told once each time a track ends, by playing or by a seek to its end while playing, never
    /// when the app pauses, stops it, or seeks within it.
    var onTrackEnd: (@MainActor (TrackEnd) -> Void)? { get set }

    func play()
    func pause()
    /// Moves to `seconds` into what plays, kept within its length.
    func seek(to seconds: TimeInterval)
}

/// Plays one audio file at a time. ``AudioPlayer`` is the device's; a test supplies its own.
@MainActor
public protocol AudioPlayback: PlaybackTransport {
    /// True once the loaded file turns out not to play.
    var hasFailed: Bool { get }
    /// Whether reaching the loop end from inside the loop goes back to its start.
    var isRepeating: Bool { get }
    /// Whether the lock screen and Control Center offer skips by an interval. Read when a file
    /// loads, so a queue turns it off before loading a track and the system offers next and
    /// previous instead.
    var skipsByInterval: Bool { get set }
    /// While true, unloading keeps the audio session active, so a background app can start the
    /// next track.
    var holdsSession: Bool { get set }
    /// Told before each command from outside the app is carried out: the lock screen, Control
    /// Center, headphones, CarPlay, or the Mac's media keys. The app's own controls never call it.
    var onSystemCommand: (@MainActor () -> Void)? { get set }

    /// Loads `url` in place of anything loaded, paused at its start, playing the whole file at
    /// normal speed and pitch with no loop until told otherwise. `keepLoop`, for a new file of
    /// the same recording, keeps Repeat on but sets the loop aside until ``setLoop(_:)`` gives
    /// its range in the new file.
    func load(_ url: URL, nowPlaying: NowPlaying, keepLoop: Bool)
    /// Plays only `window` of the loaded file, or all of it when nil. Keeps the place in the
    /// file, held within the new window, and keeps playing or paused.
    func setWindow(_ window: PlaybackWindow?)
    /// The loop Repeat plays, in seconds into the playback window, or none. With Repeat on, a
    /// position outside the new loop moves to its start; otherwise the position stays.
    func setLoop(_ loop: PlaybackWindow?)
    /// Turns Repeat on or off. On with the position outside the loop moves it to the loop
    /// start; off never moves it.
    func setRepeat(_ on: Bool)
    /// Plays at `percent` of normal speed with the pitch held, without restarting.
    func setRate(_ percent: Int)
    /// Shifts the pitch by `cents` with the speed held, without restarting.
    func setPitch(cents: Int)
    /// Keeps or removes the part of the sound `s` describes, without restarting; `isMono` makes
    /// it ignore pan. Any setting but the default engages the isolate unit.
    func setIsolate(_ s: IsolateSetting, isMono: Bool)
    /// Asks for the isolate outline, as the Isolate panel does while it shows. Wanted, the outline
    /// engages the isolate unit at any setting, so it is live and the first change to the
    /// setting brings no jump in delay.
    func setIsolateOutlineWanted(_ on: Bool)
    /// Whether the isolate unit could be made; without it the setting does nothing.
    var isolateAvailable: Bool { get }
    /// Input level by pan and by frequency, nil while nothing wants it. Changes
    /// without telling observers, so a view reads it on a timer.
    var isolateOutline: IsolateOutline? { get }
    /// Whether the audio file at `url` is mono, by ``MonoDetector``'s rule. Reads and decodes
    /// the file off the main actor.
    func measureMono(url: URL) async throws -> Bool
    /// Renames the loaded audio on the Now Playing surfaces.
    func retitle(_ nowPlaying: NowPlaying)
    /// Stops and lets go of the loaded audio and the system's playback controls.
    func unload()
    /// iOS: makes the session `.playback` with `.mixWithOthers` and active, so MusicKit's session
    /// plays beside it instead of interrupting it. No-op on macOS.
    func yieldSessionToMusic()
    /// Deactivates a held session. No-op unless ``holdsSession`` was on.
    func releaseSession()
}

extension AudioPlayback {
    public func load(_ url: URL, nowPlaying: NowPlaying) {
        load(url, nowPlaying: nowPlaying, keepLoop: false)
    }
}

extension PlaybackTransport {
    public func toggle() {
        if isPlaying { pause() } else { play() }
    }

    /// Moves `seconds` forward, or back when negative.
    public func skip(by seconds: TimeInterval) {
        seek(to: elapsed + seconds)
    }
}

/// `seconds` held within the audio: never before its start, and never past its end once its
/// length is known.
func clampedPosition(_ seconds: TimeInterval, duration: TimeInterval?) -> TimeInterval {
    let floor = max(0, seconds)
    guard let duration else { return floor }
    return min(floor, duration)
}

/// One state the lock screen and Control Center are told about, on the trimmed timeline.
struct PublishedPlayback: Equatable {
    let nowPlaying: NowPlaying
    let duration: TimeInterval?
    let elapsed: TimeInterval
    let isPlaying: Bool
    let rate: Float
}
