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

/// The readout and transport, between the mode selector and the mode's controls: the playhead
/// to the tenth of a second (or why the screen cannot be used yet), Zoom out, Fit, and Zoom in,
/// then skip back, play, and skip forward, with the loop switcher under play.
struct PracticeControls: View {
    let model: PracticeModel
    /// Why the waveform, transport, and modes cannot be used yet, shown in place of the readout.
    let blocker: String?

    @Environment(\.spacing) private var spacing

    private var player: PlayerModel { model.player }

    var body: some View {
        let ready = model.isLoaded && blocker == nil
        VStack(spacing: spacing.stackGap) {
            HStack(spacing: spacing(4)) {
                readout
                Spacer(minLength: 0)
                Group {
                    iconButton(RecordingScreenText.zoomOut, systemImage: "minus.magnifyingglass") {
                        model.zoom(by: 1 / PracticeModel.zoomStep)
                    }
                    .keyboardShortcut("-", modifiers: .command)
                    .disabled(!model.canZoomOut)
                    Button {
                        model.fit()
                    } label: {
                        Text(PracticeText.fit)
                            .font(.subheadline)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(.rect)
                    }
                    .disabled(model.scale == nil)
                    iconButton(RecordingScreenText.zoomIn, systemImage: "plus.magnifyingglass") {
                        model.zoom(by: PracticeModel.zoomStep)
                    }
                    .keyboardShortcut("=", modifiers: .command)
                    .disabled(!model.canZoomIn)
                }
                .buttonStyle(.borderless)
                .disabled(blocker != nil)
            }
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

    @ViewBuilder private var readout: some View {
        if let blocker {
            Text(blocker)
                .font(.headline)
                .foregroundStyle(.secondary)
        } else {
            TimelineView(.animation(minimumInterval: 0.1, paused: !player.audio.isPlaying)) { _ in
                Text(RecordingScreenText.preciseTime(milliseconds: Int64(model.shownCenterMs(at: model.clock()))))
                    .font(.title2)
                    .monospacedDigit()
            }
            .accessibilityHidden(true)
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

    private func iconButton(_ name: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(name, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .help(name)
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
