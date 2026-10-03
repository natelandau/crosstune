import AVKit
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneSync
import SwiftUI

/// How the recording player writes a position: `m:ss`, or `h:mm:ss` past an hour.
public enum PlayerTime {
    /// A position counted up from the start, in whole seconds reached.
    public static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(max(0, seconds.isFinite ? seconds : 0))
        let (hours, rest) = total.quotientAndRemainder(dividingBy: 3600)
        let (minutes, secs) = rest.quotientAndRemainder(dividingBy: 60)
        let tail = "\(secs < 10 ? "0" : "")\(secs)"
        guard hours > 0 else { return "\(minutes):\(tail)" }
        return "\(hours):\(minutes < 10 ? "0" : "")\(minutes):\(tail)"
    }

    /// The time left, counted down and marked with a minus, as players show it. Rounded up so it
    /// reaches `-0:00` only at the end.
    public static func remaining(_ elapsed: TimeInterval, of duration: TimeInterval) -> String {
        "-" + clock(max(0, duration - elapsed).rounded(.up))
    }

    /// The scrubber's spoken value: "1:02 of 3:04".
    public static func spoken(_ elapsed: TimeInterval, of duration: TimeInterval?) -> String {
        guard let duration else { return clock(elapsed) }
        return "\(clock(elapsed)) of \(clock(duration))"
    }
}

/// Words the recording player shows.
public enum RecordingPlayerText {
    public static let play = MediaText.play
    public static let pause = "Pause"
    public static let position = "Position"
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

/// Play or pause for the loaded recording, or what stands in for it while its audio is fetched
/// or missing. The glyph morphs between play and pause.
struct RecordingPlayButton: View {
    let player: PlayerModel
    var font: Font = .title3

    var body: some View {
        switch player.recordingAudio {
        case .fetching:
            ProgressView()
                .controlSize(.small)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(RecordingText.downloading)
        case .loaded where !player.audio.hasFailed:
            let playing = player.audio.isPlaying
            Button {
                player.audio.toggle()
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(font)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playing ? RecordingPlayerText.pause : RecordingPlayerText.play)
            .help(playing ? RecordingPlayerText.pause : RecordingPlayerText.play)
        default:
            Image(systemName: "exclamationmark.circle")
                .font(font)
                .foregroundStyle(.secondary)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHidden(true)
        }
    }
}

/// The loaded recording's position: a slider to scrub with, the time played, and the time left.
/// While it is dragged the times follow the thumb, and playback moves once it is let go.
struct PlaybackScrubber: View {
    let audio: any PlaybackTransport

    @State private var isEditing = false
    @State private var dragged: TimeInterval?

    var body: some View {
        let duration = audio.duration
        let position = dragged ?? audio.elapsed
        VStack(spacing: 2) {
            Slider(
                value: Binding {
                    position
                } set: { value in
                    // An accessibility adjustment arrives with no drag around it.
                    if isEditing { dragged = value } else { audio.seek(to: value) }
                },
                in: 0...max(duration ?? 0, 0.1)
            ) { editing in
                isEditing = editing
                if !editing, let dragged {
                    audio.seek(to: dragged)
                    self.dragged = nil
                }
            }
            .disabled(duration == nil)
            .accessibilityLabel(RecordingPlayerText.position)
            .accessibilityValue(PlayerTime.spoken(position, of: duration))
            HStack {
                Text(PlayerTime.clock(position))
                Spacer()
                Text(duration.map { PlayerTime.remaining(position, of: $0) } ?? "")
            }
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
    }
}

/// Where the recording player stands when it has no audio to scrub: fetching, offline, or
/// failed, with Retry when another try could help.
struct RecordingPlayerStatus: View {
    let player: PlayerModel
    let message: String

    @Environment(AccountSession.self) private var session: AccountSession?

    var body: some View {
        HStack {
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            // Offline refuses the retry by not offering it, rather than a control that cannot work.
            if player.recordingAudio == .unavailable && session?.isOffline != true {
                Button(MediaText.retry) { player.retryAudio() }
                    .buttonStyle(.bordered)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
    }
}

/// The body under the recording player's bar: the scrubber, or what stands in for it.
struct RecordingPlayerBody: View {
    let player: PlayerModel

    @Environment(AccountSession.self) private var session: AccountSession?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let failure = player.failure {
                PlayerFailureText(failure)
            }
            if let message = RecordingPlayerText.status(
                player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
            {
                RecordingPlayerStatus(player: player, message: message)
            } else {
                PlaybackScrubber(audio: player.audio)
            }
        }
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
            .font(.footnote)
            .foregroundStyle(.red)
    }
}

#if os(iOS)
    /// The system's control for choosing where audio plays: AirPlay speakers, headphones, or
    /// this device. It routes the whole audio session, which the player's engine plays into.
    /// The Mac has none: its picker routes only an `AVPlayer`, and the engine follows the output
    /// chosen in the menu bar's Sound control.
    struct AudioRoutePicker: View {
        var body: some View {
            RoutePickerRepresentable()
                .frame(width: 44, height: 44)
        }
    }

    private struct RoutePickerRepresentable: UIViewRepresentable {
        func makeUIView(context: Context) -> AVRoutePickerView {
            let view = AVRoutePickerView()
            view.prioritizesVideoDevices = false
            return view
        }

        func updateUIView(_ view: AVRoutePickerView, context: Context) {}
    }
#endif
