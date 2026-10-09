import Foundation
import MediaPlayer

/// The loaded recording on the system's Now Playing surfaces, and the remote commands that
/// drive it from there: the lock screen, Control Center, headphone buttons, CarPlay, and the
/// Mac's media keys. Registered while audio is loaded and removed once it is not, so the system
/// never offers controls for nothing.
@MainActor
final class NowPlayingControls {
    /// A command's handler, given the position a change-of-position command asks for.
    private typealias Run = (_ position: TimeInterval?) -> MPRemoteCommandHandlerStatus
    private var registrations: [(command: MPRemoteCommand, target: Any, run: Run)] = []

    /// - Parameter skipsByInterval: Offers skips by an interval. Off, they are disabled so the
    ///   system shows next and previous, which it never does while both kinds are enabled.
    init(player: AudioPlayer, skipsByInterval: Bool) {
        let center = MPRemoteCommandCenter.shared()
        register(center.playCommand, on: player) { player, _ in player.play() }
        register(center.pauseCommand, on: player) { player, _ in player.pause() }
        register(center.togglePlayPauseCommand, on: player) { player, _ in player.toggle() }
        if skipsByInterval {
            let interval = [NSNumber(value: AudioPlayer.skipInterval)]
            center.skipBackwardCommand.preferredIntervals = interval
            register(center.skipBackwardCommand, on: player) { player, _ in player.skip(by: -AudioPlayer.skipInterval) }
            center.skipForwardCommand.preferredIntervals = interval
            register(center.skipForwardCommand, on: player) { player, _ in player.skip(by: AudioPlayer.skipInterval) }
        } else {
            center.skipBackwardCommand.isEnabled = false
            center.skipForwardCommand.isEnabled = false
        }
        register(center.changePlaybackPositionCommand, on: player) { player, position in
            guard let position else { return }
            player.seek(to: position)
        }
    }

    /// Shows `nowPlaying` with where playback stands on the trimmed timeline. The system moves
    /// the elapsed time on by itself from `rate`, the chosen speed, so this runs only when
    /// something changes, never on a timer.
    func publish(
        _ nowPlaying: NowPlaying, duration: TimeInterval?, elapsed: TimeInterval, isPlaying: Bool, rate: Float
    ) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlaying.title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(rate),
        ]
        // The line under the title names the tune, unless the title already does.
        if let tune = nowPlaying.tuneTitle, tune != nowPlaying.title {
            info[MPMediaItemPropertyArtist] = tune
        }
        if let duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = info
        #if os(macOS)
            // The Mac shows Now Playing from the state rather than the rate.
            center.playbackState = isPlaying ? .playing : .paused
        #endif
    }

    /// Takes the recording off the Now Playing surfaces.
    static func clear() {
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = nil
        #if os(macOS)
            center.playbackState = .stopped
        #endif
    }

    #if DEBUG
        /// Runs the handler registered on `command` as the system would, for a test, with the
        /// `position` a change-of-position command carries.
        func perform(_ command: MPRemoteCommand, position: TimeInterval? = nil) -> MPRemoteCommandHandlerStatus? {
            registrations.first { $0.command === command }?.run(position)
        }
    #endif

    func remove() {
        for registration in registrations {
            registration.command.removeTarget(registration.target)
            registration.command.isEnabled = false
        }
        registrations = []
    }

    /// Adds `handle` to `command`, run on `player` while it lasts. The system calls it on the
    /// main thread.
    private func register(
        _ command: MPRemoteCommand, on player: AudioPlayer,
        _ handle: @escaping @MainActor (AudioPlayer, _ position: TimeInterval?) -> Void
    ) {
        command.isEnabled = true
        let run: Run = { [weak player] position in
            MainActor.assumeIsolated {
                guard let player else { return .noActionableNowPlayingItem }
                player.onSystemCommand?()
                handle(player, position)
                return .success
            }
        }
        let target = command.addTarget { event in
            run((event as? MPChangePlaybackPositionCommandEvent)?.positionTime)
        }
        registrations.append((command, target, run))
    }
}
