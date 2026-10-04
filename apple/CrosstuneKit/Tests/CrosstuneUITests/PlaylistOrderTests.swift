import Testing

@testable import CrosstuneUI

/// A small seeded generator so a shuffle is repeatable.
struct SplitMix64: RandomNumberGenerator {
    var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

@Suite struct PlaylistOrderTests {
    let ids = ["a", "b", "c", "d", "e"]

    private func order(
        _ tuneIDs: [String], shuffled: Bool = false, startAt: String? = nil, seed: UInt64 = 1
    ) -> PlaylistOrder {
        var rng = SplitMix64(seed: seed)
        return PlaylistOrder(tuneIDs: tuneIDs, shuffled: shuffled, startAt: startAt, using: &rng)
    }

    /// Walks the whole queue from the current tune and returns every ID it plays.
    private func drain(_ order: inout PlaylistOrder, rng: inout SplitMix64) -> [String] {
        var played = [order.current!]
        while let next = order.next(repeat: .off, using: &rng) { played.append(next) }
        return played
    }

    @Test func anUnshuffledOrderStartsAtTheFirstTune() {
        let order = order(ids)
        #expect(order.current == "a")
        #expect(order.position == 1)
        #expect(order.count == 5)
    }

    @Test func anUnshuffledStartAtBeginsAtThatTune() {
        var rng = SplitMix64(seed: 2)
        var order = order(ids, startAt: "c")
        #expect(order.current == "c")
        #expect(order.position == 3)
        #expect(order.next(repeat: .off, using: &rng) == "d")
    }

    @Test func aShuffledStartWithoutATuneBeginsAtARandomOneAndPlaysEveryTuneOnce() {
        var rng = SplitMix64(seed: 3)
        var starts = Set<String>()
        for seed in 0..<40 as Range<UInt64> {
            var order = order(ids, shuffled: true, seed: seed)
            starts.insert(order.current!)
            #expect(drain(&order, rng: &rng).sorted() == ids)
        }
        #expect(starts.count > 1)
    }

    @Test func aShuffledStartAtKeepsThatTuneFirst() {
        let order = order(ids, shuffled: true, startAt: "d")
        #expect(order.current == "d")
        #expect(order.position == 1)
    }

    @Test func nextAdvancesAndStopsAtTheEndWhenRepeatIsOff() {
        var rng = SplitMix64(seed: 4)
        var order = order(["a", "b"])
        #expect(order.next(repeat: .off, using: &rng) == "b")
        #expect(order.next(repeat: .off, using: &rng) == nil)
    }

    @Test func repeatListWrapsToTheTop() {
        var rng = SplitMix64(seed: 4)
        var order = order(["a", "b"])
        _ = order.next(repeat: .list, using: &rng)
        #expect(order.next(repeat: .list, using: &rng) == "a")
        #expect(order.position == 1)
    }

    @Test func afterFinishWithRepeatOneReplaysTheCurrentTune() {
        var rng = SplitMix64(seed: 5)
        var order = order(ids, startAt: "b")
        #expect(order.afterFinish(repeat: .one, using: &rng) == "b")
        #expect(order.afterFinish(repeat: .one, using: &rng) == "b")
    }

    @Test func afterFinishOtherwiseMovesOnLikeNext() {
        var rng = SplitMix64(seed: 5)
        var order = order(["a", "b"])
        #expect(order.afterFinish(repeat: .off, using: &rng) == "b")
        #expect(order.afterFinish(repeat: .off, using: &rng) == nil)
        #expect(order.afterFinish(repeat: .list, using: &rng) == "a")
    }

    @Test func aSkipWithRepeatOneLeavesTheTune() {
        var rng = SplitMix64(seed: 5)
        var order = order(ids)
        #expect(order.next(repeat: .one, using: &rng) == "b")
        #expect(order.next(repeat: .one, using: &rng) == "c")
    }

    @Test func previousStepsBackAndRestartsTheFirstTune() {
        var rng = SplitMix64(seed: 6)
        var order = order(ids)
        #expect(order.previous() == "a")
        _ = order.next(repeat: .off, using: &rng)
        #expect(order.previous() == "a")
        #expect(order.position == 1)
    }

    @Test func aShuffledWrapReshufflesAndNeverLeadsWithTheTuneThatJustPlayed() {
        for seed in 0..<200 as Range<UInt64> {
            var rng = SplitMix64(seed: seed)
            var order = order(["a", "b", "c"], shuffled: true, seed: seed)
            for _ in 0..<2 { _ = order.next(repeat: .list, using: &rng) }
            let last = order.current!
            let first = order.next(repeat: .list, using: &rng)!
            #expect(first != last)
            #expect(order.position == 1)
            #expect(order.count == 3)
        }
    }

    @Test func aOneTuneShuffledListRepeatsItself() {
        var rng = SplitMix64(seed: 7)
        var order = order(["a"], shuffled: true)
        #expect(order.afterFinish(repeat: .list, using: &rng) == "a")
        #expect(order.afterFinish(repeat: .list, using: &rng) == "a")
        #expect(order.afterFinish(repeat: .off, using: &rng) == nil)
    }

    @Test func turningShuffleOnKeepsThePlayedTunesAndTheCurrentOneInPlace() {
        var rng = SplitMix64(seed: 8)
        var order = order(ids, startAt: "c")
        order.setShuffled(true, using: &rng)
        #expect(order.current == "c")
        #expect(order.position == 3)
        #expect(order.count == 5)
        #expect(order.previous() == "b")
        #expect(order.previous() == "a")
    }

    @Test func turningShuffleOnNeverReplaysAPlayedTune() {
        for seed in 0..<40 as Range<UInt64> {
            var rng = SplitMix64(seed: seed)
            var order = order(ids, startAt: "c")
            order.setShuffled(true, using: &rng)
            let played = drain(&order, rng: &rng)
            #expect(played.first == "c")
            #expect(played.dropFirst().sorted() == ["d", "e"])
        }
    }

    @Test func turningShuffleOnMovesTheTunesAhead() {
        var orders = Set<[String]>()
        for seed in 0..<40 as Range<UInt64> {
            var rng = SplitMix64(seed: seed)
            var order = order(ids)
            order.setShuffled(true, using: &rng)
            orders.insert(drain(&order, rng: &rng))
        }
        #expect(orders.count > 1)
        #expect(orders.allSatisfy { $0.first == "a" && $0.sorted() == ids })
    }

    @Test func aShuffledTwoTuneListWrapsToTheOtherTune() {
        for seed in 0..<40 as Range<UInt64> {
            var rng = SplitMix64(seed: seed)
            var order = order(["a", "b"], shuffled: true, seed: seed)
            _ = order.next(repeat: .list, using: &rng)
            let last = order.current!
            let first = order.next(repeat: .list, using: &rng)!
            #expect(first != last)
            #expect(order.position == 1)
            #expect(order.next(repeat: .list, using: &rng) == last)
        }
    }

    @Test func turningShuffleOffContinuesInListOrderAfterTheCurrentTune() {
        var rng = SplitMix64(seed: 9)
        var order = order(ids, shuffled: true, startAt: "c")
        order.setShuffled(false, using: &rng)
        #expect(order.current == "c")
        #expect(order.position == 3)
        #expect(order.next(repeat: .off, using: &rng) == "d")
        #expect(order.next(repeat: .off, using: &rng) == "e")
        #expect(order.next(repeat: .off, using: &rng) == nil)
    }

    @Test func jumpMovesToATuneInTheQueueAndRejectsAStranger() {
        var rng = SplitMix64(seed: 10)
        var order = order(ids)
        let jumped = order.jump(to: "d")
        #expect(jumped)
        #expect(order.current == "d")
        #expect(order.next(repeat: .off, using: &rng) == "e")
        let strayed = order.jump(to: "zzz")
        #expect(!strayed)
        #expect(order.current == "e")
    }

    @Test func anEmptyListHasNothingToPlay() {
        var rng = SplitMix64(seed: 11)
        var order = order([], shuffled: true)
        #expect(order.current == nil)
        #expect(order.count == 0)
        #expect(order.position == 0)
        #expect(order.next(repeat: .list, using: &rng) == nil)
        #expect(order.previous() == nil)
        order.setShuffled(false, using: &rng)
        #expect(order.current == nil)
    }
}
