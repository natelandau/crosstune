import CrosstuneVocabulary
import SwiftUI

/// Playback speed with the pitch held: a slider in steps of 5%, slower and faster, presets,
/// and Reset. Each change goes to `onChange` at once.
struct SpeedPanel: View {
    let value: Int
    let onChange: (Int) -> Void

    static let step = 5
    static let presets = [50, 75, 100]
    private static let range = Vocabulary.Ranges.Recording.speedPercent

    var body: some View {
        #if os(macOS)
            macBody
        #else
            VStack(spacing: 12) {
                HStack {
                    Text(RecordingScreenText.speed)
                    Spacer()
                    Text(RecordingScreenText.speedBadge(value))
                        .monospacedDigit()
                }
                .font(.platform(.subheadline))
                .accessibilityHidden(true)
                HStack(spacing: 12) {
                    PanelStepButton(name: RecordingScreenText.slower, systemImage: "minus") { step(by: -Self.step) }
                        .disabled(value <= Self.range.lowerBound)
                    Slider(
                        value: Binding {
                            Double(value)
                        } set: {
                            onChange(Self.clamped(Int($0.rounded())))
                        },
                        in: Double(Self.range.lowerBound)...Double(Self.range.upperBound),
                        step: Double(Self.step)
                    )
                    .accessibilityLabel(RecordingScreenText.speed)
                    .accessibilityValue(RecordingScreenText.speedBadge(value))
                    PanelStepButton(name: RecordingScreenText.faster, systemImage: "plus") { step(by: Self.step) }
                        .disabled(value >= Self.range.upperBound)
                }
                SpeedPresetRow(value: value, onChange: onChange)
            }
        #endif
    }

    #if os(macOS)
        /// The label row with Reset, the control row's stepper beside a slider held to the 5%
        /// grid with a detent at normal speed, and the presets.
        private var macBody: some View {
            VStack(alignment: .leading, spacing: 12) {
                PanelLabelRow(title: RecordingScreenText.speed) {
                    Button(RecordingScreenText.reset) { onChange(100) }
                        .buttonStyle(.mac(.plain, size: .small))
                        .disabled(value == 100)
                }
                PanelControlRow {
                    MacStepper(
                        value: RecordingScreenText.speedBadge(value), decrement: { step(by: -Self.step) },
                        increment: { step(by: Self.step) }, canDecrement: value > Self.range.lowerBound,
                        canIncrement: value < Self.range.upperBound, accessibilityLabel: RecordingScreenText.speed)
                } slider: {
                    MacSlider(
                        value: Binding {
                            Double(value)
                        } set: {
                            onChange(Self.clamped(Int(($0 / Double(Self.step)).rounded()) * Self.step))
                        },
                        in: Double(Self.range.lowerBound)...Double(Self.range.upperBound), detent: 100,
                        accessibilityLabel: RecordingScreenText.speed, step: Double(Self.step),
                        accessibilityValue: RecordingScreenText.speedBadge(value)
                    )
                    // The stepper beside it is the same control for VoiceOver.
                    .accessibilityHidden(true)
                } accessory: {
                    EmptyView()
                }
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
        }
    #endif

    private func step(by delta: Int) {
        onChange(Self.stepped(value, by: delta))
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

/// The iOS presets and Reset. One line while it fits, with Reset trailing; at larger text sizes
/// the whole row wraps, so no capsule is squeezed and no label breaks inside itself. Compiles on
/// every platform so a snapshot can draw it.
struct SpeedPresetRow: View {
    let value: Int
    let onChange: (Int) -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        // ViewThatFits picks the first layout whose ideal size fits, so the single line keeps
        // Reset at the trailing edge, which a flow layout cannot.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: spacing.railGap) {
                presets
                Spacer(minLength: 0)
                reset
            }
            FlowLayout(spacing: spacing.railGap, lineSpacing: spacing(12)) {
                presets
                reset
            }
        }
        // A wrapped row is as wide as its longest line; without this the parent centers it.
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var presets: some View {
        ForEach(SpeedPanel.presets, id: \.self) { preset in
            ChoiceCapsule(chosen: value == preset) {
                onChange(preset)
            } label: {
                Text(RecordingScreenText.speedBadge(preset)).monospacedDigit()
            }
        }
    }

    private var reset: some View {
        Button(RecordingScreenText.reset) { onChange(100) }
            .disabled(value == 100)
            .frame(minHeight: PracticeLayout.target)
    }
}

#if os(macOS)
    /// A Mac practice panel's label row: its name in secondary ink, with a quiet control such as
    /// Reset at the trailing end.
    struct PanelLabelRow<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack(spacing: 8) {
                Text(title)
                    .font(MacStyle.label)
                    .foregroundStyle(Palette.inkSecondary)
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
                .foregroundStyle(Palette.inkSecondary)
                .accessibilityHidden(true)
        }
    }
#endif

#if !os(macOS)
    /// A minus or plus beside a panel's slider or count, round with a 44 point target.
    struct PanelStepButton: View {
        let name: String
        let systemImage: String
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
                    .font(.platform(.body).weight(.semibold))
                    .frame(width: minimumTapTarget, height: minimumTapTarget)
                    .background(.neutralFill, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .help(name)
        }
    }
#endif
