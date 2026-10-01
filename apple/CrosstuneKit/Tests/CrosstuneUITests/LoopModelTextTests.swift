import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneUI

private let bounds = LoopSpan(startMs: 1000, endMs: 61000)
private func span(_ start: Int64, _ end: Int64) -> LoopSpan { LoopSpan(startMs: start, endMs: end) }

@Suite struct LoopModelTextTests {
    @Test func nameUsesOffsetIntoTrim() {
        #expect(LoopModel.name(label: nil, startMs: 85_000, trimStartMs: 1000) == "Loop 1:24")
        #expect(LoopModel.name(label: "  ", startMs: 85_000, trimStartMs: 1000) == "Loop 1:24")
        #expect(LoopModel.name(label: "B part", startMs: 85_000, trimStartMs: 1000) == "B part")
    }

    @Test func canCreateBlocksAtTheCap() {
        let result = LoopModel.canCreate(liveCount: 100, bounds: bounds)
        #expect(!result.allowed)
        #expect(result.reason == PracticeText.loopLimit)
    }

    @Test func canCreateHidesWhenTrimIsTooShort() {
        let result = LoopModel.canCreate(liveCount: 0, bounds: span(0, 400))
        #expect(!result.allowed)
        #expect(result.reason == nil)
    }

    @Test func canCreateAllowsOtherwise() {
        let result = LoopModel.canCreate(liveCount: 99, bounds: bounds)
        #expect(result.allowed)
        #expect(result.reason == nil)
    }

    @Test func capsALabelByCodePointsAsTheServerCounts() {
        // Each of these is one character but two code points.
        let thumbs = String(repeating: "👍🏽", count: 60)
        let capped = LoopModel.cappedLabel(thumbs)
        #expect(capped.unicodeScalars.count == Vocabulary.Limits.RecordingLoop.label)
        #expect(capped.count == 50)
        #expect(LoopModel.cappedLabel("B part") == "B part")
    }
}
