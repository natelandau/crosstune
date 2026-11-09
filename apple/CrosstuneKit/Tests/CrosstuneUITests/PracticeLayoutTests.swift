import CrosstuneDesign
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
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

    @Test func theWaveformCapMatchesTheDesktopWebWaveform() {
        #expect(PracticeLayout.waveformCap == 160)
    }

    @Test func aTallWindowStopsTheWaveformAtTheCap() {
        #expect(PracticeLayout.waveformHeight(spare: 900, isCompactHeight: false) == PracticeLayout.waveformCap)
        #expect(PracticeLayout.waveformHeight(spare: 900, isCompactHeight: true) == PracticeLayout.waveformCap)
    }

    @Test func aShortWindowGivesTheWaveformTheLeftover() {
        let floor = PracticeLayout.waveformFloor(isCompactHeight: false)
        #expect(PracticeLayout.waveformHeight(spare: 10, isCompactHeight: false) == floor + 10)
    }

    @Test func theWaveformNeverShrinksBelowItsFloor() {
        for compact in [false, true] {
            let floor = PracticeLayout.waveformFloor(isCompactHeight: compact)
            #expect(PracticeLayout.waveformHeight(spare: -200, isCompactHeight: compact) == floor)
            #expect(PracticeLayout.waveformHeight(spare: nil, isCompactHeight: compact) == floor)
        }
    }

    @Test func loopHandlesAreTheBrandColorWhateverTheLoopColor() {
        for slot in 0..<6 {
            #expect(Palette.brand != Palette.loop(slot, scheme: .dark))
        }
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

    /// A panel's height in a controls column as wide as an iPhone's, at the default text size.
    private func panelHeight(_ panel: some View) -> CGFloat {
        let width: CGFloat = 358
        let root = panel.frame(width: width).environment(\.dynamicTypeSize, .large)
        #if os(macOS)
            let host = NSHostingController(rootView: root)
        #else
            let host = UIHostingController(rootView: root)
        #endif
        return host.sizeThatFits(in: CGSize(width: width, height: 10_000)).height
    }

    /// Isolate never makes the mode panel taller, so the waveform keeps its height. The package
    /// tests run on the Mac, so this covers the Mac panels only; the iPhone panels are measured
    /// on a simulator.
    @Test func isolatePanelFitsThePanelHeight() {
        let row = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, label: "Jam", state: "ready",
            sourceDurationMs: 60_000, trimStartMs: 0, speedPercent: 100, pitchCents: 0)
        let model = PracticeModel(
            player: PlayerModel(audio: FakeAudio()), recording: row, file: nil,
            writer: LoopWriter(add: { _, _ in throw CancellationError() }, update: { _, _, _ in }, remove: { _ in }))
        let tallest =
            [
                panelHeight(LoopsPanel(model: model, onDeleted: {})),
                panelHeight(SpeedPanel(value: 100, onChange: { _ in })),
                panelHeight(PitchPanel(value: 0, split: .constant(PitchSplit(cents: 0)), onChange: { _ in })),
            ].max() ?? 0
        let narrowed = IsolateSetting(effect: .mute, panStart: -40, panEnd: -10, lowHz: 200, highHz: 4100)
        for isMono in [false, true] {
            let isolate = IsolatePanel(
                value: narrowed, isMono: isMono, outline: { nil }, isLive: false, onChange: { _ in })
            #expect(panelHeight(isolate) <= tallest)
        }
        let unavailable = IsolatePanel(
            value: narrowed, isMono: false, isAvailable: false, outline: { nil }, isLive: false, onChange: { _ in })
        #expect(panelHeight(unavailable) <= tallest)
    }

    #if os(macOS)
        /// The practice view sits on the page's margins, as the tune page does.
        @Test func practicePageUsesThePageMargin() throws {
            let file = SourceScan.url(of: "RecordingScreen/RecordingScreen.swift")
            let mac = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)))
            #expect(mac.contains("MacStyle.pageMargin"))
            #expect(!mac.contains("MacStyle.sheetMargin"))
        }
    #endif
}
