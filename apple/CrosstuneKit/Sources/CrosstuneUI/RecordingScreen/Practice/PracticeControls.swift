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
            Image(systemName: face.systemImage)
                .font(.largeTitle)
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 64, minHeight: 64)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(face.label)
        .help(face.label)
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
