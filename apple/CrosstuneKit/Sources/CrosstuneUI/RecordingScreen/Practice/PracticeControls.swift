import CrosstuneAudio
import SwiftUI

/// What the play button shows: Pause while playing; Repeat and the loop's name, with the repeat
/// symbol, while paused with a loop selected; Play otherwise.
struct PlayButtonLabel: Equatable {
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

/// The transport: skip back, play, and skip forward, centered, with the loop switcher under
/// play on iOS. The Mac sets the switcher in the stage, beside the readout.
struct PracticeControls: View {
    let model: PracticeModel
    /// Why the waveform, transport, and modes cannot be used yet.
    let blocker: String?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let ready = model.isLoaded && blocker == nil
        VStack(spacing: spacing.stackGap) {
            Transport(model: model)
                .disabled(!ready)
                #if os(iOS)
                    // The transport keeps its size at every text size, as the waveform's overlay
                    // does, and leaves the route picker's width clear on each side so the skips
                    // never meet it.
                    .dynamicTypeSize(...DynamicTypeSize.large)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, minimumTapTarget)
                    .overlay(alignment: .trailing) {
                        AudioRoutePicker().dynamicTypeSize(...DynamicTypeSize.large)
                    }
                #else
                    .frame(maxWidth: .infinity)
                #endif
            #if !os(macOS)
                LoopSwitcher(model: model, blocker: blocker)
            #endif
        }
    }
}

/// Skip back, play, and skip forward. Its own view so its spacing reads the text size the
/// transport is held to.
private struct Transport: View {
    let model: PracticeModel

    @Environment(\.spacing) private var spacing
    @Environment(\.practiceGround) private var ground

    private var player: PlayerModel { model.player }

    var body: some View {
        #if os(macOS)
            HStack(spacing: 20) { buttons }
        #else
            HStack(spacing: spacing(32)) { buttons }
        #endif
    }

    @ViewBuilder private var buttons: some View {
        skip(-AudioPlayer.skipInterval, systemImage: "gobackward.15", name: RecordingPlayerText.skipBack)
        playButton
        skip(AudioPlayer.skipInterval, systemImage: "goforward.15", name: RecordingPlayerText.skipForward)
    }

    private var playButton: some View {
        let playLabel = PlayButtonLabel(isPlaying: player.audio.isPlaying, repeating: model.selected.map(model.name))
        return Button {
            player.audio.toggle()
        } label: {
            #if os(macOS)
                MacPlayButtonLabel(playLabel: playLabel)
            #else
                if let ground {
                    GroundPlayButtonLabel(playLabel: playLabel, ground: ground)
                } else {
                    standardPlayButtonLabel(playLabel)
                }
            #endif
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playLabel.label)
        .help(playLabel.label)
        // Capped at the default text size, so a long press shows it enlarged.
        .accessibilityShowsLargeContentViewer()
    }

    #if !os(macOS)
        private func standardPlayButtonLabel(_ playLabel: PlayButtonLabel) -> some View {
            Image(systemName: playLabel.systemImage)
                .font(.largeTitle)
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 64, minHeight: 64)
                .contentShape(.rect)
        }
    #endif

    private func skip(_ seconds: TimeInterval, systemImage: String, name: (TimeInterval) -> String) -> some View {
        Button {
            player.audio.skip(by: seconds)
        } label: {
            #if os(macOS)
                Label(name(abs(seconds)), systemImage: systemImage)
                    .labelStyle(.iconOnly)
                    .font(.system(size: 15))
            #else
                Label(name(abs(seconds)), systemImage: systemImage)
                    .labelStyle(.iconOnly)
                    .font(.title2)
                    .frame(minWidth: PracticeLayout.target, minHeight: PracticeLayout.target)
                    .contentShape(.rect)
            #endif
        }
        #if os(macOS)
            .buttonStyle(.mac(.icon, size: .large))
        #else
            .buttonStyle(.plain)
        #endif
        .help(name(abs(seconds)))
        // Capped at the default text size, so a long press shows it enlarged.
        .accessibilityShowsLargeContentViewer()
    }
}

/// Play on the practice ground: the glyph in the ground's color on a white disc, at a fixed size
/// so the transport stays put as its labels scale.
private struct GroundPlayButtonLabel: View {
    let playLabel: PlayButtonLabel
    /// The appearance whose ground the glyph takes.
    let ground: ColorScheme

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Image(systemName: playLabel.systemImage)
            .font(.system(size: 30, weight: .semibold))
            .contentTransition(.symbolEffect(.replace))
            .foregroundStyle(PhoneStyle.practiceGround(ground))
            .frame(width: PhoneStyle.transportPlayDiameter, height: PhoneStyle.transportPlayDiameter)
            .background(.white, in: .circle)
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(.circle)
    }
}

#if os(macOS)
    /// Play on the Mac: a white glyph on an accent fill disc, the practice view's one primary
    /// action. It keeps its fill in an inactive window.
    private struct MacPlayButtonLabel: View {
        let playLabel: PlayButtonLabel

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            Image(systemName: playLabel.systemImage)
                .font(.system(size: 18, weight: .semibold))
                .contentTransition(.symbolEffect(.replace))
                .foregroundStyle(Palette.onAccentFill)
                .frame(width: MacStyle.transportDiameter, height: MacStyle.transportDiameter)
                .background(Palette.accentFill, in: .circle)
                .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
                .contentShape(.circle)
        }
    }
#endif
