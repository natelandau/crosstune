import SwiftUI
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PracticeLayoutTests {
    @Test func theWaveformKeepsItsFloor() {
        #expect(PracticeLayout.waveformFloor(isCompactHeight: false) == 140)
        #expect(PracticeLayout.waveformFloor(isCompactHeight: true) == 64)
    }

    @Test func compactHeightHasTheLowerFloor() {
        let compact = PracticeLayout.waveformFloor(isCompactHeight: true)
        #expect(compact < PracticeLayout.waveformFloor(isCompactHeight: false))
    }

    @Test func loopHandlesAreCoralWhateverTheLoopColor() {
        let practice = PracticeWaveform.handleColor(isTrim: false)
        #expect(practice == BrandStyle.coral)
        for slot in 0..<6 {
            #expect(practice != LoopColor.color(slot, scheme: .dark))
        }
    }

    @Test func trimHandlesReadApartFromPractice() {
        #expect(PracticeWaveform.handleColor(isTrim: true) != PracticeWaveform.handleColor(isTrim: false))
    }
}
