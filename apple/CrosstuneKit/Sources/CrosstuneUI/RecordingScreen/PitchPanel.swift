import CrosstuneVocabulary
import SwiftUI

/// A pitch shift in cents shown as whole semitones and the cents beyond them. A shift on a half
/// semitone splits two ways (+2 and +50, or +3 and -50), so a split keeps the semitones it was
/// given and splits afresh only for a shift from elsewhere.
struct PitchSplit: Equatable {
    static let semitoneRange = -12...12
    static let centsRange = -50...50
    private static let range = Vocabulary.Ranges.Recording.pitchCents

    private(set) var value: Int
    private(set) var semitones: Int
    var cents: Int { value - semitones * 100 }

    /// Splits `cents` to the nearest semitone, a half going toward zero.
    init(cents value: Int) {
        self.value = value
        let whole = (abs(value) + 49) / 100
        semitones = value < 0 ? -whole : whole
    }

    /// Splits afresh when `value` is not the one this split holds.
    mutating func follow(_ value: Int) {
        guard value != self.value else { return }
        self = PitchSplit(cents: value)
    }

    func with(semitones: Int) -> PitchSplit {
        combined(semitones, cents)
    }

    func with(cents: Int) -> PitchSplit {
        combined(semitones, cents)
    }

    private func combined(_ semitones: Int, _ cents: Int) -> PitchSplit {
        let whole = min(max(semitones, Self.semitoneRange.lowerBound), Self.semitoneRange.upperBound)
        let part = min(max(cents, Self.centsRange.lowerBound), Self.centsRange.upperBound)
        let value = min(max(whole * 100 + part, Self.range.lowerBound), Self.range.upperBound)
        var split = PitchSplit(cents: value)
        // A clamped value keeps the chosen semitones only while its cents stay in range.
        if abs(value - whole * 100) <= Self.centsRange.upperBound { split.semitones = whole }
        return split
    }
}

/// Pitch shift with the speed held: a semitone stepper, a cents slider, and Reset. Each change
/// goes to `onChange` at once.
struct PitchPanel: View {
    let value: Int
    let onChange: (Int) -> Void

    @State private var split: PitchSplit

    init(value: Int, onChange: @escaping (Int) -> Void) {
        self.value = value
        self.onChange = onChange
        _split = State(initialValue: PitchSplit(cents: value))
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Text(RecordingScreenText.semitones)
                    .font(.subheadline)
                Spacer()
                PanelStepButton(name: RecordingScreenText.pitchDown, systemImage: "minus") {
                    choose(split.with(semitones: split.semitones - 1))
                }
                .disabled(split.semitones <= PitchSplit.semitoneRange.lowerBound)
                Text(Self.signed(split.semitones))
                    .font(.headline)
                    .monospacedDigit()
                    .frame(minWidth: 40)
                    .accessibilityLabel(RecordingScreenText.semitones)
                    .accessibilityValue(Self.signed(split.semitones))
                PanelStepButton(name: RecordingScreenText.pitchUp, systemImage: "plus") {
                    choose(split.with(semitones: split.semitones + 1))
                }
                .disabled(split.semitones >= PitchSplit.semitoneRange.upperBound)
            }
            HStack {
                Text(RecordingScreenText.cents)
                Spacer()
                Text(Self.signed(split.cents))
                    .monospacedDigit()
            }
            .font(.subheadline)
            .accessibilityHidden(true)
            Slider(
                value: Binding {
                    Double(split.cents)
                } set: {
                    choose(split.with(cents: Int($0.rounded())))
                },
                in: Double(PitchSplit.centsRange.lowerBound)...Double(PitchSplit.centsRange.upperBound),
                step: 1
            )
            .accessibilityLabel(RecordingScreenText.cents)
            .accessibilityValue(Self.signed(split.cents))
            HStack {
                Spacer()
                Button(RecordingScreenText.reset) { choose(PitchSplit(cents: 0)) }
                    .disabled(value == 0)
                    .frame(minHeight: PracticeLayout.target)
            }
        }
        .onChange(of: value) { split.follow(value) }
    }

    private func choose(_ next: PitchSplit) {
        split = next
        if next.value != value { onChange(next.value) }
    }

    static func signed(_ number: Int) -> String {
        number > 0 ? "+\(number)" : "\(number)"
    }
}
