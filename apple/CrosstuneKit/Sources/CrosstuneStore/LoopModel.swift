import Foundation

/// A stretch of a recording, in source milliseconds.
public struct LoopSpan: Equatable, Sendable {
    public var startMs: Int64
    public var endMs: Int64

    public init(startMs: Int64, endMs: Int64) {
        self.startMs = startMs
        self.endMs = endMs
    }
}

/// A loop as the timeline places it.
public struct PlacedLoop: Equatable, Sendable {
    public let id: String
    public var span: LoopSpan
    public var color: Int

    public init(id: String, span: LoopSpan, color: Int) {
        self.id = id
        self.span = span
        self.color = color
    }
}

/// Loop geometry and naming rules. Mirrors the web's `loopModel.ts`.
public enum LoopModel {
    public static let minLoopMs: Int64 = 500
    public static let maxLoops = 100
    public static let colorCount = 6
    public static let snapPoints: Double = 8
    public static let dragThreshold: Double = 8
    /// Padding on each side of the playhead for a new loop.
    public static let newLoopPad: Int64 = 4000

    public enum Edge: Sendable {
        case start
        case end
    }

    public enum Direction: Sendable {
        case previous
        case next
    }

    public enum NewLoop: Equatable, Sendable {
        case span(LoopSpan)
        case inside(id: String)
        case noRoom
        case atCap
    }

    private static func clamped(_ value: Int64, _ low: Int64, _ high: Int64) -> Int64 {
        min(max(value, low), high)
    }

    /// Pulls a span inside the bounds; nil when less than the minimum length remains.
    public static func clamp(_ span: LoopSpan, to bounds: LoopSpan) -> LoopSpan? {
        let start = max(span.startMs, bounds.startMs)
        let end = min(span.endMs, bounds.endMs)
        return end - start < minLoopMs ? nil : LoopSpan(startMs: start, endMs: end)
    }

    /// Drags one edge to a new time, keeping the minimum length and staying inside the bounds.
    public static func resize(_ span: LoopSpan, edge: Edge, to ms: Int64, bounds: LoopSpan) -> LoopSpan {
        switch edge {
        case .start:
            LoopSpan(startMs: clamped(ms, bounds.startMs, span.endMs - minLoopMs), endMs: span.endMs)
        case .end:
            LoopSpan(startMs: span.startMs, endMs: clamped(ms, span.startMs + minLoopMs, bounds.endMs))
        }
    }

    /// Snaps to the nearest target within `snapPoints` on screen; otherwise returns the time unchanged.
    public static func snap(_ ms: Int64, to targets: [Int64], msPerPoint: Double) -> Int64 {
        let reach = snapPoints * msPerPoint
        var best = ms
        var bestDistance = Double.infinity
        for target in targets {
            let distance = Double(abs(target - ms))
            if distance <= reach, distance < bestDistance {
                best = target
                bestDistance = distance
            }
        }
        return best
    }

    private static func byPosition(_ a: PlacedLoop, _ b: PlacedLoop) -> Bool {
        if a.span.startMs != b.span.startMs { return a.span.startMs < b.span.startMs }
        if a.span.endMs != b.span.endMs { return a.span.endMs < b.span.endMs }
        return a.id < b.id
    }

    /// The loop holding `ms`; a seam between flush loops belongs to the one that starts there.
    public static func loop(at ms: Int64, in loops: [PlacedLoop]) -> PlacedLoop? {
        loops.first { $0.span.startMs <= ms && ms < $0.span.endMs }
    }

    /// The free span around `span`, up to its neighbors or the bounds. Loops are sorted by start.
    public static func room(around span: LoopSpan, in loops: [PlacedLoop], bounds: LoopSpan) -> LoopSpan {
        var start = bounds.startMs
        var end = bounds.endMs
        for other in loops {
            if other.span.endMs <= span.startMs {
                start = max(start, other.span.endMs)
            } else if other.span.startMs >= span.endMs {
                end = min(end, other.span.startMs)
            }
        }
        return LoopSpan(startMs: start, endMs: end)
    }

    /// The free span around a point outside every loop; nil when the point is inside one.
    public static func freeGap(at ms: Int64, in loops: [PlacedLoop], bounds: LoopSpan) -> LoopSpan? {
        if loop(at: ms, in: loops) != nil { return nil }
        return room(around: LoopSpan(startMs: ms, endMs: ms), in: loops, bounds: bounds)
    }

    /// Where New loop would go: padded around the playhead and held inside the free gap.
    public static func newLoop(at playheadMs: Int64, in loops: [PlacedLoop], bounds: LoopSpan) -> NewLoop {
        if loops.count >= maxLoops { return .atCap }
        if let inside = loop(at: playheadMs, in: loops) { return .inside(id: inside.id) }
        guard let gap = freeGap(at: playheadMs, in: loops, bounds: bounds) else { return .noRoom }
        let start = max(gap.startMs, playheadMs - newLoopPad)
        let end = min(gap.endMs, playheadMs + newLoopPad)
        return end - start < minLoopMs ? .noRoom : .span(LoopSpan(startMs: start, endMs: end))
    }

    /// The next loop starting after the playhead, or the previous one starting before it, never the selected loop.
    public static func adjacent(
        _ direction: Direction, from playheadMs: Int64, in loops: [PlacedLoop], selectedID: String?
    ) -> PlacedLoop? {
        switch direction {
        case .next: loops.first { $0.span.startMs > playheadMs }
        case .previous: loops.last { $0.span.startMs < playheadMs && $0.id != selectedID }
        }
    }

    /// The color slot least used among nearby loops, then across all loops, then lowest index.
    public static func pickColor(for span: LoopSpan, among loops: [PlacedLoop]) -> Int {
        var neighbors: [PlacedLoop] = []
        var before: PlacedLoop?
        var after: PlacedLoop?
        for loop in loops.sorted(by: byPosition) {
            if loop.span.startMs < span.endMs, span.startMs < loop.span.endMs {
                neighbors.append(loop)
            } else if loop.span.endMs <= span.startMs {
                if let nearest = before, nearest.span.endMs >= loop.span.endMs { continue }
                before = loop
            } else if loop.span.startMs >= span.endMs {
                if let nearest = after, nearest.span.startMs <= loop.span.startMs { continue }
                after = loop
            }
        }
        neighbors += [before, after].compactMap { $0 }

        func counts(_ set: [PlacedLoop]) -> [Int] {
            var result = [Int](repeating: 0, count: colorCount)
            for loop in set where loop.color >= 0 && loop.color < colorCount { result[loop.color] += 1 }
            return result
        }
        let nearby = counts(neighbors)
        let overall = counts(loops)

        var best = 0
        for slot in 1..<colorCount
        where nearby[slot] < nearby[best] || (nearby[slot] == nearby[best] && overall[slot] < overall[best]) {
            best = slot
        }
        return best
    }

    /// "<L> part" for each distinct letter of a part structure, with labels already in use last.
    public static func partSuggestions(partStructure: String?, used: [String]) -> [String] {
        guard let partStructure, !partStructure.isEmpty else { return [] }
        // Parenthesized text is a repeat note such as "(x3)", not parts.
        let stripped = partStructure.replacing(/\([^)]*\)/, with: "")
        var seen = Set<String>()
        var labels: [String] = []
        // Letters are matched before uppercasing, since some (ß) uppercase to more than one letter.
        for scalar in stripped.unicodeScalars where scalar.isASCII && scalar.properties.isAlphabetic {
            let letter = String(scalar).uppercased()
            if seen.insert(letter).inserted { labels.append("\(letter) part") }
        }
        let usedSet = Set(used)
        return labels.filter { !usedSet.contains($0) } + labels.filter { usedSet.contains($0) }
    }
}
