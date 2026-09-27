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
        VStack(spacing: 12) {
            HStack {
                Text(RecordingScreenText.speed)
                Spacer()
                Text(RecordingScreenText.speedBadge(value))
                    .monospacedDigit()
            }
            .font(.subheadline)
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
            HStack(spacing: 8) {
                ForEach(Self.presets, id: \.self) { preset in
                    ChoiceCapsule(chosen: value == preset) {
                        onChange(preset)
                    } label: {
                        Text(RecordingScreenText.speedBadge(preset)).monospacedDigit()
                    }
                }
                Spacer(minLength: 0)
                Button(RecordingScreenText.reset) { onChange(100) }
                    .disabled(value == 100)
                    .frame(minHeight: 44)
            }
        }
    }

    /// A stored speed off the 5% grid steps onto it rather than keeping its odd offset.
    private func step(by delta: Int) {
        let onGrid = Int((Double(value) / Double(Self.step)).rounded()) * Self.step
        onChange(Self.clamped(onGrid + delta))
    }

    private static func clamped(_ percent: Int) -> Int {
        min(max(percent, range.lowerBound), range.upperBound)
    }
}

/// A round minus or plus beside a panel's slider or count, a 44 point target.
struct PanelStepButton: View {
    let name: String
    let systemImage: String
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            Label(name, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(neutralFill(colorScheme), in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .help(name)
    }
}
