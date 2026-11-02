import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// The recording screen's modes, each with its own controls under the waveform. The one last
/// used is device state, kept under ``storageKey``.
enum PracticeMode: String, CaseIterable, Identifiable, Sendable {
    case loops
    case speed
    case pitch
    case isolate

    static let storageKey = "practiceMode"

    var id: Self { self }

    /// `Speed 75%`: the mode's name, with its value once that is off its default.
    func title(speedPercent: Int, pitchCents: Int, isolate: IsolateSetting) -> String {
        PracticeText.segment(name, value: badge(speedPercent: speedPercent, pitchCents: pitchCents, isolate: isolate))
    }

    var name: String {
        switch self {
        case .loops: PracticeText.loops
        case .speed: RecordingScreenText.speed
        case .pitch: RecordingScreenText.pitch
        case .isolate: RecordingScreenText.isolate
        }
    }

    /// The mode's value once that is off its default, such as `75%`, or `Mute` for Isolate.
    func badge(speedPercent: Int, pitchCents: Int, isolate: IsolateSetting) -> String? {
        let badges = RecordingScreenText.badges(speedPercent: speedPercent, pitchCents: pitchCents)
        return switch self {
        case .loops: nil
        case .speed: badges.speed
        case .pitch: badges.pitch
        case .isolate:
            isolate.isDefault ? nil : isolate.effect == .mute ? RecordingScreenText.mute : RecordingScreenText.solo
        }
    }
}

/// Loops, Speed, Pitch, and Isolate as one segmented control. The chosen mode's controls are
/// ``ModeControls``; on iPhone and iPad the transport sits between the two, while the Mac sets
/// the picker right over its panel, under the transport. Both read the mode from the model.
struct ModePicker: View {
    let model: PracticeModel

    private var player: PlayerModel { model.player }

    var body: some View {
        @Bindable var model = model
        #if os(macOS)
            MacSegmented(
                selection: $model.mode, options: PracticeMode.allCases, label: \.name,
                badge: {
                    $0.badge(
                        speedPercent: player.speedPercent, pitchCents: player.pitchCents,
                        isolate: player.effectiveIsolate)
                },
                title: PracticeText.modes, fillsWidth: true)
        #else
            picker
        #endif
    }

    private var picker: some View {
        @Bindable var model = model
        return Picker(PracticeText.modes, selection: $model.mode) {
            ForEach(PracticeMode.allCases) { mode in
                Text(
                    mode.title(
                        speedPercent: player.speedPercent, pitchCents: player.pitchCents,
                        isolate: player.effectiveIsolate)
                )
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
            panel(.isolate) { LiveIsolatePanel(player: player, shown: model.mode == .isolate) }
        }
    }

    private func panel(_ mode: PracticeMode, @ViewBuilder content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity)
            .reserved(shown: model.mode == mode)
    }
}
