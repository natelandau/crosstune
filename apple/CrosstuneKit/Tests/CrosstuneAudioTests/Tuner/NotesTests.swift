import Testing

@testable import CrosstuneAudio

extension Tuner {
    @Suite struct NotesTests {
        @Test func namesA440AsA4() {
            #expect(noteFor(frequency: 440, a4: 440) == Note(name: .a, octave: 4, cents: 0))
        }

        @Test func namesLowEAsE1() throws {
            let note = try #require(noteFor(frequency: 41.2034, a4: 440))

            #expect(note.name == .e)
            #expect(note.octave == 1)
            #expect(abs(note.cents) < 0.01)
        }

        @Test func usesSharps() {
            #expect(noteFor(frequency: 277.18, a4: 440)?.name == .cSharp)
            #expect(NoteName.cSharp.rawValue == "C\u{266F}")
        }

        @Test func followsTheReferencePitch() throws {
            #expect(noteFor(frequency: 442, a4: 442) == Note(name: .a, octave: 4, cents: 0))
            let note = try #require(noteFor(frequency: 440, a4: 442))
            #expect(abs(note.cents - -7.85) < 0.005)
        }

        @Test(arguments: [0, -440, .nan, .infinity])
        func namesNoNoteForAFrequencyThatIsNotOne(frequency: Double) {
            #expect(noteFor(frequency: frequency, a4: 440) == nil)
        }

        @Test(arguments: [
            (0.0, 1.0), (3, 1), (-3, 1), (6.5, 0.5), (-6.5, 0.5), (10, 0), (-10, 0), (20, 0), (-20, 0),
        ])
        func greensFromTheZoneEdgeToInTune(cents: Double, green: Double) {
            #expect(abs(inTuneFraction(cents: cents) - green) < 1e-12)
        }

        @Test(arguments: [
            (0.0, TuneStep.zone), (10, .zone), (-10, .zone), (10.1, .close), (-10.1, .close), (15, .close),
            (-15, .close), (15.1, .far), (-40, .far),
        ])
        func stepsAtTenAndFifteenCents(cents: Double, step: TuneStep) {
            #expect(tuneStep(cents: cents) == step)
        }

        @Test(arguments: [(3.04, 3.0), (3.05, 3.1), (-3.05, -3.0), (-3.06, -3.1), (7.66, 7.7)])
        func roundsToTheShownTenthAsTheWebDoes(cents: Double, rounded: Double) {
            #expect(abs(tenths(cents) - rounded) < 1e-12)
        }

        /// Each check judges the cents as shown, to a tenth.
        @Test func judgesTheShownTenth() {
            #expect(isInTune(cents: 3.04))
            #expect(tuneHint(cents: 3.04) == nil)
            #expect(inTuneFraction(cents: 3.04) == 1)
            #expect(!isInTune(cents: 3.05))
            #expect(tuneHint(cents: 3.05) == .sharp)
            #expect(inTuneFraction(cents: 3.05) < 1)
            #expect(isInTune(cents: -3.05))
            #expect(tuneHint(cents: -3.05) == nil)
            #expect(tuneStep(cents: 10.04) == .zone)
            #expect(tuneStep(cents: 15.04) == .close)
        }

        @Test(arguments: [(0.0, true), (3, true), (-3, true), (3.1, false), (-3.1, false)])
        func inTuneWithinThreeCents(cents: Double, inTune: Bool) {
            #expect(isInTune(cents: cents) == inTune)
        }

        @Test(arguments: [(-3.1, .flat), (3.1, .sharp), (0, nil), (-3, nil), (3, nil)] as [(Double, TuneHint?)])
        func hintsFlatAndSharp(cents: Double, hint: TuneHint?) {
            #expect(tuneHint(cents: cents) == hint)
        }
    }
}
