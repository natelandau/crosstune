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

@Suite struct TuningDisplayTests {
    let tunings: JSONObject = [
        "violin": .object(["tuning": .string("Standard (GDAE)")]),
        "five_string_banjo": .object(["tuning": .string("Open G (gDGBD)"), "capo": .integer(2)]),
        "guitar": .object(["capo": .integer(3)]),
        "mandolin": .object(["tuning": .string("Cross A (AEAE)")]),
        "bouzouki": .string("a shape from a newer server"),
        "hardanger": .object(["tuning": .string("AEAE")]),
    ]

    @Test func readsTuningCapoOrBoth() {
        #expect(tuningDisplay(tunings, instrument: "violin") == "Standard (GDAE)")
        #expect(tuningDisplay(tunings, instrument: "five_string_banjo") == "Open G (gDGBD), capo 2")
        #expect(tuningDisplay(tunings, instrument: "guitar") == "Capo 3")
        #expect(tuningDisplay(tunings, instrument: "tenor_banjo") == nil)
        #expect(tuningDisplay(tunings, instrument: "bouzouki") == nil)
    }

    @Test func namesTheInstrumentWhenAsked() {
        #expect(tuningDisplay(tunings, instrument: "mandolin", withInstrument: true) == "Mandolin: Cross A (AEAE)")
        #expect(
            tuningDisplay(tunings, instrument: "five_string_banjo", withInstrument: true)
                == "5-string banjo: Open G (gDGBD), capo 2")
        #expect(tuningDisplay(tunings, instrument: "hardanger", withInstrument: true) == "hardanger: AEAE")
    }
}
