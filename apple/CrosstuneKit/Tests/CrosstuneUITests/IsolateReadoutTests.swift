import Testing

@testable import CrosstuneUI

struct IsolateReadoutTests {
    @Test(arguments: [
        (-100, 100, "Everything"),
        (-40, -10, "Left of center, medium"),
        (-5, 5, "Center, narrow"),
        (60, 100, "Right, medium"),
        (-100, 0, "Left of center, wide"),
    ])
    func readsWhereTheStereoRangeSitsAndHowWideItIs(start: Int, end: Int, text: String) {
        #expect(IsolateReadout.stereo(start: start, end: end) == text)
    }

    @Test(arguments: [
        (0, "Center"),
        (9, "Center"),
        (10, "Right of center"),
        (-59, "Left of center"),
        (-60, "Left"),
        (100, "Right"),
    ])
    func readsAPlaceInTheStereoPicture(pan: Int, text: String) {
        #expect(IsolateReadout.position(Double(pan)) == text)
    }

    @Test(arguments: [(-35, "Left of center, 35 left"), (35, "Right of center, 35 right"), (0, "Center")])
    func readsAStereoEdgeAsItsPlaceAndItsUnitsOffCenter(pan: Int, text: String) {
        #expect(IsolateReadout.stereoEdge(pan) == text)
    }

    @Test func readsHzUnderAKilohertzAndKHzToATenthAboveIt() {
        #expect(IsolateReadout.frequency(low: 200, high: 4100) == "200 Hz to 4.1 kHz")
        #expect(IsolateReadout.frequency(low: 40, high: 16000) == "40 Hz to 16 kHz")
    }

    @Test func dropsAZeroTenth() {
        #expect(IsolateReadout.hz(1000) == "1 kHz")
        #expect(IsolateReadout.hz(999) == "999 Hz")
    }

    @Test func roundsAHalfTenthUpSoEveryClientReadsTheSame() {
        #expect(IsolateReadout.hz(1150) == "1.2 kHz")
        #expect(IsolateReadout.hz(4050) == "4.1 kHz")
        #expect(IsolateReadout.hz(9950) == "10 kHz")
        #expect(IsolateReadout.hz(15950) == "16 kHz")
    }
}
