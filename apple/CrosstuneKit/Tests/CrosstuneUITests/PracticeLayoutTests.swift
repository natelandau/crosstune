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

    /// A scroll moves each bar by the scroll's distance, so it keeps the stretch of the recording
    /// it covers, and so its height, rather than being resampled at a fixed place.
    @Test func zoomedWaveformBarsMoveWithTheViewAndKeepTheirStretch() throws {
        func zoomedWaveform(startMs: Double) -> ZoomedWaveformBars {
            ZoomedWaveformBars(
                view: ZoomedWaveformView(startMs: startMs, pointsPerSecond: 100, width: 200, trimStartMs: 0),
                lengthMs: 10_000, displayScale: 2)
        }
        let before = zoomedWaveform(startMs: 1000)
        // 130 ms is 13 points, which does not line the bars up on their old places.
        let after = zoomedWaveform(startMs: 1130)
        #expect(before.barMs == after.barMs)
        let beforeIndices = try #require(before.indices)
        let shared = try #require(after.indices?.clamped(to: beforeIndices))
        #expect(shared.count > 20)
        for index in shared {
            #expect(before.x(of: index) - after.x(of: index) == 13)
        }
    }

    @Test func zoomedWaveformBarsSnapToADevicePixelAndStartWithTheRecording() throws {
        let snapped = ZoomedWaveformBars(
            view: ZoomedWaveformView(startMs: 1001.3, pointsPerSecond: 100, width: 200, trimStartMs: 0),
            lengthMs: 10_000, displayScale: 2)
        #expect(snapped.offsetX == 100)
        let early = ZoomedWaveformBars(
            view: ZoomedWaveformView(startMs: -500, pointsPerSecond: 100, width: 200, trimStartMs: 0),
            lengthMs: 10_000, displayScale: 2)
        #expect(early.indices?.lowerBound == 0)
        #expect(early.x(of: 0) == 50)
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
