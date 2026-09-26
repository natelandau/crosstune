import AVKit
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

/// Plays one audio file at a time. ``AudioPlayer`` is the device's; a test stands in its own.
@MainActor
public protocol AudioPlayback: AnyObject {
    /// Whether audio is playing now, as opposed to loaded and paused or not loaded.
    var isPlaying: Bool { get }
    /// Seconds into the loaded audio.
    var elapsed: TimeInterval { get }
    /// The loaded audio's length, nil until it is known.
    var duration: TimeInterval? { get }
    /// True once the loaded file turns out not to play.
    var hasFailed: Bool { get }

    /// Loads `url` in place of anything loaded, paused at its start.
    func load(_ url: URL, nowPlaying: NowPlaying)
    /// Renames the loaded audio on the Now Playing surfaces.
    func retitle(_ nowPlaying: NowPlaying)
    func play()
    func pause()
    /// Moves to `seconds` into the audio, kept within its length.
    func seek(to seconds: TimeInterval)
    /// Stops and lets go of the loaded audio and the system's playback controls.
    func unload()
    /// Points the system's route picker at this player, so choosing an AirPlay speaker there
    /// sends this audio to it.
    func showRoutes(in picker: AVRoutePickerView)
}

extension AudioPlayback {
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
