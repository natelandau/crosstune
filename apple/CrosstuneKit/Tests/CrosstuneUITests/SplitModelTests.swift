import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func row(
    id: String = "r1", trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 60_000,
    durationMs: Int64? = nil, state: String = "ready"
) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, label: nil, state: state, durationMs: durationMs,
        sourceDurationMs: sourceDurationMs, trimStartMs: trimStartMs, trimEndMs: trimEndMs, speedPercent: 75,
        pitchCents: 200)
}

/// Notes each split the model writes, and can refuse them.
@MainActor
private final class SplitWrites {
    struct Made: Equatable {
        let id: String
        let cuts: [Int64]
    }

    private(set) var made: [Made] = []
    var refusal: (any Error)?
    /// Runs while the write is under way, as the row landing would.
    var during: (@MainActor () -> Void)?

    func write(_ id: String, _ cuts: [Int64]) async throws {
        during?()
        if let refusal { throw refusal }
        made.append(Made(id: id, cuts: cuts))
    }
}

/// Notes each end of playback a model asks the player for.
@MainActor
private final class PlaybackEnds {
    var made: [Int64?] = []
}

@MainActor
private final class SplitHolds {
    private(set) var made: [PlaybackSettings?] = []

    func hold(_ settings: PlaybackSettings?) {
        made.append(settings)
    }
}

@MainActor
@Suite struct SplitModelTests {
    private let writes = SplitWrites()
    private let holds = SplitHolds()
    private let sink = RecordingAnalyticsSink()

    private func model(_ recording: Recording = row(), file: RecordingFile? = nil) -> SplitModel {
        SplitModel(recording: recording, file: file, write: writes.write, hold: holds.hold, analytics: sink.client)
    }

    /// A model on a 60 s row with `cuts` placed and the line at `lineMs`, nothing selected.
    private func placed(_ cuts: [Int64] = [], lineMs: Int64 = 0, highMs: Int64 = 60_000) -> SplitModel {
        let split = model(row(sourceDurationMs: highMs))
        for cut in cuts {
            split.seek(to: cut)
            split.addCut()
        }
        split.seek(to: lineMs)
        return split
    }

    /// Drags the strip until the line is at `ms`, leaving the drag under way so the line has not
    /// come to rest.
    private func drag(_ split: SplitModel, to ms: Int64) {
        split.beginScrub()
        split.scrub(byMs: ms - split.state.lineMs)
    }

    // MARK: Opening

    @Test func spansTheWholeSourceOfAnUntrimmedRow() {
        let split = model()
        #expect(split.bounds == 0...60_000)
        #expect(split.state.lineMs == 0)
        #expect(split.state.cuts.isEmpty)
        #expect(split.state.selected == nil)
    }

    @Test func spansTheCurrentTrim() {
        #expect(model(row(trimStartMs: 5000, trimEndMs: 40_000)).bounds == 5000...40_000)
    }

    @Test func fallsBackToTheDurationThenTheLocalFileLength() {
        #expect(model(row(sourceDurationMs: nil, durationMs: 30_000)).bounds.upperBound == 30_000)
        let file = RecordingFile(id: "r1", localState: .captured, localDurationMs: 20_000)
        #expect(model(row(sourceDurationMs: nil), file: file).bounds.upperBound == 20_000)
    }

    @Test func flagsARangeOver3Hours() {
        #expect(model(row(sourceDurationMs: RecordingLimits.maxRecordingMs + 1)).state.overLimit)
        #expect(!model().state.overLimit)
    }

    // MARK: The overview strip

    @Test func theOverviewShowsEachPieceAndCutFromTheTrimStart() {
        let split = model(row(trimStartMs: 5000, trimEndMs: 45_000))
        split.seek(to: 15_000)
        split.addCut()
        split.seek(to: 30_000)
        #expect(split.overviewLengthMs == 40_000)
        #expect(split.overviewPlayheadMs == 25_000)
        #expect(split.overviewCutsMs == [10_000])
        #expect(
            split.overviewBands == [
                OverviewBand(startMs: 0, endMs: 10_000, color: SplitModel.State.pieceColor(0), selected: false),
                OverviewBand(startMs: 10_000, endMs: 40_000, color: SplitModel.State.pieceColor(1), selected: true),
            ])
    }

    @Test func theOverviewShowsNoBandBeforeTheFirstCut() {
        let split = placed(lineMs: 20_000)
        #expect(split.overviewBands.isEmpty)
        split.addCut()
        #expect(split.overviewBands.map(\.color) == [0, 1].map(SplitModel.State.pieceColor))
    }

    @Test func theOverviewMarksTheSelectedPieceOverTheOneHoldingTheLine() {
        let split = placed([10_000], lineMs: 20_000)
        #expect(split.overviewBands.map(\.selected) == [false, true])
        split.togglePiece(0)
        #expect(split.overviewBands.map(\.selected) == [true, false])
        split.togglePiece(0)
        #expect(split.overviewBands.map(\.selected) == [false, true])
    }

    @Test func pieceColorsCycleThroughEveryLoopColorSoNeighborsDiffer() {
        let colors = (0..<12).map(SplitModel.State.pieceColor)
        #expect(Set(colors.prefix(6)).count == LoopModel.colorCount)
        #expect(Array(colors.suffix(6)) == Array(colors.prefix(6)))
        for index in 1..<colors.count { #expect(colors[index] != colors[index - 1]) }
    }

    @Test func aTapOnTheOverviewMovesTheLineWithinTheRange() {
        let split = model(row(trimStartMs: 5000, trimEndMs: 45_000))
        split.overviewSeek(toFraction: 0.25)
        #expect(split.state.lineMs == 15_000)
        split.overviewSeek(toFraction: 1.5)
        #expect(split.state.lineMs == 45_000)
    }

    @Test func theOverviewBarsAreBuiltOncePerWidthAndPeaks() throws {
        let peaks = ShownPeaks(
            row(sourceDurationMs: 4000), peaks: Peaks(pointsPerSecond: 1, values: [10, 200, 40, 90]), peaksRev: nil)
        let bars = OverviewBars()
        let two = bars.levels(peaks, count: 2)
        #expect(two.count == 2)
        #expect(bars.levels(peaks, count: 2) == two)
        #expect(bars.levels(peaks, count: 4).count == 4)
        #expect(bars.levels(nil, count: 4).isEmpty)
    }

    // MARK: The line and the cuts

    @Test func movesTheLineInsideTheRange() {
        let split = model()
        drag(split, to: 99_000)
        #expect(split.state.lineMs == 60_000)
        drag(split, to: -5)
        #expect(split.state.lineMs == 0)
        split.nudge(by: WaveformSteps.nudgeMs)
        #expect(split.state.lineMs == 100)
    }

    @Test func addsACutAtTheLineAndSelectsItSoRemoveCutUndoesIt() {
        let split = placed(lineMs: 20_000)
        split.addCut()
        #expect(split.state.cuts == [20_000])
        #expect(split.state.selected == 0)
        split.pressMain()
        #expect(split.state.cuts.isEmpty)
        #expect(split.state.selected == nil)
    }

    @Test func keepsCutsAscendingAndSelectsTheNewOne() {
        let split = placed(lineMs: 40_000)
        split.addCut()
        split.seek(to: 10_000)
        split.addCut()
        #expect(split.state.cuts == [10_000, 40_000])
        #expect(split.state.selected == 0)
    }

    @Test func movesTheNewCutWithTheLineUntilSomethingLetsItGo() {
        let split = placed(lineMs: 20_000)
        split.addCut()
        drag(split, to: 25_000)
        #expect(split.state.cuts == [25_000])
        split.seek(to: 30_000)
        #expect(split.state.cuts == [25_000])
        #expect(split.state.lineMs == 30_000)
        #expect(split.state.selected == nil)
    }

    @Test func selectsACutTheLineComesToRestOn() {
        let split = placed([10_000], lineMs: 5000)
        drag(split, to: 10_000)
        #expect(split.state.selected == nil)
        split.endScrub()
        #expect(split.state.selected == 0)
        let away = placed([10_000], lineMs: 5000)
        away.beginScrub()
        away.endScrub()
        #expect(away.state.selected == nil)
    }

    @Test func refusesACutWithin1SecondOfAnEndOrAnotherCut() {
        #expect(!placed(lineMs: 999).canAddCut)
        #expect(placed(lineMs: 1000).canAddCut)
        #expect(!placed(lineMs: 59_001).canAddCut)
        #expect(!placed([20_000], lineMs: 20_500).canAddCut)
        #expect(placed([20_000], lineMs: 21_000).canAddCut)
        let refused = placed(lineMs: 500)
        refused.addCut()
        #expect(refused.state.cuts.isEmpty)
    }

    @Test func refusesThe50thCut() {
        let cuts = (1...Int64(RecordingLimits.maxSplitPieces - 2)).map { $0 * 1000 }
        let split = placed(cuts, lineMs: 80_000, highMs: 100_000)
        split.addCut()
        #expect(split.state.cuts.count == RecordingLimits.maxSplitPieces - 1)
        #expect(split.state.pieces.count == RecordingLimits.maxSplitPieces)
        split.seek(to: 90_000)
        #expect(!split.canAddCut)
        split.addCut()
        #expect(split.state.cuts.count == RecordingLimits.maxSplitPieces - 1)
    }

    @Test func selectsACutAndMovesTheLineToIt() {
        let split = placed([10_000, 30_000])
        split.select(1)
        #expect(split.state.selected == 1)
        #expect(split.state.lineMs == 30_000)
    }

    @Test func selectingTheSelectedCutLetsItGo() {
        let split = placed([10_000, 30_000])
        split.select(1)
        split.select(1)
        #expect(split.state.selected == nil)
        #expect(split.state.lineMs == 30_000)
    }

    @Test func stepsBetweenCuts() {
        let back = placed([10_000, 30_000], lineMs: 20_000)
        back.previous()
        #expect(back.state.selected == 0)
        #expect(back.state.lineMs == 10_000)
        back.previous()
        #expect(back.state.selected == 0)
        #expect(!back.canStepPrevious)
        let ahead = placed([10_000, 30_000], lineMs: 20_000)
        ahead.next()
        #expect(ahead.state.selected == 1)
        #expect(ahead.state.lineMs == 30_000)
        ahead.next()
        #expect(ahead.state.selected == 1)
        #expect(!ahead.canStepNext)
    }

    @Test func stepsPastTheCutTheLineSitsOnWithoutSelectingIt() {
        // Coming to rest on the cut selected it, and a tap on it lets it go.
        let ahead = placed([10_000, 30_000], lineMs: 10_000)
        ahead.select(0)
        #expect(ahead.state.selected == nil)
        ahead.next()
        #expect(ahead.state.selected == 1)
        let back = placed([10_000, 30_000], lineMs: 10_000)
        back.select(0)
        back.previous()
        #expect(back.state.selected == nil)
    }

    @Test func movesASelectedCutAndKeepsIt1SecondFromItsNeighbors() {
        func selected() -> SplitModel {
            let split = placed([10_000, 30_000])
            split.select(0)
            return split
        }
        let moved = selected()
        drag(moved, to: 15_000)
        #expect(moved.state.cuts == [15_000, 30_000])
        #expect(moved.state.lineMs == 15_000)
        let late = selected()
        drag(late, to: 45_000)
        #expect(late.state.cuts == [29_000, 30_000])
        let early = selected()
        drag(early, to: 100)
        #expect(early.state.cuts == [1000, 30_000])
        let nudged = selected()
        nudged.nudge(by: WaveformSteps.nudgeMs)
        #expect(nudged.state.cuts == [10_100, 30_000])
    }

    @Test func removesOnlyASelectedCut() {
        let split = placed([10_000, 30_000])
        split.pressMain()
        #expect(split.state.cuts == [10_000, 30_000])
        split.select(0)
        split.pressMain()
        #expect(split.state.cuts == [30_000])
        #expect(split.state.selected == nil)
    }

    @Test func refusesANewCutWhileOneIsSelected() {
        let split = placed([10_000])
        split.select(0)
        #expect(!split.canAddCut)
        split.pressMain()
        #expect(split.state.cuts.isEmpty)
    }

    // MARK: Moving one cut

    private let two = SplitModel.State(
        lowMs: 0, highMs: 60_000, lineMs: 20_000, cuts: [10_000, 30_000], overLimit: false)

    @Test func eachCutHasTheRoomThatKeepsEveryPieceAtLeast1Second() {
        #expect(two.cutRoom(for: 0) == (1000, 29_000))
        #expect(two.cutRoom(for: 1) == (11_000, 59_000))
    }

    @Test func movingACutLeavesTheLineWhereItIs() {
        let moved = two.applying(.moveCut(index: 0, ms: 15_000))
        #expect(moved.cuts == [15_000, 30_000])
        #expect(moved.lineMs == 20_000)
    }

    @Test func movedCutsStayOrderedAnd1SecondApart() {
        #expect(two.applying(.moveCut(index: 0, ms: 45_000)).cuts == [29_000, 30_000])
        #expect(two.applying(.moveCut(index: 1, ms: 2000)).cuts == [10_000, 11_000])
    }

    @Test func movedCutsStay1SecondInsideTheRange() {
        #expect(two.applying(.moveCut(index: 0, ms: -500)).cuts == [1000, 30_000])
        #expect(two.applying(.moveCut(index: 1, ms: 99_000)).cuts == [10_000, 59_000])
    }

    @Test func movingTheSelectedCutLetsItGo() {
        let selected = SplitModel.State(
            lowMs: 0, highMs: 60_000, lineMs: 10_000, cuts: [10_000, 30_000], selected: 0, overLimit: false)
        let moved = selected.applying(.moveCut(index: 0, ms: 12_000))
        #expect(moved.cuts == [12_000, 30_000])
        #expect(moved.selected == nil)
        #expect(moved.lineMs == 10_000)
        #expect(selected.applying(.moveCut(index: 1, ms: 32_000)).selected == 0)
    }

    @Test func movingAMissingCutChangesNothing() {
        #expect(two.applying(.moveCut(index: 5, ms: 15_000)) == two)
    }

    @Test func aCutHandleNudgeMovesThatCutAlone() {
        let split = placed([30_000], lineMs: 20_000)
        split.nudgeCut(0, by: WaveformSteps.nudgeMs)
        #expect(split.state.cuts == [30_100])
        #expect(split.state.lineMs == 20_000)
        #expect(split.cutValue(0) == RecordingScreenText.preciseTime(milliseconds: 30_100))
    }

    @Test func draggingACutHandleMovesThatCutHeld1SecondPastTheCutBefore() {
        let split = placed([10_000, 22_000], lineMs: 22_000)
        split.width = 300
        // 10 points a second, 30 s across, centered on the line at 22 s.
        split.beginCutDrag(1)
        split.dragCut(toX: 0, snapping: true)
        split.endCutDrag(atX: 0, snapping: true)
        #expect(split.state.cuts == [10_000, 11_000])
        #expect(split.state.lineMs == 22_000)
        #expect(split.state.selected == nil)
    }

    @Test func aCutHandleDragSnapsToTheLine() {
        let split = placed([30_000], lineMs: 20_000)
        split.width = 300
        // The line is at x 150; 152 is within the snap reach.
        split.beginCutDrag(0)
        split.dragCut(toX: 152, snapping: true)
        #expect(split.state.cuts == [20_000])
        split.dragCut(toX: 152, snapping: false)
        #expect(split.state.cuts == [20_200])
        split.endCutDrag(atX: 152, snapping: false)
    }

    @Test func aPinchPutsBackTheCutHandleDragItTookOver() {
        let split = placed([30_000], lineMs: 20_000)
        split.width = 300
        split.beginCutDrag(0)
        split.dragCut(toX: 200, snapping: false)
        #expect(split.state.cuts == [25_000])
        split.pinch(2)
        #expect(split.state.cuts == [30_000])
        split.dragCut(toX: 100, snapping: false)
        #expect(split.state.cuts == [30_000])
        split.endCutDrag(atX: 100, snapping: false)
        split.endPinch()
        #expect(split.state.cuts == [30_000])
    }

    @Test func aCutHandleDragTheSystemTookAwayPutsTheCutBack() {
        let split = placed([30_000], lineMs: 20_000)
        split.width = 300
        split.beginCutDrag(0)
        split.dragCut(toX: 200, snapping: false)
        split.cancelCutDrag()
        #expect(split.state.cuts == [30_000])
        #expect(split.cutDrag == nil)
    }

    // MARK: Selecting a piece

    @Test func aTapOnAPieceSelectsItAndASecondLetsItGo() {
        let split = placed([10_000], lineMs: 20_000)
        split.width = 300
        // x 0 is 5 s, in the first piece.
        split.tapPiece(atX: 0)
        #expect(split.selectedPiece == 0)
        split.tapPiece(atX: 0)
        #expect(split.selectedPiece == nil)
    }

    @Test func noPieceIsSelectedBeforeTheFirstCut() {
        let split = placed(lineMs: 20_000)
        split.togglePiece(0)
        #expect(split.selectedPiece == nil)
    }

    @Test func seekingAddingOrRemovingACutLetsGoOfTheSelectedPiece() {
        let split = placed([10_000], lineMs: 20_000)
        split.togglePiece(0)
        split.seek(to: 30_000)
        #expect(split.selectedPiece == nil)
        split.togglePiece(0)
        split.addCut()
        #expect(split.selectedPiece == nil)
        split.togglePiece(0)
        split.pressMain()
        #expect(split.state.cuts == [10_000])
        #expect(split.selectedPiece == nil)
    }

    // MARK: Pieces

    @Test func piecesCoverTheRangeEndToEnd() {
        let split = placed([10_000, 30_000])
        #expect(
            split.state.pieces == [
                .init(startMs: 0, endMs: 10_000), .init(startMs: 10_000, endMs: 30_000),
                .init(startMs: 30_000, endMs: 60_000),
            ])
    }

    @Test func findsThePieceHoldingATime() {
        let split = placed([10_000, 30_000])
        #expect(split.state.pieceIndex(at: 0) == 0)
        #expect(split.state.pieceIndex(at: 9999) == 0)
        #expect(split.state.pieceIndex(at: 10_000) == 1)
        #expect(split.state.pieceIndex(at: 60_000) == 2)
    }

    // MARK: Save gating

    @Test func saveNeedsACut() {
        #expect(!placed().state.canSave)
        #expect(placed([20_000]).state.canSave)
    }

    @Test func saveNeedsEveryPieceAtLeast1Second() {
        #expect(!SplitModel.State(lowMs: 0, highMs: 60_000, lineMs: 0, cuts: [500], overLimit: false).canSave)
    }

    @Test func refusesARecordingOver3HoursWhileAPieceIsOver3Hours() {
        let limit = RecordingLimits.maxRecordingMs
        let long = SplitModel.State(lowMs: 0, highMs: limit * 2, lineMs: 0, cuts: [limit + 1000], overLimit: true)
        #expect(!long.canSave)
        #expect(SplitModel.State(lowMs: 0, highMs: limit * 2, lineMs: 0, cuts: [limit], overLimit: true).canSave)
    }

    @Test func allowsLongPiecesWhenTheRecordingIsWithinTheLimit() {
        let limit = RecordingLimits.maxRecordingMs
        #expect(SplitModel.State(lowMs: 0, highMs: limit, lineMs: 0, cuts: [5000], overLimit: false).canSave)
    }

    @Test func refusesMoreThan50Pieces() {
        let cuts = (1...Int64(RecordingLimits.maxSplitPieces)).map { $0 * 1000 }
        #expect(!SplitModel.State(lowMs: 0, highMs: 100_000, lineMs: 0, cuts: cuts, overLimit: false).canSave)
    }

    // MARK: Playback

    /// A model attached to `audio`, a 60 s window from the row's start.
    private func playing(_ audio: FakeAudio, at seconds: TimeInterval) -> SplitModel {
        audio.duration = 60
        let split = model()
        split.attach(audio)
        split.togglePlay()
        audio.elapsed = seconds
        split.follow(playing: true, elapsed: seconds)
        return split
    }

    @Test func opensTheLineWherePracticeLeftThePlayhead() {
        let audio = FakeAudio()
        audio.elapsed = 12
        let split = model()
        split.attach(audio)
        #expect(split.state.lineMs == 12_000)
    }

    @Test func aPausedEditMovesThePlayerToTheLine() {
        let audio = FakeAudio()
        let split = model()
        split.attach(audio)
        drag(split, to: 20_000)
        #expect(audio.elapsed == 20)
    }

    @Test func playStartsAtTheLineAndLetsGoOfASelectedCut() {
        let audio = FakeAudio()
        let split = model()
        split.attach(audio)
        split.seek(to: 20_000)
        split.addCut()
        split.togglePlay()
        #expect(audio.isPlaying)
        #expect(audio.elapsed == 20)
        #expect(split.state.selected == nil)
    }

    /// A model attached to `audio` with `cuts`, paused with the line at `lineMs`, that notes each
    /// end of playback it asks for.
    private func attached(
        _ audio: FakeAudio, cuts: [Int64], lineMs: Int64, ends: PlaybackEnds
    ) -> SplitModel {
        audio.duration = 60
        audio.elapsed = TimeInterval(lineMs) / 1000
        let split = placed(cuts, lineMs: lineMs)
        split.attach(audio) { ends.made.append($0) }
        return split
    }

    /// Plays on to the end the model asked for, as the player does, which goes back to its start.
    private func playToEnd(_ split: SplitModel, _ audio: FakeAudio, ends: PlaybackEnds) throws {
        let end = try #require(ends.made.last ?? nil)
        audio.elapsed = TimeInterval(end) / 1000 - 0.1
        split.follow(playing: true, elapsed: audio.elapsed)
        audio.end(.finished)
        audio.elapsed = 0
        split.follow(playing: false, elapsed: 0)
    }

    @Test func playEndsThePlayersPlaybackAtTheNextCut() {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000, 20_000], lineMs: 5000, ends: ends)
        split.togglePlay()
        #expect(audio.isPlaying)
        #expect(ends.made == [10_000])
        // Pausing gives the player back its whole range.
        split.togglePlay()
        #expect(ends.made == [10_000, nil])
    }

    @Test func playStopsOnTheNextCutAndTheNextPlayGoesOnToTheCutAfter() throws {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000, 20_000], lineMs: 5000, ends: ends)
        split.togglePlay()
        try playToEnd(split, audio, ends: ends)
        #expect(!audio.isPlaying)
        #expect(audio.elapsed == 10)
        #expect(split.state.lineMs == 10_000)
        #expect(ends.made.last == .some(nil))
        // Stopping on the cut selects it, as any stop on a cut does.
        #expect(split.state.selected == 0)

        split.togglePlay()
        #expect(audio.isPlaying)
        #expect(audio.elapsed == 10)
        #expect(ends.made.last == 20_000)
        try playToEnd(split, audio, ends: ends)
        #expect(split.state.lineMs == 20_000)
    }

    @Test func playAfterTheLastCutPlaysToTheRangeEnd() {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000], lineMs: 50_000, ends: ends)
        split.togglePlay()
        // The range end is the player's own end.
        #expect(ends.made == [nil])
        split.follow(playing: true, elapsed: 59.9)
        audio.end(.finished)
        audio.elapsed = 0
        split.follow(playing: false, elapsed: 0)
        #expect(split.state.lineMs == 60_000)
    }

    @Test func withAPieceSelectedPlayPlaysThatPieceFromItsStartToItsEnd() throws {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000, 20_000], lineMs: 5000, ends: ends)
        split.togglePiece(1)
        split.togglePlay()
        #expect(audio.isPlaying)
        #expect(audio.elapsed == 10)
        #expect(ends.made == [20_000])
        try playToEnd(split, audio, ends: ends)
        #expect(split.state.lineMs == 20_000)
        #expect(split.selectedPiece == 1)
    }

    @Test func movingTheCutPlaybackIsBoundForMovesTheEnd() {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000], lineMs: 5000, ends: ends)
        split.togglePlay()
        split.moveCut(0, to: 15_000)
        #expect(ends.made == [10_000, 15_000])
    }

    @Test func aSkipWhilePlayingEndsAtTheEndOfThePieceItLandsIn() {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000, 30_000], lineMs: 5000, ends: ends)
        split.togglePlay()
        split.skip(by: 15_000)
        #expect(audio.elapsed == 20)
        #expect(ends.made == [10_000, 30_000])
        // After a skip back into the first piece, playback ends at its cut again.
        split.skip(by: -15_000)
        #expect(ends.made == [10_000, 30_000, 10_000])
    }

    @Test func leavingGivesThePlayerBackItsWholeRange() {
        let audio = FakeAudio()
        let ends = PlaybackEnds()
        let split = attached(audio, cuts: [10_000], lineMs: 5000, ends: ends)
        split.togglePlay()
        split.leave()
        #expect(ends.made.last == .some(nil))
    }

    @Test func aCutMadeWhilePlayingLandsAtThePlayheadAndPlaysOn() {
        let audio = FakeAudio()
        let split = playing(audio, at: 7.5)
        split.addCut()
        #expect(split.state.cuts == [7500])
        #expect(audio.isPlaying)
    }

    @Test func editingWhilePlayingStartsFromThePlayhead() {
        let audio = FakeAudio()
        let split = playing(audio, at: 7.5)
        split.nudge(by: WaveformSteps.nudgeMs)
        #expect(!audio.isPlaying)
        #expect(split.state.lineMs == 7600)
    }

    @Test func thePausesOwnReportCannotUndoAnEdit() {
        let audio = FakeAudio()
        let split = playing(audio, at: 7.5)
        split.nudge(by: WaveformSteps.nudgeMs)
        // The player's reading of the pause arrives after the edit.
        split.follow(playing: false, elapsed: 7.5)
        #expect(split.state.lineMs == 7600)
    }

    @Test func aPauseFromElsewhereLeavesTheLineWherePlaybackGotTo() {
        let audio = FakeAudio()
        let split = playing(audio, at: 7.5)
        audio.pause()
        split.follow(playing: false, elapsed: 7.5)
        #expect(split.state.lineMs == 7500)
    }

    @Test func playingToTheEndLeavesTheLineAtTheEnd() {
        let audio = FakeAudio()
        let split = playing(audio, at: 59.9)
        audio.end(.finished)
        audio.elapsed = 0
        split.follow(playing: false, elapsed: 0)
        #expect(split.state.lineMs == 60_000)
    }

    @Test func skippingWhilePlayingMovesOnlyThePlayer() {
        let audio = FakeAudio()
        let split = playing(audio, at: 20)
        split.skip(by: -15_000)
        #expect(audio.elapsed == 5)
        #expect(audio.isPlaying)
    }

    @Test func aPauseFromElsewhereAfterASkipToTheStartLeavesTheLineAtTheStart() {
        let audio = FakeAudio()
        let split = playing(audio, at: 10)
        split.skip(by: -15_000)
        #expect(audio.elapsed == 0)
        audio.pause()
        split.follow(playing: false, elapsed: 0)
        #expect(split.state.lineMs == 0)
    }

    @Test func aSidewaysScrollMovesTheLineAndComesToRest() {
        let split = placed([10_000], lineMs: 9000)
        split.scrub(byScrollMs: 1000)
        #expect(split.state.lineMs == 10_000)
        #expect(split.state.selected == 0)
    }

    @Test func aSidewaysScrollWhilePlayingStartsFromThePlayhead() {
        let audio = FakeAudio()
        let split = playing(audio, at: 7.5)
        split.scrub(byScrollMs: -500)
        #expect(!audio.isPlaying)
        #expect(split.state.lineMs == 7000)
    }

    @Test func aPinchPutsBackTheDragItTookOver() {
        let split = placed(lineMs: 20_000)
        split.width = 400
        split.beginScrub()
        split.scrub(byMs: 3000)
        #expect(split.state.lineMs == 23_000)
        split.pinch(2)
        #expect(split.state.lineMs == 20_000)
        split.scrub(byMs: 5000)
        #expect(split.state.lineMs == 20_000)
        split.endScrub()
        split.endPinch()
    }

    @Test func aDragAfterOneAPinchTookOverScrubsAgain() {
        let split = placed(lineMs: 20_000)
        split.width = 400
        split.beginScrub()
        split.pinch(2)
        split.endPinch()
        split.endScrub()
        split.beginScrub()
        split.scrub(byMs: 3000)
        #expect(split.state.lineMs == 23_000)
        split.endScrub()
    }

    @Test func aToggleBoundToACutSelectsAndLetsGo() {
        let split = placed([20_000], lineMs: 40_000)
        #expect(!split[cutSelected: 0])
        split[cutSelected: 0] = true
        #expect(split[cutSelected: 0])
        split[cutSelected: 0] = false
        #expect(!split[cutSelected: 0])
    }

    @Test func zoomsBetweenTheWholeRangeAndThePeaksResolution() throws {
        let split = model()
        #expect(split.pointsPerSecond == nil)
        split.width = 300
        // Opens on 30 s across the strip.
        #expect(try #require(split.pointsPerSecond) == 10)
        split.zoom(by: 1000)
        #expect(split.pointsPerSecond == PracticeZoom.maxPointsPerSecond)
        #expect(!split.canZoomIn)
        split.zoom(by: 0.0001)
        #expect(split.pointsPerSecond == 5)
        #expect(!split.canZoomOut)
    }

    // MARK: Lifecycle and save

    @Test func holdsNormalSpeedAndPitchWhileOpen() {
        let split = model()
        split.open()
        split.leave()
        #expect(holds.made == [PlaybackSettings(speedPercent: 100, pitchCents: 0), nil])
    }

    @Test func saveWritesOneSplitAndSendsRecordingSplit() async throws {
        let split = placed([20_000, 40_000])
        split.open()
        split.isConfirming = true
        #expect(try await split.save())
        #expect(writes.made == [.init(id: "r1", cuts: [20_000, 40_000])])
        #expect(!split.isConfirming)
        #expect(split.hasLeft)
        #expect(holds.made.last == .some(nil))
        #expect(
            sink.captures == [
                .init(
                    name: "recording_split",
                    properties: [
                        "recording_id": .string("r1"), "piece_count": .string(Bucket.count(3)),
                        "over_limit": .bool(false),
                    ])
            ])
        #expect(try await split.save() == false)
        #expect(writes.made.count == 1)
    }

    @Test func aFailedSaveStaysToBeTriedAgainAndSendsNothing() async throws {
        let split = placed([20_000])
        writes.refusal = URLError(.notConnectedToInternet)
        await #expect(throws: URLError.self) { try await split.save() }
        #expect(!split.hasLeft)
        #expect(sink.captures.isEmpty)
        writes.refusal = nil
        #expect(try await split.save())
    }

    @Test func savesNothingWithoutACut() async throws {
        #expect(try await placed().save() == false)
        #expect(writes.made.isEmpty)
    }

    @Test func givesWayToATrimFromElsewhere() async throws {
        let split = placed([20_000])
        #expect(!split.follow(row()))
        #expect(split.follow(row(trimStartMs: 5000)))
        #expect(try await split.save() == false)
        #expect(writes.made.isEmpty)
    }

    @Test func itsOwnWriteLandingIsNotATrimFromElsewhere() async throws {
        let split = placed([20_000])
        writes.during = { #expect(!split.follow(row(trimEndMs: 20_000))) }
        #expect(try await split.save())
        #expect(!split.isStale)
    }
}

@Suite struct SplitTextTests {
    private func recording(
        state: String = "ready", splitFromID: String? = nil, splitID: String? = nil, splitCompletedID: String? = nil
    ) -> Recording {
        Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: state, sourceDurationMs: 60_000,
            splitFromID: splitFromID, splitID: splitID, splitCompletedID: splitCompletedID)
    }

    @Test func splitIsDisabledForTrimsReasonsFirst() {
        let capturing = RecordingFile(id: "r1", localState: .capturing)
        #expect(
            RecordingScreenText.splitDisabledReason(recording(), file: capturing, audio: .loaded)
                == RecordingScreenText.trimWhileRecording)
    }

    @Test func splitIsDisabledWhileASplitIsIncompleteOrAPieceIsNotReady() {
        #expect(RecordingScreenText.splitDisabledReason(recording(), file: nil, audio: .loaded) == nil)
        #expect(
            RecordingScreenText.splitDisabledReason(recording(splitID: "s1"), file: nil, audio: .loaded)
                == RecordingScreenText.splitBusy)
        #expect(
            RecordingScreenText.splitDisabledReason(
                recording(splitID: "s1", splitCompletedID: "s1"), file: nil, audio: .loaded) == nil)
        #expect(
            RecordingScreenText.splitDisabledReason(
                recording(state: "processing", splitFromID: "p1"), file: nil, audio: .loaded)
                == RecordingScreenText.splitBusy)
    }

    @Test func aRecordingOver3HoursSaysToSplitItAndAFailedPieceSaysItCouldNotBeSplit() {
        let long = RecordingFile(
            id: "r1", localState: .captured, localDurationMs: RecordingLimits.maxRecordingMs + 1)
        #expect(RecordingText.fileState(recording(state: "pending_upload"), file: long) == RecordingText.mustSplit)
        let large = RecordingFile(id: "r1", localState: .captured, bytes: 501, localDurationMs: 60_000)
        #expect(
            RecordingText.fileState(
                recording(state: "pending_upload"), file: large,
                uploadLimits: StorageUsage(usedBytes: 0, quotaBytes: 0, maxFileBytes: 500))
                == RecordingText.mustSplit)
        #expect(RecordingText.fileState(recording(state: "pending_upload"), file: large) != RecordingText.mustSplit)
        #expect(
            RecordingText.fileState(recording(state: "failed", splitFromID: "p1"), file: nil)
                == RecordingText.splitFailed)
        #expect(RecordingText.fileState(recording(state: "failed"), file: nil) == RecordingText.processFailed)
    }

    @Test func deleteWaitsOnlyWhileAPieceSplitFromTheRecordingWaitsForItsCut() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let parent = recording(splitID: "s1")
        let waiting = Recording(
            id: "p1", tuneID: nil, source: "microphone", addedAt: noon, state: "processing", splitFromID: "r1",
            createdBySplitID: "s1")
        try await store.write { writer in
            try writer.put(parent)
            try writer.put(waiting)
        }
        func reason() async throws -> String? {
            let views = try await store.read { db in try RecordingsModel.fetch(db).views }
            let view = try #require(views.first { $0.id == "r1" })
            let screen = try #require(try await store.read { db in try ScreenRows.fetch(db, id: "r1") })
            #expect(screen.view.holdsSplitAudio == view.holdsSplitAudio)
            return RecordingScreenText.deleteDisabledReason(view)
        }
        #expect(try await reason() == RecordingScreenText.deleteWhileSplitting)

        var failed = parent
        failed.state = "failed"
        try await store.write { [failed] writer in try writer.put(failed) }
        // A failed parent has nothing to cut its pieces from.
        #expect(try await reason() == nil)

        var cut = waiting
        cut.state = "ready"
        try await store.write { [cut, parent] writer in
            try writer.put(parent)
            try writer.put(cut)
        }
        // An uncompleted split with no piece waiting holds nothing.
        #expect(try await reason() == nil)
    }

    @Test func theMenuOffersSplitAfterTrimAndDisablesDeleteDuringASplit() {
        let items = RecordingMenuItem.items(
            inTune: false, trimDisabledReason: nil, splitDisabledReason: RecordingScreenText.splitBusy,
            deleteDisabledReason: RecordingScreenText.deleteWhileSplitting)
        #expect(
            items == [
                .trim(disabledReason: nil), .split(disabledReason: RecordingScreenText.splitBusy), .edit, .addToTune,
                .delete(disabledReason: RecordingScreenText.deleteWhileSplitting),
            ])
        #expect(RecordingMenuItem.split(disabledReason: nil).label == RecordingScreenText.split)
        #expect(RecordingMenuItem.split(disabledReason: nil).systemImage == "rectangle.split.3x1")
        #expect(items.last?.disabledReason == RecordingScreenText.deleteWhileSplitting)
    }

    @Test func aRowThatMustSplitOffersSplitFirstInItsMenu() {
        let menu = RecordingRowAction.menu(
            filed: false, canAddToTune: true, canGoToTune: false, canPin: false, originSite: nil, canSplit: true)
        #expect(menu == [.split, .edit, .addToTune, .delete])
    }

    @Test func aRowThatMustSplitSwipesDeleteSplitAndOneFilingAction() {
        let unfiled = RecordingRowAction.swipe(
            filed: false, canAddToTune: true, canGoToTune: false, canPin: false, canSplit: true)
        #expect(unfiled == [.delete, .split, .addToTune])
        let filed = RecordingRowAction.swipe(
            filed: true, canAddToTune: true, canGoToTune: true, canPin: false, canSplit: true)
        #expect(filed == [.delete, .split, .removeFromTune])
        // A tune page's row: filed under the tune, with the pin, and no Go to tune.
        let onTune = RecordingRowAction.swipe(
            filed: true, canAddToTune: false, canGoToTune: false, canPin: true, canSplit: true)
        #expect(onTune == [.delete, .split, .removeFromTune])
        let unfilable = RecordingRowAction.swipe(
            filed: false, canAddToTune: false, canGoToTune: false, canPin: false, canSplit: true)
        #expect(unfilable == [.delete, .split])
    }
}
