import Foundation

/// Where a range's edges may go as `RangeHandles` moves them, in seconds from the recording's
/// start.
package enum RangeEdit {
    /// The start at `proposed`, at least `minimumLength` before `end` and never before 0.
    package static func start(_ proposed: Double, end: Double, minimumLength: Double) -> Double {
        max(0, min(proposed, end - minimumLength))
    }

    /// The end at `proposed`, at least `minimumLength` after `start` and never past `duration`.
    package static func end(_ proposed: Double, start: Double, minimumLength: Double, duration: Double) -> Double {
        min(duration, max(proposed, start + minimumLength))
    }

    /// The range moved whole by `delta`, stopping at 0 and at `duration` with its length kept.
    package static func moved(start: Double, end: Double, by delta: Double, duration: Double) -> (
        start: Double, end: Double
    ) {
        let by = min(max(delta, -start), duration - end)
        return (start + by, end + by)
    }

    /// The point in `points` nearest `time`, when one is within `within` of it.
    package static func snapped(_ time: Double, to points: [Double], within: Double) -> Double? {
        points
            .filter { abs($0 - time) <= within }
            .min { abs($0 - time) < abs($1 - time) }
    }

    /// Whether a drag from resting on `previous` to resting on `next` lands on a snap point it
    /// was not already on, so a drag that stays on one point is one snap.
    package static func enteredSnap(from previous: Double?, to next: Double?) -> Bool {
        next != nil && next != previous
    }

    /// An edge's time to a tenth of a second: "2:12.6".
    package static func bubbleText(_ seconds: Double) -> String {
        tenthsText(Int64((max(0, seconds) * 10).rounded()))
    }

    /// A count of tenths of a second as `m:ss.t`.
    package static func tenthsText(_ tenths: Int64) -> String {
        let seconds = tenths % 600 / 10
        return "\(tenths / 600):\(seconds < 10 ? "0" : "")\(seconds).\(tenths % 10)"
    }

    /// How far into the scroll zone at either side a finger at `x` sits: 0 outside it, toward
    /// -1 at the leading side and 1 at the trailing side, so the waveform scrolls faster deeper in.
    package static func edgeScrollDepth(atX x: Double, width: Double, zone: Double) -> Double {
        guard width > 0, zone > 0 else { return 0 }
        if x < zone { return -(zone - max(0, x)) / zone }
        if x > width - zone { return (zone - max(0, width - x)) / zone }
        return 0
    }

    /// How far an edge's press target reaches, in points, outside the span and into it. The
    /// inner reach takes at most a third of a narrow span, so its middle still moves the span.
    package static func handleReach(span: Double, target: Double, tabWidth: Double) -> (
        outer: Double, inner: Double
    ) {
        (max(target / 2, tabWidth), max(0, min(target / 2, span / 3)))
    }

    /// The span drawn `progress` of the way from its place to a point at its center.
    package static func closing(start: Double, end: Double, progress: Double) -> (start: Double, end: Double) {
        let center = (start + end) / 2
        return (start + (center - start) * progress, end + (center - end) * progress)
    }

    /// Where a new span opens from: the playhead, or with none, the span's center; never
    /// outside the recording.
    package static func insertAnchor(playhead: Double?, start: Double, end: Double, duration: Double) -> Double {
        min(max(playhead ?? (start + end) / 2, 0), duration)
    }

    /// The span drawn `progress` of the way from a point at `anchor` to its place.
    package static func opening(start: Double, end: Double, from anchor: Double, progress: Double) -> (
        start: Double, end: Double
    ) {
        (anchor + (start - anchor) * progress, anchor + (end - anchor) * progress)
    }
}

/// A run of held arrow-key steps on a range. Each step moves the span at once; the run commits
/// once, where the last step left it, when the key is let go or focus moves on.
package struct RangeKeySteps {
    private var last: (start: Double, end: Double)?

    package init() {}

    /// A step moved the span to `start` and `end`.
    package mutating func stepped(start: Double, end: Double) {
        last = (start, end)
    }

    /// Ends the run: the span to commit, or nil when no step is waiting.
    package mutating func end() -> (start: Double, end: Double)? {
        defer { last = nil }
        return last
    }
}
