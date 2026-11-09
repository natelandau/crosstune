import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// The recording screen's modes, each with its own controls under the waveform. A page opens on
/// the first, Speed.
enum PracticeMode: String, CaseIterable, Identifiable, Sendable {
    case speed
    case pitch
    case isolate
    case loops

    var id: Self { self }

    /// The mode's tab, which shows its value once that is off its default (`Speed 75%`).
    func tab(speedPercent: Int, pitchCents: Int, isolate: IsolateSetting) -> PaneTab<PracticeMode> {
        PaneTab(
            self, title: name, systemImage: systemImage,
            valueText: badge(speedPercent: speedPercent, pitchCents: pitchCents, isolate: isolate))
    }

    var name: String {
        switch self {
        case .loops: PracticeText.loops
        case .speed: RecordingScreenText.speed
        case .pitch: RecordingScreenText.pitch
        case .isolate: RecordingScreenText.isolate
        }
    }

    var systemImage: String {
        switch self {
        case .loops: "repeat"
        case .speed: "gauge.with.dots.needle.33percent"
        case .pitch: "tuningfork"
        case .isolate: "waveform"
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

/// Speed, Pitch, Isolate, and Loops as tabs. The chosen mode's controls are ``ModeControls``;
/// on iPhone and iPad the transport sits between the two, while the Mac sets the tabs right over
/// their panel, under the transport. Both read the mode from the model.
struct ModePicker: View {
    let model: PracticeModel

    var body: some View {
        @Bindable var model = model
        PaneTabs(
            selection: $model.mode,
            tabs: PracticeMode.allCases.map {
                $0.tab(speedPercent: model.speedPercent, pitchCents: model.pitchCents, isolate: model.effectiveIsolate)
            },
            title: PracticeText.modes)
    }
}

/// The chosen mode's own controls, under the transport. Every mode's panel is laid out unseen in
/// the same place, so the block is always as tall as the tallest panel and changing mode never
/// moves the waveform above it.
struct ModeControls: View {
    let model: PracticeModel
    /// Delete loop removed the selected loop, whose control goes disabled with it.
    let onDeleted: () -> Void

    /// Held here rather than in the Pitch panel, which a mode change rebuilds, so a shift on a
    /// half semitone keeps the split it was given.
    @State private var pitchSplit: PitchSplit

    init(model: PracticeModel, onDeleted: @escaping () -> Void) {
        self.model = model
        self.onDeleted = onDeleted
        _pitchSplit = State(initialValue: PitchSplit(cents: model.pitchCents))
    }

    var body: some View {
        ZStack(alignment: .top) {
            ForEach(PracticeMode.allCases) { mode in
                panel(mode, isShown: false).reserved(shown: false)
            }
            PaneTabPanel(selection: model.mode, order: PracticeMode.allCases) {
                panel(model.mode, isShown: true)
            }
        }
        .onChange(of: model.pitchCents) { pitchSplit.follow(model.pitchCents) }
    }

    @ViewBuilder private func panel(_ mode: PracticeMode, isShown: Bool) -> some View {
        Group {
            switch mode {
            case .loops: LoopsPanel(model: model, onDeleted: onDeleted)
            case .speed: SpeedPanel(value: model.speedPercent, onChange: model.setSpeed)
            case .pitch: PitchPanel(value: model.pitchCents, split: $pitchSplit, onChange: model.setPitch)
            case .isolate: LiveIsolatePanel(model: model, shown: isShown)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
