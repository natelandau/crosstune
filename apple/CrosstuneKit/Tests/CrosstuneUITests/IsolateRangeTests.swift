import CrosstuneAudio
import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneUI

/// The range with `edge` moved by `delta` units, as an arrow press moves it.
private func step(
    _ bounds: IsolateRangeBounds, _ edge: LoopModel.Edge, by delta: Double, start: Int, end: Int
) -> IsolateSpan {
    bounds.placing(edge, at: bounds.unit(edge == .start ? start : end) + delta, start: start, end: end)
}

@Suite struct IsolateRangeTests {
    private let stereo = IsolateRangeBounds(min: -100, max: 100, scale: .linear, minSpan: 10)
    private let frequency = IsolateRangeBounds(min: 40, max: 16000, scale: .log, minSpan: 1.0 / 3)

    @Test func anEdgeStopsAtItsEndOfTheRange() {
        #expect(stereo.placing(.start, at: -150, start: -50, end: 50) == IsolateSpan(start: -100, end: 50))
        #expect(stereo.placing(.end, at: 180, start: -50, end: 50) == IsolateSpan(start: -50, end: 100))
        #expect(frequency.placing(.start, at: log2(10), start: 200, end: 4000) == IsolateSpan(start: 40, end: 4000))
        #expect(
            frequency.placing(.end, at: log2(40_000), start: 200, end: 4000) == IsolateSpan(start: 200, end: 16000))
    }

    @Test func anEdgeKeepsTheShortestSpanFromTheOther() {
        #expect(stereo.placing(.start, at: 45, start: -50, end: 50) == IsolateSpan(start: 40, end: 50))
        #expect(stereo.placing(.end, at: -80, start: -50, end: 50) == IsolateSpan(start: -50, end: -40))
        // A third of an octave up from 1 kHz rounds to 1260 Hz, just past the shortest span.
        #expect(
            frequency.placing(.end, at: log2(1000), start: 1000, end: 4000) == IsolateSpan(start: 1000, end: 1260))
        // A third of an octave down rounds to 794 Hz, a fraction inside it, so it steps one further.
        #expect(
            frequency.placing(.start, at: log2(1000), start: 200, end: 1000) == IsolateSpan(start: 793, end: 1000))
    }

    @Test func movingTheWholeRangeStopsAtEitherEnd() {
        #expect(stereo.shifting(start: -50, end: 50, by: 20) == IsolateSpan(start: -30, end: 70))
        #expect(stereo.shifting(start: -50, end: 50, by: 80) == IsolateSpan(start: 0, end: 100))
        #expect(stereo.shifting(start: -50, end: 50, by: -200) == IsolateSpan(start: -100, end: 0))
        #expect(frequency.shifting(start: 100, end: 400, by: -3) == IsolateSpan(start: 40, end: 160))
    }

    @Test func movingTheWholeRangeNeverLandsUnderTheShortestSpan() {
        // Each edge rounds on its own, so 1000 to 1260 shifted down lands at 993 to 1251, a hair
        // under a third of an octave, and the end steps one further out.
        #expect(frequency.shifting(start: 1000, end: 1260, by: -0.01) == IsolateSpan(start: 993, end: 1252))
        // At the top, the start steps down instead.
        #expect(frequency.shifting(start: 12700, end: 16000, by: 1) == IsolateSpan(start: 12699, end: 16000))
    }

    @Test func aNudgeMovesOneEdgeByAStep() {
        #expect(step(stereo, .start, by: 5, start: -100, end: 100) == IsolateSpan(start: -95, end: 100))
        #expect(step(stereo, .end, by: 20, start: -100, end: 100) == IsolateSpan(start: -100, end: 100))
        // A semitone up from 440 Hz.
        #expect(step(frequency, .start, by: 1.0 / 12, start: 440, end: 16000) == IsolateSpan(start: 466, end: 16000))
        #expect(step(frequency, .end, by: -1, start: 40, end: 16000) == IsolateSpan(start: 40, end: 8000))
    }

    @Test func thePanelStepsMatchTheWeb() {
        #expect(IsolatePanel.stereoSteps == IsolateRangeSteps(step: 5, largeStep: 20))
        #expect(IsolatePanel.frequencySteps == IsolateRangeSteps(step: 1.0 / 12, largeStep: 1))
        #expect(IsolatePanel.stereoBounds == stereo)
        #expect(IsolatePanel.frequencyBounds == frequency)
    }

    @Test func aMonoRecordingShowsTheNoticeInPlaceOfTheStereoRow() {
        func panel(isMono: Bool?) -> IsolatePanel {
            IsolatePanel(value: .standard, isMono: isMono, outline: { nil }, isLive: false, onChange: { _ in })
        }
        #expect(panel(isMono: true).showsMonoNotice)
        #expect(panel(isMono: false).showsMonoNotice == false)
        // Until the recording is measured, the stereo row shows.
        #expect(panel(isMono: nil).showsMonoNotice == false)
    }

    @Test func aLargeStepMovesAnEdgeByTheLargeStepWithinTheEndsAndTheShortestSpan() {
        let pan = IsolatePanel.stereoSteps
        let hz = IsolatePanel.frequencySteps
        #expect(
            step(stereo, .start, by: pan.delta(up: true, large: true), start: -100, end: 100)
                == IsolateSpan(start: -80, end: 100))
        #expect(
            step(stereo, .end, by: pan.delta(up: true, large: true), start: -100, end: 90)
                == IsolateSpan(start: -100, end: 100))
        #expect(
            step(stereo, .start, by: pan.delta(up: true, large: true), start: 0, end: 15)
                == IsolateSpan(start: 5, end: 15)
        )
        #expect(
            step(frequency, .start, by: hz.delta(up: true, large: true), start: 200, end: 16000)
                == IsolateSpan(start: 400, end: 16000))
        #expect(
            step(frequency, .start, by: hz.delta(up: false, large: true), start: 60, end: 16000)
                == IsolateSpan(start: 40, end: 16000))
        #expect(
            step(frequency, .end, by: hz.delta(up: false, large: true), start: 1000, end: 1500)
                == IsolateSpan(start: 1000, end: 1260))
        #expect(
            step(stereo, .start, by: pan.delta(up: false, large: false), start: 0, end: 50)
                == IsolateSpan(start: -5, end: 50))
    }

    @MainActor
    @Test func aPausedOutlineKeepsItsLastSoundAfterASeekClearsIt() {
        let cache = IsolateOutlineCache()
        #expect(cache.levels([0.2, 0.5], isLive: true) == [0.2, 0.5])
        #expect(cache.levels([0, 0], isLive: false) == [0.2, 0.5])
        #expect(cache.levels(nil, isLive: false) == [0.2, 0.5])
        // Playing, it shows the audio as it is, silence included.
        #expect(cache.levels([0, 0], isLive: true) == [0, 0])
        #expect(IsolateOutlineCache().levels(nil, isLive: false).isEmpty)
    }

    @Test @MainActor func theOutlineIsReadOncePerLiveTick() {
        let reader = IsolateOutlineReader()
        var reads = 0
        let read = { () -> IsolateOutline? in
            reads += 1
            return nil
        }
        let tick = Date(timeIntervalSinceReferenceDate: 0)
        _ = reader.outline(at: tick, isLive: true, read)
        _ = reader.outline(at: tick, isLive: true, read)
        #expect(reads == 1)
        _ = reader.outline(at: tick.addingTimeInterval(1.0 / 30), isLive: true, read)
        #expect(reads == 2)
        // Paused, each draw reads again, since the timeline's date stands still.
        _ = reader.outline(at: tick, isLive: false, read)
        _ = reader.outline(at: tick, isLive: false, read)
        #expect(reads == 4)
    }
}
