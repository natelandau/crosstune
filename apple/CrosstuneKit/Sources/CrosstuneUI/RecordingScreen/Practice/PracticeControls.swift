import CrosstuneAudio
import SwiftUI

/// What the play button shows: Pause while playing; Repeat and the loop's name, with the repeat
/// symbol, while paused with a loop selected; Play otherwise.
struct PlayFace: Equatable {
    let label: String
    let systemImage: String

    init(label: String, systemImage: String) {
        self.label = label
        self.systemImage = systemImage
    }

    init(isPlaying: Bool, repeating name: String?) {
        if isPlaying {
            self.init(label: RecordingPlayerText.pause, systemImage: "pause.fill")
        } else if let name {
            self.init(label: PracticeText.repeatLoop(name), systemImage: "repeat")
        } else {
            self.init(label: RecordingPlayerText.play, systemImage: "play.fill")
        }
    }
}

/// The transport, between the mode selector and the mode's controls: skip back, play, and skip
/// forward, centered, with the loop switcher under play.
struct PracticeControls: View {
    let model: PracticeModel
    /// Why the waveform, transport, and modes cannot be used yet.
    let blocker: String?

    @Environment(\.spacing) private var spacing
    @Environment(\.practiceGround) private var ground

    private var player: PlayerModel { model.player }

    var body: some View {
        let ready = model.isLoaded && blocker == nil
        VStack(spacing: spacing.stackGap) {
            HStack(spacing: spacing(32)) {
                skip(-AudioPlayer.skipInterval, systemImage: "gobackward.15", name: RecordingPlayerText.skipBack)
                playButton
                skip(AudioPlayer.skipInterval, systemImage: "goforward.15", name: RecordingPlayerText.skipForward)
            }
            .disabled(!ready)
            .frame(maxWidth: .infinity)
            #if os(iOS)
                .overlay(alignment: .trailing) { AudioRoutePicker() }
            #endif
            LoopSwitcher(model: model, blocker: blocker)
        }
    }

    private var playButton: some View {
        let face = PlayFace(isPlaying: player.audio.isPlaying, repeating: model.selected.map(model.name))
        return Button {
            player.audio.toggle()
        } label: {
            if let ground {
                GroundPlayFace(face: face, ground: ground)
            } else {
                standardPlayFace(face)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(face.label)
        .help(face.label)
    }

    private func standardPlayFace(_ face: PlayFace) -> some View {
        Image(systemName: face.systemImage)
            #if os(macOS)
                .font(.system(size: 24))
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 40, minHeight: 40)
            #else
                .font(.largeTitle)
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 64, minHeight: 64)
            #endif
            .contentShape(.rect)
    }

    private func skip(_ seconds: TimeInterval, systemImage: String, name: (TimeInterval) -> String) -> some View {
        Button {
            player.audio.skip(by: seconds)
        } label: {
            Label(name(abs(seconds)), systemImage: systemImage)
                .labelStyle(.iconOnly)
                #if os(macOS)
                    .font(.system(size: 17))
                #else
                    .font(.title2)
                #endif
                .frame(minWidth: PracticeLayout.target, minHeight: PracticeLayout.target)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(name(abs(seconds)))
    }
}

/// Play on the practice ground: the glyph in the ground's color on a white disc, at a fixed size
/// so the transport stays put as its labels scale.
private struct GroundPlayFace: View {
    let face: PlayFace
    /// The appearance whose ground the glyph takes.
    let ground: ColorScheme

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Image(systemName: face.systemImage)
            .font(.system(size: 30, weight: .semibold))
            .contentTransition(.symbolEffect(.replace))
            .foregroundStyle(PhoneStyle.practiceGround(ground))
            .frame(width: PhoneStyle.transportPlayDiameter, height: PhoneStyle.transportPlayDiameter)
            .background(.white, in: .circle)
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(.circle)
    }
}
