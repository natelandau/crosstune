import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// Playback speed with the pitch held: a slider in steps of 5% read from a stepper, Reset, and
/// presets. Each change goes to `onChange` at once.
struct SpeedPanel: View {
    let value: Int
    let onChange: (Int) -> Void

    static let step = 5
    static let presets = [50, 75, 100]
    private static let range = Vocabulary.Ranges.Recording.speedPercent

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ValueSlider(
                RecordingScreenText.speed,
                value: Binding {
                    value
                } set: {
                    if let speed = Self.moved(from: value, to: $0) { onChange(speed) }
                },
                in: Self.range, step: Self.step, defaultValue: 100, format: RecordingScreenText.speedBadge)
            presets
        }
    }

    #if os(macOS)
        private var presets: some View {
            MacSegmented(
                selection: Binding<Int?> {
                    Self.presets.contains(value) ? value : nil
                } set: {
                    if let preset = $0 { onChange(preset) }
                },
                options: Self.presets.map(Optional.some),
                label: { RecordingScreenText.speedBadge($0 ?? 100) },
                title: RecordingScreenText.speedPresets)
        }
    #else
        private var presets: some View {
            SpeedPresetRow(value: value, onChange: onChange)
        }
    #endif

    /// The speed a step or drag from `percent` to `next` sets, or nil when it sets none. A speed
    /// off the 5% grid steps onto it rather than keeping its offset.
    static func moved(from percent: Int, to next: Int) -> Int? {
        next == percent ? nil : stepped(percent, by: next - percent)
    }

    /// `percent` moved by `delta` and clamped to the range. A speed off the 5% grid lands on
    /// the nearest grid step in the direction of travel, so the first step from 72% is 70% or
    /// 75%, never 65%.
    static func stepped(_ percent: Int, by delta: Int) -> Int {
        let moved = Double(percent + delta) / Double(step)
        let snapped = Int(delta < 0 ? moved.rounded(.up) : moved.rounded(.down)) * step
        return clamped(snapped)
    }

    private static func clamped(_ percent: Int) -> Int {
        min(max(percent, range.lowerBound), range.upperBound)
    }
}

/// The iOS presets, wrapping at larger text sizes so no capsule is squeezed and no label breaks
/// inside itself. Compiles on every platform so a snapshot can draw it.
struct SpeedPresetRow: View {
    let value: Int
    let onChange: (Int) -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        FlowLayout(spacing: spacing.chipGap, lineSpacing: spacing(12)) {
            ForEach(SpeedPanel.presets, id: \.self) { preset in
                Chip(.choice(isChosen: value == preset)) {
                    onChange(preset)
                } label: {
                    Text(RecordingScreenText.speedBadge(preset)).monospacedDigit()
                }
            }
        }
        // A wrapped row is as wide as its longest line; without this the parent centers it.
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if os(macOS)
    /// A Mac practice panel's label row: its name in secondary text, with a quiet control such as
    /// Reset at the trailing end.
    struct PanelLabelRow<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack(spacing: 8) {
                Text(title)
                    .font(MacStyle.label)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                trailing
            }
            .frame(minHeight: MacStyle.smallControlHeight)
        }
    }

    /// A Mac practice panel's control row, under its label row: the stepper beside a slider
    /// that takes the rest of the width, with an optional value trailing the slider. Where the
    /// two show different units, as Pitch's semitones and cents do, a caption under each names it.
    struct PanelControlRow<Stepper: View, Slider: View, Accessory: View>: View {
        let stepperCaption: String?
        let sliderCaption: String?
        let stepper: Stepper
        let slider: Slider
        let accessory: Accessory

        init(
            stepperCaption: String? = nil, sliderCaption: String? = nil, @ViewBuilder stepper: () -> Stepper,
            @ViewBuilder slider: () -> Slider, @ViewBuilder accessory: () -> Accessory
        ) {
            self.stepperCaption = stepperCaption
            self.sliderCaption = sliderCaption
            self.stepper = stepper()
            self.slider = slider()
            self.accessory = accessory()
        }

        var body: some View {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                GridRow {
                    stepper
                    HStack(spacing: 16) {
                        slider
                        accessory
                    }
                }
                if stepperCaption != nil || sliderCaption != nil {
                    GridRow {
                        caption(stepperCaption)
                            .gridCellAnchor(.center)
                        caption(sliderCaption)
                    }
                }
            }
        }

        /// The controls carry these names for VoiceOver already.
        private func caption(_ text: String?) -> some View {
            Text(text ?? "")
                .font(MacStyle.secondary)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityHidden(true)
        }
    }
#endif
