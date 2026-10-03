import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct LoopModelTextTests {
    @Test func nameUsesOffsetIntoTrim() {
        #expect(LoopModel.name(label: nil, startMs: 85_000, trimStartMs: 1000) == "Loop 1:24")
        #expect(LoopModel.name(label: "  ", startMs: 85_000, trimStartMs: 1000) == "Loop 1:24")
        #expect(LoopModel.name(label: "B part", startMs: 85_000, trimStartMs: 1000) == "B part")
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
