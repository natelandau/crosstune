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
