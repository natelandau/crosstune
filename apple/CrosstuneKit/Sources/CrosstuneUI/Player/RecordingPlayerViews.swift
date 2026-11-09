import CrosstuneAudio
import CrosstuneAuth
import CrosstuneDesign
import CrosstuneSync
import SwiftUI

/// Words the recording player shows.
public enum RecordingPlayerText {
    public static let play = MediaText.play
    public static let pause = MediaText.pause
    public static let position = PlaybackScrubber.defaultName
    public static let playFailed = "Couldn't play"

    public static func skipBack(_ seconds: TimeInterval) -> String { "Back \(Int(seconds)) seconds" }
    public static func skipForward(_ seconds: TimeInterval) -> String { "Forward \(Int(seconds)) seconds" }

    /// What the player says in place of its controls, or nil once the audio is loaded and plays.
    /// Offline names why a fetch cannot run rather than calling it failed.
    public static func status(_ audio: RecordingAudio?, hasFailed: Bool, offline: Bool) -> String? {
        switch audio {
        case .fetching: RecordingText.downloading
        case .unavailable: offline ? SyncStatus.offlineLabel : RecordingText.downloadFailed
        case .loaded: hasFailed ? playFailed : nil
        case nil: nil
        }
    }
}

/// Play or pause for the loaded recording or the Apple Music link MusicKit plays, or what shows
/// instead while a recording's audio is fetched or missing.
struct RecordingPlayButton: View {
    let player: PlayerModel

    @Environment(AccountSession.self) private var session: AccountSession?

    var body: some View {
        if let transport = player.transport {
            Transport(
                isPlaying: transport.isPlaying, size: .inline, sides: .hidden,
                onPlayPause: { transport.toggle() })
        } else {
            placeholder
        }
    }

    @ViewBuilder private var placeholder: some View {
        switch player.recordingAudio {
        case .fetching:
            ProgressView()
                .controlSize(.small)
                .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                .accessibilityLabel(RecordingText.downloading)
        default:
            Image(systemName: "exclamationmark.circle")
                .font(.platform(.title3))
                .foregroundStyle(.textSecondary)
                .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                // Sits where play would, so VoiceOver hears why there is none.
                .accessibilityLabel(
                    RecordingPlayerText.status(
                        player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
                        ?? RecordingPlayerText.playFailed)
        }
    }
}

/// The scrubber over a transport's position. While it is dragged the times follow the drag, and
/// playback moves once it is let go.
struct TransportScrubber: View {
    let audio: any PlaybackTransport
    /// A new value redraws the position, for a transport that does not announce it.
    var tick: Date?
    /// The times either side of the track on one line, as the Mac dock lays it out.
    var timesBeside = false

    @State private var dragged: TimeInterval?

    var body: some View {
        let _ = tick
        PlaybackScrubber(
            position: dragged ?? audio.elapsed, duration: audio.duration ?? 0,
            timesBeside: timesBeside,
            onScrub: { dragged = $0 },
            onScrubEnd: { position in
                audio.seek(to: position)
                dragged = nil
            })
    }
}

/// The recording player's state when it has no audio to scrub: fetching, offline, or
/// failed, with Retry when another try could help.
struct RecordingPlayerStatus: View {
    let player: PlayerModel
    let message: String

    @Environment(AccountSession.self) private var session: AccountSession?

    var body: some View {
        HStack {
            Text(message)
                .font(.platform(.footnote))
                .foregroundStyle(.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            // Offline refuses the retry by not offering it, rather than a control that cannot work.
            if player.recordingAudio == .unavailable && session?.isOffline != true {
                Button(MediaText.retry) { player.retryAudio() }
                    .buttonStyle(.tinted(macLook: .bordered))
            }
        }
        .frame(minHeight: minimumTapTarget)
        .accessibilityElement(children: .contain)
    }
}

/// Why the last change to the loaded recording did not land, in red.
struct PlayerFailureText: View {
    let failure: String

    init(_ failure: String) {
        self.failure = failure
    }

    var body: some View {
        Text(failure)
            .font(.platform(.footnote))
            .foregroundStyle(Palette.danger)
    }
}
