import CrosstuneAudio
import SwiftUI
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct TunerScreenTests {
    private static func a4(cents: Double) -> Note { Note(name: .a, octave: 4, cents: cents) }

    private static func reading(_ name: NoteName, cents: Double, atMs: Double) -> Reading {
        Reading(frequency: 440, note: Note(name: name, octave: 4, cents: cents), atMs: atMs)
    }

    @Test(arguments: [
        (-3.4, "A4, 3 cents flat"), (0.4, "A4, in tune"), (7.6, "A4, 8 cents sharp"), (3.04, "A4, in tune"),
        (3.05, "A4, 3 cents sharp"),
    ])
    func spokenReadingMatchesTheWeb(cents: Double, spoken: String) {
        #expect(TunerText.spokenReading(Self.a4(cents: cents)) == spoken)
    }

    @Test(arguments: [(ScenePhase.active, true), (.inactive, true), (.background, false)])
    func listensUntilTheSceneGoesToTheBackground(phase: ScenePhase, listens: Bool) {
        #expect(TunerScreen.listens(in: phase) == listens)
    }

    @Test func referenceLabelShowsOnlyOff440() {
        #expect(TunerText.referenceLabel(440) == nil)
        #expect(TunerText.referenceLabel(442) == "A4 = 442 Hz")
    }

    @Test(
        arguments: [(-4.0, TunerText.flat), (4, TunerText.sharp), (3, nil), (3.04, nil), (3.05, TunerText.sharp)]
            as [(Double, String?)])
    func hintLabelNamesTheSide(cents: Double, label: String?) {
        #expect(TunerText.hintLabel(cents: cents) == label)
    }

    @Test(arguments: [(-3.44, "\u{2212}3.4¢"), (7.66, "+7.7¢"), (0, "+0.0¢"), (-0.04, "+0.0¢")])
    func centsLabelSignsTheTenths(cents: Double, label: String) {
        #expect(TunerText.centsLabel(cents) == label)
    }

    @Test func barOffsetClampsAtFiftyCents() {
        #expect(TunerBars.barOffset(cents: 0, height: 100) == 0)
        #expect(TunerBars.barOffset(cents: 25, height: 100) == -20)
        #expect(TunerBars.barOffset(cents: -50, height: 100) == 40)
        #expect(TunerBars.barOffset(cents: 80, height: 100) == -40)
        #expect(TunerBars.barOffset(cents: -80, height: 100) == 40)
    }

    @Test(arguments: [(375.0, 75.0), (320, 64), (280, 44), (1000, 160), (800, 160), (150, 0)] as [(CGFloat, CGFloat)])
    func barWidthIsAFifthAndStopsShortOfTheNote(stage: CGFloat, width: CGFloat) {
        #expect(TunerBars.barWidth(stageWidth: stage) == width)
    }

    @Test func zoneSpansTenCentsEitherWayOfTravel() {
        #expect(abs(TunerBars.zoneHeight / 2 * 100 + TunerBars.barOffset(cents: 10, height: 100)) < 1e-9)
    }

    @Test func announcesOnlyANewNoteOrTuningAtMostOnceASecond() {
        var announcer = TunerAnnouncer()
        #expect(announcer.next(Self.reading(.a, cents: -8, atMs: 0)) == "A4, 8 cents flat")
        // The same note and side of in tune stays quiet however far it drifts.
        #expect(announcer.next(Self.reading(.a, cents: -12, atMs: 1500)) == nil)
        #expect(announcer.next(Self.reading(.b, cents: 1, atMs: 1600)) == "B4, in tune")
        // A change inside a second of the last announcement waits.
        #expect(announcer.next(Self.reading(.a, cents: 1, atMs: 2100)) == nil)
        #expect(announcer.next(Self.reading(.a, cents: 1, atMs: 2600)) == "A4, in tune")
    }

    @Test func announcerRestartsWithTheInputsClock() {
        var announcer = TunerAnnouncer()
        _ = announcer.next(Self.reading(.a, cents: 0, atMs: 5000))
        #expect(announcer.next(Self.reading(.b, cents: 0, atMs: 100)) == "B4, in tune")
    }
}
