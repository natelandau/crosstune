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
    let audio: any AudioPlayback

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
        if let message = RecordingPlayerText.status(
            player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
        {
            RecordingPlayerStatus(player: player, message: message)
        } else {
            PlaybackScrubber(audio: player.audio)
        }
    }
}

/// Skip back, play or pause, and skip forward, as the full player shows them.
struct RecordingTransport: View {
    let player: PlayerModel

    var body: some View {
        let ready = player.recordingAudio == .loaded && !player.audio.hasFailed
        HStack(spacing: 40) {
            skip(-AudioPlayer.skipInterval, systemImage: "gobackward.15", name: RecordingPlayerText.skipBack)
            RecordingPlayButton(player: player, font: .largeTitle)
                .frame(minWidth: 64, minHeight: 64)
            skip(AudioPlayer.skipInterval, systemImage: "goforward.15", name: RecordingPlayerText.skipForward)
        }
        .disabled(!ready)
    }

    private func skip(_ seconds: TimeInterval, systemImage: String, name: (TimeInterval) -> String) -> some View {
        Button {
            player.audio.skip(by: seconds)
        } label: {
            Label(name(abs(seconds)), systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.title2)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(name(abs(seconds)))
    }
}

/// The system's control for choosing where audio plays: AirPlay speakers, headphones, or this
/// device.
struct AudioRoutePicker: View {
    let audio: any AudioPlayback

    var body: some View {
        RoutePickerRepresentable(audio: audio)
            .frame(width: 44, height: 44)
    }
}

#if os(iOS)
    private struct RoutePickerRepresentable: UIViewRepresentable {
        let audio: any AudioPlayback

        func makeUIView(context: Context) -> AVRoutePickerView {
            let view = AVRoutePickerView()
            view.prioritizesVideoDevices = false
            audio.showRoutes(in: view)
            return view
        }

        func updateUIView(_ view: AVRoutePickerView, context: Context) {
            audio.showRoutes(in: view)
        }
    }
#else
    private struct RoutePickerRepresentable: NSViewRepresentable {
        let audio: any AudioPlayback

        func makeNSView(context: Context) -> AVRoutePickerView {
            let view = AVRoutePickerView()
            view.isRoutePickerButtonBordered = false
            audio.showRoutes(in: view)
            return view
        }

        func updateNSView(_ view: AVRoutePickerView, context: Context) {
            audio.showRoutes(in: view)
        }
    }
#endif

/// The iPhone's full player for a loaded recording: its name and tune, the scrubber, the
/// transport, and where it plays.
struct RecordingPlayerSheetContent: View {
    let player: PlayerModel

    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 4) {
                Text(player.title ?? "")
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if let tune = player.item?.tuneTitle, tune != player.title {
                    Text(tune)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
            RecordingPlayerBody(player: player)
            RecordingTransport(player: player)
            AudioRoutePicker(audio: player.audio)
        }
    }
}
