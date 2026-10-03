import SwiftUI

/// The recording screen's modes, each with its own controls under the waveform. The one last
/// used is device state, kept under ``storageKey``.
enum PracticeMode: String, CaseIterable, Identifiable, Sendable {
    case loops
    case speed
    case pitch

    static let storageKey = "practiceMode"

    var id: Self { self }

    /// `Speed 75%`: the mode's name, with its value once that is off its default.
    func title(speedPercent: Int, pitchCents: Int) -> String {
        let badges = RecordingScreenText.badges(speedPercent: speedPercent, pitchCents: pitchCents)
        return switch self {
        case .loops: PracticeText.loops
        case .speed: PracticeText.segment(RecordingScreenText.speed, value: badges.speed)
        case .pitch: PracticeText.segment(RecordingScreenText.pitch, value: badges.pitch)
        }
    }
}

/// Loops, Speed, and Pitch as one segmented control, above the transport. The chosen mode's
/// controls are ``ModeControls``, under the transport; both read the mode from the model.
struct ModePicker: View {
    let model: PracticeModel

    private var player: PlayerModel { model.player }

    var body: some View {
        @Bindable var model = model
        Picker(PracticeText.modes, selection: $model.mode) {
            ForEach(PracticeMode.allCases) { mode in
                Text(mode.title(speedPercent: player.speedPercent, pitchCents: player.pitchCents))
                    .monospacedDigit()
                    .tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
}

/// The chosen mode's own controls, under the transport. Every mode's panel is laid out in the
/// same place and only the chosen one shows, so the block is always as tall as the tallest
/// panel and changing mode never moves the waveform above it.
struct ModeControls: View {
    let model: PracticeModel
    /// Delete loop removed the selected loop, whose control goes disabled with it.
    let onDeleted: () -> Void

    private var player: PlayerModel { model.player }

    var body: some View {
        ZStack(alignment: .top) {
            panel(.loops) { LoopsPanel(model: model, onDeleted: onDeleted) }
            panel(.speed) { SpeedPanel(value: player.speedPercent, onChange: player.setSpeed) }
            panel(.pitch) { PitchPanel(value: player.pitchCents, onChange: player.setPitch) }
        }
    }

    private func panel(_ mode: PracticeMode, @ViewBuilder content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity)
            .reserved(shown: model.mode == mode)
    }
}
