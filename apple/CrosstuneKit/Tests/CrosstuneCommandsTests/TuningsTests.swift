import CrosstuneStore
import Testing

@testable import CrosstuneCommands

@Suite struct SetTuningTests {
    @Test func replacesOneEntryAndKeepsEveryOtherKey() {
        let stored: JSONObject = [
            "hardanger": .object(["tuning": .string("x")]),
            "guitar": .object(["tuning": .string("DADGAD"), "capo": .integer(2)]),
        ]
        let next = setTuning(stored, instrument: "guitar", tuning: "Drop D (DADGBE)", capo: nil)
        #expect(next["hardanger"] == stored["hardanger"])
        #expect(next["guitar"] == .object(["tuning": .string("Drop D (DADGBE)")]))
    }

    @Test func dropsTheEntryOnceBothAreCleared() {
        let stored: JSONObject = ["guitar": .object(["capo": .integer(2)])]
        #expect(setTuning(stored, instrument: "guitar", tuning: nil, capo: nil).isEmpty)
    }

    @Test func writesNoCapoForAnInstrumentThatTakesNone() {
        let next = setTuning([:], instrument: "violin", tuning: "Cross A (AEAE)", capo: 2)
        #expect(next == ["violin": .object(["tuning": .string("Cross A (AEAE)")])])
    }
}
