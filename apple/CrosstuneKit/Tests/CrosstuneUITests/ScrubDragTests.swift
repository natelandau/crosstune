import Testing

@testable import CrosstuneDesign

struct ScrubDragTests {
    @Test func aTouchNeverJumps() {
        #expect(ScrubDrag.position(from: 42, dx: 0, dy: 0, width: 300, duration: 195) == 42)
    }

    @Test func dragMovesWithTheFinger() {
        #expect(ScrubDrag.position(from: 0, dx: 150, dy: 0, width: 300, duration: 195) == 97.5)
    }

    @Test func slidingDownSlowsTheScrub() {
        #expect(ScrubDrag.rate(verticalDistance: 20) == 1)
        #expect(ScrubDrag.rate(verticalDistance: 60) == 0.5)
        #expect(ScrubDrag.rate(verticalDistance: 120) == 0.25)
    }

    @Test func remainingCarriesAMinusSign() {
        #expect(ScrubDrag.remainingText(42, duration: 195) == "\u{2212}2:33")
    }

    @Test func theDragStaysInsideTheRecording() {
        #expect(ScrubDrag.position(from: 190, dx: 300, dy: 0, width: 300, duration: 195) == 195)
        #expect(ScrubDrag.position(from: 5, dx: -300, dy: 0, width: 300, duration: 195) == 0)
    }

    @Test func crossingARateBoundaryWithoutMovingKeepsThePosition() {
        var drag = ScrubDrag.Tracker(start: 0)
        let reached = drag.move(dx: 150, dy: 0, width: 300, duration: 195)
        #expect(drag.move(dx: 150, dy: 60, width: 300, duration: 195) == reached)
        #expect(drag.move(dx: 150, dy: 120, width: 300, duration: 195) == reached)
    }

    @Test func slowerTravelAddsToWhatWasAlreadyMade() {
        var drag = ScrubDrag.Tracker(start: 0)
        drag.move(dx: 150, dy: 0, width: 300, duration: 195)
        #expect(drag.move(dx: 180, dy: 120, width: 300, duration: 195) == 97.5 + 0.25 * 19.5)
    }

    @Test func clockTextCountsHours() {
        #expect(ScrubDrag.clockText(3661) == "1:01:01")
        #expect(ScrubDrag.clockText(42) == "0:42")
    }

    @Test func clockTextCountsWholeSecondsReachedAndNeverBelowZero() {
        #expect(ScrubDrag.clockText(0) == "0:00")
        #expect(ScrubDrag.clockText(61.9) == "1:01")
        #expect(ScrubDrag.clockText(-3) == "0:00")
    }

    @Test func remainingRoundsUpAndReachesZeroAtTheEnd() {
        #expect(ScrubDrag.remainingText(60.2, duration: 184) == "\u{2212}2:04")
        #expect(ScrubDrag.remainingText(184, duration: 184) == "\u{2212}0:00")
    }

    @Test func aKeyStepClampsAtTheEnds() {
        #expect(ScrubDrag.keyStepped(60, by: PlaybackScrubber.keyStep, duration: 195) == 60 + PlaybackScrubber.keyStep)
        #expect(ScrubDrag.keyStepped(0.5, by: -PlaybackScrubber.keyStep, duration: 195) == 0)
        #expect(ScrubDrag.keyStepped(194.5, by: PlaybackScrubber.keyStep, duration: 195) == 195)
    }

    @Test func aKeyStepWithAnUnknownLengthNeverSeeks() {
        #expect(ScrubDrag.keyStepped(42, by: PlaybackScrubber.keyStep, duration: 0) == nil)
        #expect(ScrubDrag.keyStepped(42, by: -PlaybackScrubber.keyStep, duration: 0) == nil)
    }

    @Test func steppingStaysInsideTheRecording() {
        #expect(ScrubDrag.stepped(60, by: 5, duration: 195) == 65)
        #expect(ScrubDrag.stepped(2, by: -5, duration: 195) == 0)
        #expect(ScrubDrag.stepped(193, by: 5, duration: 195) == 195)
    }
}
