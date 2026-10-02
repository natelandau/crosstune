import CrosstuneStore
import Testing

@testable import CrosstuneUI

private func near(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) < 0.001
}

@Suite struct PracticeZoomTests {
    @Test(arguments: [
        (Int64(10_000), 100.0, Int64(9000)),
        (500, 100.0, 0),
        (59_500, -100.0, 60_000),
    ])
    func scrub(_ from: Int64, _ dx: Double, _ expected: Int64) {
        #expect(PracticeZoom.scrub(from: from, dx: dx, pointsPerSecond: 100, lengthMs: 60_000) == expected)
    }

    @Test func glideTravelsAgainstTheVelocity() {
        #expect(PracticeZoom.glideTauMs == 325)
        #expect(PracticeZoom.glide(velocity: 1000, pointsPerSecond: 100) == -3250)
    }

    @Test(arguments: [(Int64(5000), 0.0), (0, -5000.0)])
    func viewCentersWithoutClamping(_ center: Int64, _ expectedStart: Double) {
        let view = PracticeZoom.view(pointsPerSecond: 100, centerMs: center, width: 1000, trimStartMs: 1000)
        #expect(view == LaneView(startMs: expectedStart, pointsPerSecond: 100, width: 1000, trimStartMs: 1000))
    }

    @Test func minimumScaleFitsTheRecording() {
        #expect(near(PracticeZoom.minPointsPerSecond(width: 1000, lengthMs: 120_000), 1000.0 / 120))
    }

    // Shared with practiceZoom.test.ts; keep the two tables equal.
    @Test(arguments: [
        (Int64(0), Int64(10_000), Int64(5000), 83.3333),
        (0, 10_000, 0, 45.4545),
        (0, 10_000, 9000, 50),
        (0, 10_000, 10_000, 45.4545),
        (0, 10_000, 20_000, 45.4545),
        (0, 600, 300, 200),
    ])
    func fitScale(_ startMs: Int64, _ endMs: Int64, _ playheadMs: Int64, _ expected: Double) {
        let span = LoopSpan(startMs: startMs, endMs: endMs)
        #expect(near(PracticeZoom.fitScale(span: span, playheadMs: playheadMs, width: 1000), expected))
    }

    @Test func openingScaleFramesALoopAsFitDoesOrThirtySeconds() {
        #expect(near(PracticeZoom.openingScale(loop: nil, playheadMs: 0, width: 1000), 1000.0 / 30))
        let loop = LoopSpan(startMs: 0, endMs: 10_000)
        #expect(near(PracticeZoom.openingScale(loop: loop, playheadMs: 5000, width: 1000), 500.0 / 6))
        #expect(near(PracticeZoom.openingScale(loop: loop, playheadMs: 0, width: 1000), 500.0 / 11))
    }

    @Test(arguments: [(100.0, 4.0, 200.0), (10.0, 0.5, 1000.0 / 120)])
    func zoomScale(_ scale: Double, _ factor: Double, _ expected: Double) {
        let frame = ZoomFrame(width: 1000, lengthMs: 120_000)
        #expect(near(PracticeZoom.zoomScale(scale, by: factor, frame: frame), expected))
    }

    @Test func mapsSourceTimesToPointsAndBack() {
        let view = LaneView(startMs: 10_000, pointsPerSecond: 20, width: 300, trimStartMs: 1000)
        #expect(view.x(ofSourceMs: 12_000) == 20)
        #expect(view.sourceMs(atX: 20) == 12_000)
        #expect(view.endMs == 25_000)
    }
}
