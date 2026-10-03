import CrosstuneStore
import Foundation

/// What a zoom is held inside: the view's width in points and the trimmed recording's length.
struct ZoomFrame: Equatable, Sendable {
    var width: Double
    var lengthMs: Double
}

/// The zoom as a scale in points per second, around a playhead that is always the view's
/// center. A scale rather than a window, so a wider screen (a phone turned on its side) shows
/// more seconds at the same detail. Mirrors the web's `practiceZoom.ts`.
enum PracticeZoom {
    /// Four points for each 20 ms peak, past which the bars only repeat themselves.
    static let maxPointsPerSecond: Double = 200
    /// How much of the recording the view shows when there is no loop to fit.
    static let openingSpanMs: Double = 30_000
    /// The margin a fitted span keeps on each side, as a share of its length.
    static let fitMargin = 0.1

    /// The time constant of the exponential decay a released drag coasts on.
    static let glideTauMs: Double = 325

    private static func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
        min(max(value, low), high)
    }

    /// The scale at which the whole recording fills the view.
    static func minPointsPerSecond(width: Double, lengthMs: Double) -> Double {
        guard width > 0, lengthMs > 0 else { return maxPointsPerSecond }
        return min(maxPointsPerSecond, width / (lengthMs / 1000))
    }

    /// The playhead's new position after dragging `dx` points; dragging right moves back in time.
    static func scrub(from: Int64, dx: Double, pointsPerSecond: Double, lengthMs: Int64) -> Int64 {
        let moved = Double(from) - dx / pointsPerSecond * 1000
        return min(max(Int64(moved.rounded()), 0), lengthMs)
    }

    /// The distance in ms a release at `velocity` points per second still travels.
    static func glide(velocity: Double, pointsPerSecond: Double) -> Int64 {
        Int64((-velocity * glideTauMs / pointsPerSecond).rounded())
    }

    /// A view centered on `centerMs`, never clamped, so the ends of the recording show blank.
    static func view(pointsPerSecond: Double, centerMs: Int64, width: Double, trimStartMs: Int64) -> LaneView {
        LaneView(
            startMs: Double(centerMs) - width / 2 / pointsPerSecond * 1000, pointsPerSecond: pointsPerSecond,
            width: width, trimStartMs: trimStartMs)
    }

    /// The scale that frames `span` around a centered playhead at `playheadMs` (source timeline),
    /// with the fit margin past its farther end. A playhead outside the span is taken at the
    /// span's start, where Fit moves it. Held to the maximum scale; the caller applies the minimum.
    static func fitScale(span: LoopSpan, playheadMs: Int64, width: Double) -> Double {
        let at = playheadMs >= span.startMs && playheadMs < span.endMs ? playheadMs : span.startMs
        let reachMs = Double(max(at - span.startMs, span.endMs - at)) + fitMargin * Double(span.endMs - span.startMs)
        guard reachMs > 0 else { return maxPointsPerSecond }
        return clamp(width / 2 / (reachMs / 1000), 0, maxPointsPerSecond)
    }

    /// Where the recording screen opens: as Fit frames the selected loop, or 30 seconds across
    /// the view.
    static func openingScale(loop: LoopSpan?, playheadMs: Int64, width: Double) -> Double {
        if let loop { return fitScale(span: loop, playheadMs: playheadMs, width: width) }
        return width / (openingSpanMs / 1000)
    }

    /// `pointsPerSecond` times `factor`, held to the scale limits.
    static func zoomScale(_ pointsPerSecond: Double, by factor: Double, frame: ZoomFrame) -> Double {
        clamp(
            pointsPerSecond * factor, minPointsPerSecond(width: frame.width, lengthMs: frame.lengthMs),
            maxPointsPerSecond)
    }
}

/// Where the zoomed view sits, for mapping between the source timeline and its points.
struct LaneView: Equatable, Sendable {
    /// The view's left edge, on the trimmed timeline.
    var startMs: Double
    var pointsPerSecond: Double
    var width: Double
    /// Where the trimmed timeline starts on the source timeline.
    var trimStartMs: Int64

    /// The view's right edge, on the trimmed timeline.
    var endMs: Double { startMs + width / pointsPerSecond * 1000 }

    func x(ofSourceMs sourceMs: Double) -> Double {
        (sourceMs - Double(trimStartMs) - startMs) / 1000 * pointsPerSecond
    }

    func sourceMs(atX x: Double) -> Double {
        Double(trimStartMs) + startMs + x / pointsPerSecond * 1000
    }
}
