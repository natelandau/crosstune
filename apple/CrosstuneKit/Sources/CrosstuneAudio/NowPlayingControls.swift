import Foundation
import MediaPlayer

/// The loaded recording on the system's Now Playing surfaces, and the remote commands that
/// drive it from there: the lock screen, Control Center, headphone buttons, CarPlay, and the
/// Mac's media keys. Registered while audio is loaded and removed once it is not, so the system
/// never offers controls for nothing.
@MainActor
final class NowPlayingControls {
    private var registrations: [(command: MPRemoteCommand, target: Any)] = []

    init(player: AudioPlayer) {
        let center = MPRemoteCommandCenter.shared()
        register(center.playCommand, on: player) { player, _ in player.play() }
        register(center.pauseCommand, on: player) { player, _ in player.pause() }
        register(center.togglePlayPauseCommand, on: player) { player, _ in player.toggle() }
        let interval = [NSNumber(value: AudioPlayer.skipInterval)]
        center.skipBackwardCommand.preferredIntervals = interval
        register(center.skipBackwardCommand, on: player) { player, _ in player.skip(by: -AudioPlayer.skipInterval) }
        center.skipForwardCommand.preferredIntervals = interval
        register(center.skipForwardCommand, on: player) { player, _ in player.skip(by: AudioPlayer.skipInterval) }
        register(center.changePlaybackPositionCommand, on: player) { player, event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return }
            player.seek(to: event.positionTime)
        }
    }

    /// Shows `nowPlaying` with where playback stands. The system moves the elapsed time on by
    /// itself from the rate, so this runs only when something changes, never on a timer.
    func publish(_ nowPlaying: NowPlaying, duration: TimeInterval?, elapsed: TimeInterval, isPlaying: Bool) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlaying.title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
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
        _ handle: @escaping @MainActor (AudioPlayer, MPRemoteCommandEvent) -> Void
    ) {
        command.isEnabled = true
        let target = command.addTarget { [weak player] event in
            MainActor.assumeIsolated {
                guard let player else { return .noActionableNowPlayingItem }
                handle(player, event)
                return .success
            }
        }
        registrations.append((command, target))
    }
}
