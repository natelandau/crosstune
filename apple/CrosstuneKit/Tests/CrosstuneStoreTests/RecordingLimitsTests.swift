import Testing

@testable import CrosstuneStore

@Suite struct RecordingLimitsTests {
    private let limits = StorageUsage(
        usedBytes: 0, quotaBytes: 0, maxFileBytes: 500, splitParentMaxFileBytes: 2_000)

    private func file(_ ms: Int64?, _ state: LocalFileState = .captured, bytes: Int64? = nil) -> RecordingFile {
        RecordingFile(id: "r", localState: state, bytes: bytes, localDurationMs: ms)
    }

    @Test func mustSplitOnlyWhenOverTheLimitAndNotSplitOrUploaded() {
        let row = Recording(tuneID: nil, source: "microphone")
        #expect(RecordingLimits.mustSplitToUpload(row, file: file(10_800_001), uploadLimits: nil))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(10_800_000), uploadLimits: nil))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(nil), uploadLimits: nil))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: nil, uploadLimits: nil))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(10_800_001, .uploaded), uploadLimits: nil))
        let split = Recording(tuneID: nil, source: "microphone", splitID: "s1")
        #expect(!RecordingLimits.mustSplitToUpload(split, file: file(10_800_001), uploadLimits: nil))
    }

    @Test func mustSplitAnUnsplitFileOverThePerFileLimitEvenUnderThreeHours() {
        let row = Recording(tuneID: nil, source: "microphone")
        #expect(RecordingLimits.mustSplitToUpload(row, file: file(60_000, bytes: 501), uploadLimits: limits))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(60_000, bytes: 500), uploadLimits: limits))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(60_000, bytes: 501), uploadLimits: nil))
        #expect(
            !RecordingLimits.mustSplitToUpload(row, file: file(60_000, .uploaded, bytes: 501), uploadLimits: limits))
        let split = Recording(tuneID: nil, source: "microphone", splitID: "s1")
        #expect(!RecordingLimits.mustSplitToUpload(split, file: file(60_000, bytes: 501), uploadLimits: limits))
    }

    @Test func aFileThatCouldNeverUploadEvenSplitIsNotHeld() {
        let row = Recording(tuneID: nil, source: "microphone")
        #expect(!RecordingLimits.mustSplitToUpload(row, file: file(60_000, bytes: 2_001), uploadLimits: limits))
        let overTwelveHours = file(RecordingLimits.maxSplitSourceMs + 1, bytes: 1)
        #expect(!RecordingLimits.mustSplitToUpload(row, file: overTwelveHours, uploadLimits: limits))
        #expect(!RecordingLimits.mustSplitToUpload(row, file: overTwelveHours, uploadLimits: nil))
        let atTwelveHours = file(RecordingLimits.maxSplitSourceMs, bytes: 2_000)
        #expect(RecordingLimits.mustSplitToUpload(row, file: atTwelveHours, uploadLimits: limits))
    }

    @Test func aCaptureStoppedPastItsStopByABufferIsStillHeldAsMustSplit() {
        let row = Recording(tuneID: nil, source: "microphone")
        let overshot = file(RecordingLimits.captureStopMs + 5_000, bytes: 1)
        #expect(overshot.localDurationMs! < RecordingLimits.maxSplitSourceMs)
        #expect(RecordingLimits.mustSplitToUpload(row, file: overshot, uploadLimits: limits))
    }

    @Test func aSplitIsIncompleteUntilTheServerMarksItComplete() {
        #expect(!RecordingLimits.splitIncomplete(Recording(tuneID: nil, source: "microphone")))
        #expect(RecordingLimits.splitIncomplete(Recording(tuneID: nil, source: "microphone", splitID: "s1")))
        #expect(
            RecordingLimits.splitIncomplete(
                Recording(tuneID: nil, source: "microphone", splitID: "s2", splitCompletedID: "s1")))
        #expect(
            !RecordingLimits.splitIncomplete(
                Recording(tuneID: nil, source: "microphone", splitID: "s1", splitCompletedID: "s1")))
    }

    @Test func pieceLabelFallsBackForABlankLabel() {
        #expect(RecordingLimits.pieceLabel("Reel", number: 2) == "Reel, part 2")
        #expect(RecordingLimits.pieceLabel("  ", number: 1) == "Part 1")
        #expect(RecordingLimits.pieceLabel(nil, number: 3) == "Part 3")
    }

    @Test func aSplitEndsAtTheTrimEndThenTheSourceThenTheDurationThenTheLocalFile() {
        let local = file(20_000)
        func end(_ row: Recording, _ file: RecordingFile? = nil) -> Int64? {
            RecordingLimits.splitRangeEnd(row, file: file)
        }
        #expect(end(Recording(tuneID: nil, source: "m", sourceDurationMs: 9000, trimEndMs: 5000), local) == 5000)
        #expect(end(Recording(tuneID: nil, source: "m", durationMs: 8000, sourceDurationMs: 9000), local) == 9000)
        #expect(end(Recording(tuneID: nil, source: "m", durationMs: 8000), local) == 8000)
        #expect(end(Recording(tuneID: nil, source: "m"), local) == 20_000)
        #expect(end(Recording(tuneID: nil, source: "m")) == nil)
    }

    @Test func aPieceProblemNamesTheFirstRuleItBreaks() {
        let max = RecordingLimits.maxRecordingMs
        #expect(RecordingLimits.pieceProblem(edges: [0, 1000, 2000]) == nil)
        #expect(RecordingLimits.pieceProblem(edges: [0, 999, 2000]) == .tooShort)
        #expect(RecordingLimits.pieceProblem(edges: [0, max + 1, max + 2000]) == .tooLong)
        #expect(RecordingLimits.pieceProblem(edges: [0, max, max + 2000]) == nil)
        let fiftyOne = (0...Int64(RecordingLimits.maxSplitPieces + 1)).map { $0 * 1000 }
        #expect(RecordingLimits.pieceProblem(edges: fiftyOne) == .tooMany)
        #expect(RecordingLimits.pieceProblem(edges: Array(fiftyOne.dropLast())) == nil)
    }

    private func piece(_ id: String, of parent: String, state: String = "processing", deleted: Bool = false)
        -> Recording
    {
        var row = Recording(id: id, tuneID: nil, source: "m", state: state, splitFromID: parent)
        if deleted { row.deletedAt = .now }
        return row
    }

    @Test func onlyALivePieceWaitingForItsCutHoldsItsParent() {
        let pieces = [
            piece("a", of: "p1"), piece("b", of: "p2", state: "failed"), piece("c", of: "p3", deleted: true),
            piece("d", of: "p4", state: "ready"), piece("e", of: "p5"),
        ]
        #expect(RecordingLimits.waitingParentIDs(in: pieces) == ["p1", "p5"])
        #expect(RecordingLimits.waitingParentIDs(in: pieces, excluding: ["e"]) == ["p1"])
    }

    @Test func aTuneDeleteKeepsAHeldParentUnlessItsWaitingPieceGoesToo() {
        let parent = Recording(id: "p", tuneID: "t", source: "m", state: "ready")
        let elsewhere = piece("x", of: "p")
        #expect(RecordingLimits.keptByTuneDelete([parent], pieces: [elsewhere]) == ["p"])
        var filed = elsewhere
        filed.tuneID = "t"
        #expect(RecordingLimits.keptByTuneDelete([parent, filed], pieces: [filed]).isEmpty)
        var failed = parent
        failed.state = "failed"
        #expect(RecordingLimits.keptByTuneDelete([failed], pieces: [elsewhere]).isEmpty)
    }
}
