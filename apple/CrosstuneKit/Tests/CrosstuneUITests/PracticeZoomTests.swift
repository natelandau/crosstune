import Testing

@testable import CrosstuneUI

private let frame = ZoomFrame(width: 300, lengthMs: 180_000)

private func near(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) < 0.001
}

@Suite struct PracticeZoomTests {
    @Test func stopsZoomingOutWhereTheWholeRecordingFitsAndInAtFourPointsPerPeak() {
        #expect(near(PracticeZoom.minPointsPerSecond(width: 300, lengthMs: 180_000), 300.0 / 180))
        #expect(PracticeZoom.maxPointsPerSecond == 200)
        let out = PracticeZoom(pointsPerSecond: 10, centerMs: 90_000).zoomed(by: 1 / 100, around: 90_000, in: frame)
        #expect(near(out.pointsPerSecond, 300.0 / 180))
        #expect(out.visibleSpan(width: 300) == TimeSpan(startMs: 0, endMs: 180_000))
        let deep = PracticeZoom(pointsPerSecond: 150, centerMs: 90_000).zoomed(by: 10, around: 90_000, in: frame)
        #expect(deep.pointsPerSecond == PracticeZoom.maxPointsPerSecond)
    }

    @Test func keepsTheAnchorWhereItIsOnScreenWhileZooming() {
        let before = PracticeZoom(pointsPerSecond: 10, centerMs: 60_000)
        let anchorMs = 66_000.0
        let after = before.zoomed(by: 2, around: anchorMs, in: frame)
        func at(_ zoom: PracticeZoom) -> Double {
            (anchorMs - zoom.visibleSpan(width: 300).startMs) / 1000 * zoom.pointsPerSecond
        }
        #expect(after.pointsPerSecond == 20)
        #expect(near(at(after), at(before)))
    }

    @Test func fitsASpanWithATenthOfItsLengthAsMarginOnEachSide() {
        let fitted = PracticeZoom.fit(TimeSpan(startMs: 58_000, endMs: 111_000), width: 300)
        let shown = fitted.visibleSpan(width: 300)
        #expect(near(shown.startMs, 52_700))
        #expect(near(shown.endMs, 116_300))
        #expect(fitted.centerMs == 84_500)
    }

    @Test func keepsTheScaleAndTheCenterThroughAChangeOfWidthAsOnRotation() {
        let portrait = PracticeZoom(pointsPerSecond: 12, centerMs: 70_000).clamped(to: frame)
        let landscape = portrait.clamped(to: ZoomFrame(width: 700, lengthMs: 180_000))
        #expect(landscape == portrait)
        let wide = landscape.visibleSpan(width: 700)
        let narrow = portrait.visibleSpan(width: 300)
        #expect(wide.endMs - wide.startMs > narrow.endMs - narrow.startMs)
        #expect((wide.startMs + wide.endMs) / 2 == 70_000)
    }

    @Test func holdsTheViewInsideTheRecording() {
        #expect(
            PracticeZoom(pointsPerSecond: 10, centerMs: 1000).clamped(to: frame).visibleSpan(width: 300).startMs == 0)
        #expect(
            PracticeZoom(pointsPerSecond: 10, centerMs: 179_000).clamped(to: frame).visibleSpan(width: 300).endMs
                == 180_000)
        #expect(
            PracticeZoom(pointsPerSecond: 10, centerMs: 20_000).panned(by: -50_000, in: frame).visibleSpan(width: 300)
                .startMs == 0)
    }

    @Test func pagesOnlyOnceThePlayheadLeavesTheView() {
        let state = PracticeZoom(pointsPerSecond: 10, centerMs: 15_000)
        #expect(state.paged(toKeep: 20_000, width: 300) == state)
        #expect(state.paged(toKeep: 29_900, width: 300) == state)
        let paged = state.paged(toKeep: 30_100, width: 300)
        #expect(paged.visibleSpan(width: 300).startMs == 30_100)
        let back = paged.paged(toKeep: 2_000, width: 300)
        #expect(back.visibleSpan(width: 300).startMs == 2_000)
    }

    @Test func opensThirtySecondsAroundThePlayhead() {
        let opened = PracticeZoom.opening(loop: nil, playheadMs: 60_000, frame: frame)
        #expect(opened.visibleSpan(width: 300) == TimeSpan(startMs: 45_000, endMs: 75_000))
        #expect(
            PracticeZoom.opening(loop: nil, playheadMs: 0, frame: frame).visibleSpan(width: 300)
                == TimeSpan(startMs: 0, endMs: 30_000))
    }

    @Test func opensFittedToALoopWhenThereIsOne() {
        let loop = TimeSpan(startMs: 58_000, endMs: 111_000)
        #expect(PracticeZoom.opening(loop: loop, playheadMs: 0, frame: frame) == PracticeZoom.fit(loop, width: 300))
    }

    @Test func mapsSourceTimesToPointsAndBack() {
        let view = LaneView(startMs: 10_000, pointsPerSecond: 20, width: 300, trimStartMs: 1000)
        #expect(view.x(ofSourceMs: 12_000) == 20)
        #expect(view.sourceMs(atX: 20) == 12_000)
        #expect(view.endMs == 25_000)
    }
}
