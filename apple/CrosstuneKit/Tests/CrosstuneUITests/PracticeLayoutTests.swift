import Testing

@testable import CrosstuneUI

@Suite struct PracticeLayoutTests {
    @Test func theWaveformKeepsItsFloor() {
        #expect(PracticeLayout.waveformFloor(isCompactHeight: false) == 140)
        #expect(PracticeLayout.waveformFloor(isCompactHeight: true) == 64)
    }

    @Test func compactHeightHasTheLowerFloor() {
        let compact = PracticeLayout.waveformFloor(isCompactHeight: true)
        #expect(compact < PracticeLayout.waveformFloor(isCompactHeight: false))
    }
}
