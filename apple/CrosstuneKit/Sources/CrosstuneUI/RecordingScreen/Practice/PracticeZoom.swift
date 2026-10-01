import Foundation

/// A stretch of time in ms, fractional where a zoom or a pointer puts it between whole ms.
struct TimeSpan: Equatable, Sendable {
    var startMs: Double
    var endMs: Double
}

/// What a zoom is held inside: the view's width in points and the trimmed recording's length.
struct ZoomFrame: Equatable, Sendable {
    var width: Double
    var lengthMs: Double
}

/// The zoomed view as a scale and the time at its center, both on the trimmed timeline. A scale
/// rather than a window, so a wider screen (a phone turned on its side) shows more seconds at
/// the same detail. Mirrors the web's `practiceZoom.ts`.
struct PracticeZoom: Equatable, Sendable {
    var pointsPerSecond: Double
    var centerMs: Double

    /// Four points for each 20 ms peak, past which the bars only repeat themselves.
    static let maxPointsPerSecond: Double = 200
    /// How much of the recording the view shows when there is no loop to fit.
    static let openingSpanMs: Double = 30_000
    /// The margin a fitted span keeps on each side, as a share of its length.
    static let fitMargin = 0.1

    private static func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
        min(max(value, low), high)
    }

    /// The scale at which the whole recording fills the view.
    static func minPointsPerSecond(width: Double, lengthMs: Double) -> Double {
        guard width > 0, lengthMs > 0 else { return maxPointsPerSecond }
        return min(maxPointsPerSecond, width / (lengthMs / 1000))
    }

    func visibleSpan(width: Double) -> TimeSpan {
        let half = width / pointsPerSecond * 1000 / 2
        return TimeSpan(startMs: centerMs - half, endMs: centerMs + half)
    }

    /// Held to the scale limits, with the view kept inside the recording.
    func clamped(to frame: ZoomFrame) -> PracticeZoom {
        let scale = Self.clamp(
            pointsPerSecond, Self.minPointsPerSecond(width: frame.width, lengthMs: frame.lengthMs),
            Self.maxPointsPerSecond)
        let half = frame.width / scale * 1000 / 2
        let center =
            half * 2 >= frame.lengthMs ? frame.lengthMs / 2 : Self.clamp(centerMs, half, frame.lengthMs - half)
        return PracticeZoom(pointsPerSecond: scale, centerMs: center)
    }

    /// Zooms by `factor`, keeping `anchorMs` at the same place on screen.
    func zoomed(by factor: Double, around anchorMs: Double, in frame: ZoomFrame) -> PracticeZoom {
        let scale = Self.clamp(
            pointsPerSecond * factor, Self.minPointsPerSecond(width: frame.width, lengthMs: frame.lengthMs),
            Self.maxPointsPerSecond)
        let applied = scale / pointsPerSecond
        return PracticeZoom(pointsPerSecond: scale, centerMs: anchorMs + (centerMs - anchorMs) / applied)
            .clamped(to: frame)
    }

    func panned(by deltaMs: Double, in frame: ZoomFrame) -> PracticeZoom {
        PracticeZoom(pointsPerSecond: pointsPerSecond, centerMs: centerMs + deltaMs).clamped(to: frame)
    }

    /// Frames `span` with a tenth of its length as margin on each side. Not clamped.
    static func fit(_ span: TimeSpan, width: Double) -> PracticeZoom {
        let length = span.endMs - span.startMs
        let shownMs = length * (1 + 2 * fitMargin)
        return PracticeZoom(
            pointsPerSecond: shownMs > 0 ? width / (shownMs / 1000) : maxPointsPerSecond,
            centerMs: span.startMs + length / 2)
    }

    /// Unchanged while the playhead is inside the view, so a repeating loop never moves the
    /// screen, or turned to the page that starts at the playhead once it leaves. Not clamped.
    func paged(toKeep playheadMs: Double, width: Double) -> PracticeZoom {
        let shown = visibleSpan(width: width)
        if playheadMs >= shown.startMs && playheadMs <= shown.endMs { return self }
        return PracticeZoom(pointsPerSecond: pointsPerSecond, centerMs: playheadMs + (shown.endMs - shown.startMs) / 2)
    }

    /// Where Practice opens: fitted to the selected loop, or 30 seconds around the playhead.
    static func opening(loop: TimeSpan?, playheadMs: Double, frame: ZoomFrame) -> PracticeZoom {
        if let loop { return fit(loop, width: frame.width).clamped(to: frame) }
        return PracticeZoom(pointsPerSecond: frame.width / (openingSpanMs / 1000), centerMs: playheadMs)
            .clamped(to: frame)
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
