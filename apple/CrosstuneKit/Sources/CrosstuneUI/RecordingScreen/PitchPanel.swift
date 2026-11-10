import CrosstuneDesign
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

/// Pitch shift with the speed held: a semitone stepper, a cents slider, and Reset, which clears
/// both. Each change goes to `onChange` at once. The split lives with the caller, so it survives
/// the panel being rebuilt; the caller follows `value` into it as the pitch changes elsewhere.
struct PitchPanel: View {
    let value: Int
    @Binding var split: PitchSplit
    let onChange: (Int) -> Void

    /// The semitone stepper, then the cents slider, whose Reset clears the whole shift.
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ValueLabelLine(RecordingScreenText.semitones) {
                ValueStepper(
                    RecordingScreenText.semitones,
                    value: Binding {
                        split.semitones
                    } set: {
                        choose(split.with(semitones: $0))
                    },
                    in: PitchSplit.semitoneRange, format: Self.signed)
            }
            ValueSlider(
                RecordingScreenText.cents,
                value: Binding {
                    split.cents
                } set: {
                    choose(split.with(cents: $0))
                },
                in: PitchSplit.centsRange, step: 1, defaultValue: 0, canReset: value != 0,
                onReset: { choose(PitchSplit(cents: 0)) }, format: Self.signed)
        }
    }

    private func choose(_ next: PitchSplit) {
        split = next
        if next.value != value { onChange(next.value) }
    }

    static func signed(_ number: Int) -> String {
        number > 0 ? "+\(number)" : "\(number)"
    }
}
