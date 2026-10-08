import CrosstuneAnalytics

/// What a list does when a tune ends.
public enum RepeatMode: String, CaseIterable, Sendable {
    case off, list, one
}

extension CrosstuneAnalytics.RepeatMode {
    init(_ mode: CrosstuneUI.RepeatMode) {
        self =
            switch mode {
            case .off: .off
            case .list: .list
            case .one: .tune
            }
    }
}

/// The order a list's tunes play in, where playback stands in it, and how it moves on repeat
/// and shuffle. It holds tune IDs only, each at most once; what each tune plays is the
/// caller's concern.
struct PlaylistOrder {
    private let listOrder: [String]
    private var queue: [String]
    private var index: Int
    private var shuffled: Bool

    /// The tune that is playing, or nil for an empty list.
    var current: String? { queue.indices.contains(index) ? queue[index] : nil }
    /// The current tune's place in the queue, counting from 1. Zero for an empty list.
    var position: Int { queue.isEmpty ? 0 : index + 1 }
    var count: Int { queue.count }

    /// Starts at `startAt` when the list holds it. Otherwise an unshuffled list starts at the
    /// first tune and a shuffled one at a random tune.
    init(
        tuneIDs: [String], shuffled: Bool, startAt: String?, using rng: inout some RandomNumberGenerator
    ) {
        listOrder = tuneIDs
        self.shuffled = shuffled
        index = 0
        queue = tuneIDs
        let start = startAt.flatMap { tuneIDs.contains($0) ? $0 : nil }
        if shuffled {
            queue = Self.shuffle(tuneIDs, using: &rng)
            if let start, let at = queue.firstIndex(of: start) { queue.swapAt(0, at) }
        } else if let start, let at = tuneIDs.firstIndex(of: start) {
            index = at
        }
    }

    /// The tune after the current one ends on its own. Repeat one replays it.
    mutating func afterFinish(repeat mode: RepeatMode, using rng: inout some RandomNumberGenerator)
        -> String?
    {
        mode == .one ? current : next(repeat: mode, using: &rng)
    }

    /// The tune after a skip. A skip leaves the tune, so repeat one moves on as repeat list does.
    /// Nil at the end of the queue with repeat off, leaving the position on the last tune.
    mutating func next(repeat mode: RepeatMode, using rng: inout some RandomNumberGenerator)
        -> String?
    {
        guard !queue.isEmpty else { return nil }
        if index + 1 < queue.count {
            index += 1
            return current
        }
        guard mode != .off else { return nil }
        if shuffled {
            queue = Self.shuffle(queue, avoidingFirst: queue[index], using: &rng)
        }
        index = 0
        return current
    }

    /// The previous tune, or the first tune again when already there.
    mutating func previous() -> String? {
        index = max(index - 1, 0)
        return current
    }

    /// Moves to a tune in the queue. False, and no move, when the queue lacks it.
    mutating func jump(to tuneID: String) -> Bool {
        guard let at = queue.firstIndex(of: tuneID) else { return false }
        index = at
        return true
    }

    /// Shuffling keeps the tunes already played and the current one where they are, and
    /// shuffles only the tunes still to come. Unshuffling returns to list order from the
    /// current tune.
    mutating func setShuffled(_ on: Bool, using rng: inout some RandomNumberGenerator) {
        guard on != shuffled else { return }
        let playing = current
        shuffled = on
        if on {
            guard !queue.isEmpty else { return }
            let ahead = index + 1
            queue = Array(queue[..<ahead]) + Self.shuffle(Array(queue[ahead...]), using: &rng)
        } else {
            queue = listOrder
            index = playing.flatMap { queue.firstIndex(of: $0) } ?? 0
        }
    }

    /// A Fisher-Yates shuffle. With `avoidingFirst`, a queue of two or more tunes never opens
    /// with that tune; it swaps into a random later slot, so the result is bounded.
    private static func shuffle(
        _ ids: [String], avoidingFirst last: String? = nil, using rng: inout some RandomNumberGenerator
    ) -> [String] {
        var ids = ids
        for i in ids.indices.reversed() where i > 0 {
            ids.swapAt(i, Int.random(in: 0...i, using: &rng))
        }
        if let last, ids.count > 1, ids[0] == last {
            ids.swapAt(0, Int.random(in: 1..<ids.count, using: &rng))
        }
        return ids
    }
}
