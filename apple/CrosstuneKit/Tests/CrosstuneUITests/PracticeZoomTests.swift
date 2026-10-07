import CrosstuneStore
import Foundation
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

    @Test func aGlideEasesOutOnItsDecayAndLandsOnItsTarget() {
        func at(_ elapsedMs: Double) -> Int64 {
            PracticeZoom.glidePosition(from: 1000, to: 11_000, elapsedMs: elapsedMs, runMs: 900)
        }
        #expect(at(0) == 1000)
        // One time constant in, a third of the run: (1 - e^-1) / (1 - e^-3) of the way.
        #expect(at(300) == 1000 + Int64((10_000 * (1 - exp(-1.0)) / (1 - exp(-3.0))).rounded()))
        #expect(at(899) < 11_000)
        #expect(at(900) == 11_000)
        #expect(at(5000) == 11_000)
        let steps = stride(from: 0.0, through: 900, by: 50).map(at)
        #expect(zip(steps, steps.dropFirst()).allSatisfy { $0 < $1 })
        // Each step covers less than the one before.
        let moves = zip(steps, steps.dropFirst()).map { $1 - $0 }
        #expect(zip(moves, moves.dropFirst()).allSatisfy { $0 >= $1 })
    }

    @Test func aGlideBackwardMirrorsOneForward() {
        let forward = PracticeZoom.glidePosition(from: 0, to: 6000, elapsedMs: 200, runMs: 975)
        let backward = PracticeZoom.glidePosition(from: 6000, to: 0, elapsedMs: 200, runMs: 975)
        #expect(forward + backward == 6000)
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
