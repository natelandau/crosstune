import CrosstuneAudio
import CrosstuneDesign
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
    let disabledReason: String?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let ready = model.isLoaded && disabledReason == nil
        let playLabel = PlayButtonLabel(isPlaying: model.isPlaying, repeating: model.selected.map(model.name))
        VStack(spacing: spacing.stackGap) {
            Transport(
                isPlaying: model.isPlaying, size: .feature, playName: playLabel.label,
                playGlyph: playLabel.systemImage, canPlay: ready, canGoBack: ready, canGoForward: ready,
                onPlayPause: model.togglePlay,
                onBack: { model.skip(by: -AudioPlayer.skipInterval) },
                onForward: { model.skip(by: AudioPlayer.skipInterval) }
            )
            .frame(maxWidth: .infinity)
            .audioRoutePicker()
            #if !os(macOS)
                LoopSwitcher(model: model, disabledReason: disabledReason)
            #endif
        }
    }
}
