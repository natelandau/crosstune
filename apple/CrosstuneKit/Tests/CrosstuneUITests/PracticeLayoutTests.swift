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

    /// A recording whose waveform has not arrived still shows bars on the Mac, muted, rather
    /// than a line.
    @Test func emptyPeaksDrawPlaceholderBars() {
        #if os(macOS)
            let levels = PeakBars.levels(nil, count: 60)
            #expect(levels.count == 60)
            #expect(levels.allSatisfy { $0 > 0 && $0 < 1 })
        #else
            #expect(PeakBars.levels(nil, count: 60).isEmpty)
        #endif
    }

    #if os(macOS)
        /// The practice view sits on the page's margins, as the tune page does.
        @Test func practicePageUsesThePageMargin() throws {
            let file = SourceScan.sources.appending(path: "RecordingScreen/RecordingScreen.swift")
            let mac = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)))
            #expect(mac.contains("MacStyle.pageMargin"))
            #expect(!mac.contains("MacStyle.sheetMargin"))
        }
    #endif
}
