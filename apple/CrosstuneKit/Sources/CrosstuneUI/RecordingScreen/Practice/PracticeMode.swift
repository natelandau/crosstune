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

/// Speed, Pitch, Isolate, and Loops as tools, each with its own controls: tabs over the chosen
/// mode's panel on iPhone and iPad, tool buttons with popovers on the Mac. `between` sits between
/// the tabs and the panel on iPhone and iPad.
struct ModePanel<Between: View>: View {
    let model: PracticeModel
    let isAvailable: Bool
    /// Delete loop removed the selected loop, whose control goes disabled with it.
    let onDeleted: () -> Void
    /// Moves focus to the screen, for when practice goes unavailable under a focused tool.
    let focusScreen: () -> Void
    let between: Between

    /// Held here rather than in the Pitch panel, which a mode change rebuilds, so a shift on a
    /// half semitone keeps the split it was given.
    @State private var pitchSplit: PitchSplit

    init(
        model: PracticeModel, isAvailable: Bool, onDeleted: @escaping () -> Void,
        focusScreen: @escaping () -> Void = {}, @ViewBuilder between: () -> Between
    ) {
        self.model = model
        self.isAvailable = isAvailable
        self.onDeleted = onDeleted
        self.focusScreen = focusScreen
        self.between = between()
        _pitchSplit = State(initialValue: PitchSplit(cents: model.pitchCents))
    }

    var body: some View {
        @Bindable var model = model
        ToolPanel(
            selection: $model.mode, tools: PracticeMode.allCases.map { tab($0) },
            isChanged: { tab($0).valueText != nil }, isAvailable: isAvailable, title: PracticeText.modes,
            open: $model.openTool, onOpenChange: { model.modeControlsShown($0 != nil) }, focusOutside: focusScreen
        ) { mode in
            panel(mode)
        } between: {
            between
        }
        .onChange(of: model.pitchCents) { pitchSplit.follow(model.pitchCents) }
    }

    private func tab(_ mode: PracticeMode) -> PaneTab<PracticeMode> {
        mode.tab(speedPercent: model.speedPercent, pitchCents: model.pitchCents, isolate: model.effectiveIsolate)
    }

    @ViewBuilder private func panel(_ mode: PracticeMode) -> some View {
        Group {
            switch mode {
            case .loops: LoopsPanel(model: model, onDeleted: onDeleted)
            case .speed: SpeedPanel(value: model.speedPercent, onChange: model.setSpeed)
            case .pitch: PitchPanel(value: model.pitchCents, split: $pitchSplit, onChange: model.setPitch)
            case .isolate: LiveIsolatePanel(model: model)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
