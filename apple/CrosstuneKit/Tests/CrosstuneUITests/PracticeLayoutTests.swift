import Testing

@testable import CrosstuneUI

@Suite struct PracticeLayoutTests {
    @Test(arguments: [
        (700.0, false, 280.0),
        (200.0, false, 140.0),
        (2000.0, false, 480.0),
        (300.0, true, 90.0),
        (150.0, true, 64.0),
        (800.0, true, 110.0),
    ])
    func waveformHeightIsAShareOfTheScreenHeldToItsLimits(screen: Double, compact: Bool, expected: Double) {
        #expect(PracticeLayout.waveformHeight(screenHeight: screen, isCompactHeight: compact) == expected)
    }

    @Test func waveformHeightDependsOnlyOnTheScreen() {
        // Mode, loops, and what shows under the waveform are not inputs, so one screen size
        // gives one height whatever the screen holds.
        let heights = PracticeMode.allCases.map { _ in
            PracticeLayout.waveformHeight(screenHeight: 750, isCompactHeight: false)
        }
        #expect(Set(heights).count == 1)
    }

    @Test func compactHeightIsShorterThanRegularAtTheSameSize() {
        let compact = PracticeLayout.waveformHeight(screenHeight: 400, isCompactHeight: true)
        let regular = PracticeLayout.waveformHeight(screenHeight: 400, isCompactHeight: false)
        #expect(compact < regular)
    }

    @Test func anUnmeasuredScreenGetsTheFloor() {
        #expect(PracticeLayout.waveformHeight(screenHeight: 0, isCompactHeight: false) == 140)
        #expect(PracticeLayout.waveformHeight(screenHeight: 0, isCompactHeight: true) == 64)
    }
}
