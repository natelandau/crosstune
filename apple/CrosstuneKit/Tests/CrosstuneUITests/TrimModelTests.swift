import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func row(
    id: String = "r1", trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 60_000,
    speedPercent: Int = 75, pitchCents: Int = 200
) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, label: nil, state: "ready",
        sourceDurationMs: sourceDurationMs, trimStartMs: trimStartMs, trimEndMs: trimEndMs,
        speedPercent: speedPercent, pitchCents: pitchCents)
}

/// Notes each trim the model writes, and can refuse them.
@MainActor
private final class TrimWrites {
    struct Made: Equatable {
        let id: String
        let start: Int64
        let end: Int64?
    }

    private(set) var made: [Made] = []
    var refusal: (any Error)?
    /// Runs while the write is under way, as a row landing from elsewhere would.
    var during: (@MainActor () -> Void)?

    func write(_ id: String, _ start: Int64, _ end: Int64?) async throws {
        during?()
        if let refusal { throw refusal }
        made.append(Made(id: id, start: start, end: end))
    }
}

/// Notes what the model asks the player to hold.
@MainActor
private final class Holds {
    private(set) var made: [PlaybackSettings?] = []

    func hold(_ settings: PlaybackSettings?) {
        made.append(settings)
    }
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct TrimModelTests {
    private let writes = TrimWrites()
    private let holds = Holds()

    private func model(_ recording: Recording = row(), file: RecordingFile? = nil) -> TrimModel {
        TrimModel(recording: recording, file: file, write: writes.write, hold: holds.hold)
    }

    /// A model on a 60 s untrimmed row with its handles at `start` and `end`, focused on `focus`.
    private func placed(start: Int64 = 0, end: Int64 = 60_000, focus: TrimModel.Handle = .start) -> TrimModel {
        let trim = model()
        if end != 60_000 { trim.drag(.end, to: Double(end)) }
        if start != 0 { trim.drag(.start, to: Double(start)) }
        trim.select(focus)
        return trim
    }

    /// A row the trim pipeline has not reached knows its end only from its playback file.
    @Test func startsARowWithOnlyAPlaybackLengthOnThatLength() {
        var playbackOnly = row(sourceDurationMs: nil)
        playbackOnly.durationMs = 184_000
        let trim = model(playbackOnly)
        #expect(trim.bounds == 0...184_000)
        #expect(trim.end == 184_000)
    }

    @Test func startsAnUntrimmedRowOnTheWholeSource() {
        let trim = model()
        #expect(trim.bounds == 0...60_000)
        #expect(trim.start == 0)
        #expect(trim.end == 60_000)
        #expect(trim.focus == .start)
    }

    @Test func handleSecondsCountFromTheStartOfTheBounds() {
        let trim = model(row(trimStartMs: 5000, trimEndMs: 40_000))
        #expect(trim.handleSeconds(7500) == 2.5)
        #expect(trim.sourceMs(handleSeconds: 2.5004) == 7500)
        #expect(trim.sourceMs(handleSeconds: trim.handleSeconds(12_345)) == 12_345)
    }

    @Test func startsATrimmedRowOnItsCurrentTrim() {
        let trim = model(row(trimStartMs: 5000, trimEndMs: 40_000))
        #expect(trim.bounds == 5000...40_000)
        #expect(trim.start == 5000)
        #expect(trim.end == 40_000)
    }

    @Test func fallsBackToTheFilesOwnLengthWhenTheRowHasNone() {
        let file = RecordingFile(id: "r1", localState: .captured, localDurationMs: 30_000)
        #expect(model(row(sourceDurationMs: nil), file: file).bounds == 0...30_000)
    }

    @Test func opensTheDetailOnAboutTenSecondsNeverPastTheWholeRange() {
        #expect(model().zoom == 6)
        #expect(model(row(sourceDurationMs: 4000)).zoom == 1)
    }

    @Test(arguments: [
        (TrimModel.Handle.start, -500.0, Int64(0), Int64(60_000)),
        (.end, 70_000, 0, 60_000),
        (.start, 59_500, 59_000, 60_000),
        (.end, 200, 0, 1000),
    ])
    func dragClampsToTheBoundsAndTheShortestRange(handle: TrimModel.Handle, ms: Double, start: Int64, end: Int64) {
        let trim = model()
        trim.drag(handle, to: ms)
        #expect([trim.start, trim.end] == [start, end])
        #expect(trim.focus == handle)
    }

    @Test func dragMovesAHandleToWhereItIsDropped() {
        let trim = model()
        trim.drag(.end, to: 42_000.4)
        #expect(trim.end == 42_000)
    }

    @Test(arguments: [(Int64(100), Int64(10_100)), (-100, 9900), (1000, 11_000), (-1000, 9000)])
    func nudgeMovesTheHandle(delta: Int64, expected: Int64) {
        let trim = placed(start: 10_000)
        trim.nudge(.start, by: delta)
        #expect(trim.start == expected)
    }

    @Test func nudgeStopsAtTheOtherHandleLessASecond() {
        let trim = placed(start: 10_000, end: 11_050)
        trim.nudge(.start, by: 100)
        #expect(trim.start == 10_050)
    }

    @Test func selectChangesOnlyWhichHandleTheDetailFollows() {
        let trim = model()
        trim.select(.end)
        #expect(trim.focus == .end)
        #expect([trim.start, trim.end] == [0, 60_000])
        #expect(trim.isChanged == false)
    }

    @Test func zoomStaysBetweenTheWholeRangeAndTheShortestDetail() {
        let trim = model()
        trim.zoom(by: 0.5)
        #expect(trim.zoom == 3)
        trim.zoom(by: 2)
        #expect(trim.zoom == 6)
        trim.zoom(by: 0.1)
        #expect(trim.zoom == 1)
        #expect(trim.canZoomOut == false)
        trim.zoom(by: 1000)
        #expect(trim.zoom == 60_000 / Double(TrimModel.minDetailMs))
        #expect(trim.canZoomIn == false)
    }

    @Test func aShortRangeCannotZoomAtAll() {
        let trim = model(row(sourceDurationMs: 1500))
        #expect(trim.canZoomIn == false)
        #expect(trim.canZoomOut == false)
        #expect(trim.detailWindow() == 0...1500)
    }

    @Test func theDetailWindowCentersOnTheFocusedHandleInsideTheBounds() {
        #expect(placed(start: 30_000).detailWindow() == 25_000...35_000)
        #expect(placed(start: 1000).detailWindow() == 0...10_000)
        #expect(placed(focus: .end).detailWindow() == 50_000...60_000)
        #expect(placed(start: 30_000).detailWindow(center: 45_000) == 40_000...50_000)
    }

    @Test func isChangedIsFalseUntilAHandleMoves() {
        let trim = model()
        #expect(trim.isChanged == false)
        trim.drag(.start, to: 0)
        #expect(trim.isChanged == false)
        trim.nudge(.start, by: 100)
        #expect(trim.isChanged)
        trim.nudge(.start, by: -100)
        #expect(trim.isChanged == false)
        trim.drag(.end, to: 59_000)
        #expect(trim.isChanged)
    }

    @Test func writesAnEndAtTheSourceEndAsNilWhenTheRowHadNone() {
        #expect(placed(start: 5000).patch == TrimModel.Patch(trimStartMs: 5000, trimEndMs: nil))
        #expect(placed(end: 50_000).patch == TrimModel.Patch(trimStartMs: 0, trimEndMs: 50_000))
    }

    @Test func keepsASetEndWhenTheEndHandleStaysOnIt() {
        let trim = model(row(trimEndMs: 60_000))
        trim.drag(.start, to: 5000)
        #expect(trim.patch == TrimModel.Patch(trimStartMs: 5000, trimEndMs: 60_000))
    }

    @Test func saveWritesOneChangeAtTheHandlesExactlyAndLeaves() async throws {
        let trim = model(row(trimStartMs: 2000, trimEndMs: nil))
        trim.open()
        trim.drag(.start, to: 12_345.4)
        trim.drag(.end, to: 50_001)
        trim.isConfirming = true
        try await trim.save()
        #expect(writes.made == [.init(id: "r1", start: 12_345, end: 50_001)])
        #expect(trim.hasLeft)
        #expect(trim.isConfirming == false)
        #expect(holds.made.last == .some(nil))

        // A second press, or a Trim tapped once the screen has gone, writes nothing more.
        try await trim.save()
        #expect(writes.made.count == 1)
    }

    @Test func saveWithNoChangeCloses() {
        let trim = model()
        #expect(trim.pressSave() == .close)
        #expect(trim.isConfirming == false)
        trim.drag(.start, to: 4000)
        #expect(trim.pressSave() == .confirm)
        #expect(trim.isConfirming)
    }

    @Test func saveWritesNothingUntilAHandleMoves() async throws {
        let trim = model()
        try await trim.save()
        #expect(writes.made.isEmpty)
    }

    @Test func aFailedSaveStaysOpenToTryAgain() async throws {
        let trim = model()
        trim.open()
        trim.drag(.start, to: 3000)
        writes.refusal = URLError(.cannotOpenFile)
        await #expect(throws: URLError.self) { try await trim.save() }
        #expect(trim.isSaving == false)
        #expect(trim.hasLeft == false)
        #expect(holds.made.count == 1)
        writes.refusal = nil
        try await trim.save()
        #expect(writes.made == [.init(id: "r1", start: 3000, end: nil)])
    }

    @Test func holdsNormalSpeedAndPitchUntilItLeavesOnce() {
        let trim = model()
        trim.open()
        #expect(holds.made == [.normal])
        trim.leave()
        trim.leave()
        #expect(holds.made == [.normal, nil])
    }

    @Test func aTrimFromElsewhereIsSeenButNotItsOwnWrite() async throws {
        let trim = model(row(trimStartMs: 1000, trimEndMs: 30_000))
        #expect(trim.follow(row(trimStartMs: 1000, trimEndMs: 30_000, speedPercent: 50)) == false)
        // Another recording's row says nothing about this one.
        #expect(trim.follow(row(id: "r2", trimStartMs: 2000, trimEndMs: 30_000)) == false)
        #expect(trim.mustGiveWay == false)

        trim.drag(.start, to: 4000)
        try await trim.save()
        #expect(trim.follow(row(trimStartMs: 4000, trimEndMs: 30_000)) == false)

        let other = model(row(trimStartMs: 1000, trimEndMs: 30_000))
        other.drag(.end, to: 20_000)
        #expect(other.follow(row(trimStartMs: 1000, trimEndMs: nil)))
        #expect(other.mustGiveWay)
        #expect(try await other.save() == false)
        #expect(writes.made.count == 1)
    }

    @Test func aTrimFromElsewhereDuringAFailedSaveLeavesWithoutWritingAgain() async throws {
        let trim = model(row(trimStartMs: 1000, trimEndMs: 30_000))
        trim.open()
        trim.drag(.start, to: 4000)
        var seenWhileSaving: Bool?
        writes.during = { seenWhileSaving = trim.follow(row(trimStartMs: 500, trimEndMs: 40_000)) }
        writes.refusal = URLError(.cannotOpenFile)
        await #expect(throws: URLError.self) { try await trim.save() }
        // Noted mid-write, but the screen waits for the write to finish before giving way.
        #expect(seenWhileSaving == false)
        #expect(trim.mustGiveWay)

        writes.during = nil
        writes.refusal = nil
        #expect(try await trim.save() == false)
        #expect(writes.made.isEmpty)
    }

    @Test func itsOwnWriteLandingMidSaveIsNotATrimFromElsewhere() async throws {
        let trim = model(row(trimStartMs: 1000, trimEndMs: 30_000))
        trim.drag(.start, to: 4000)
        writes.during = { _ = trim.follow(row(trimStartMs: 4000, trimEndMs: 30_000)) }
        writes.refusal = URLError(.cannotOpenFile)
        await #expect(throws: URLError.self) { try await trim.save() }
        #expect(trim.mustGiveWay == false)
    }

    @Test func leavingForATrimFromElsewhereDismissesTheQuestionAndWritesNothing() async throws {
        let trim = model()
        trim.open()
        trim.drag(.start, to: 4000)
        trim.isConfirming = true
        trim.leave()
        #expect(trim.isConfirming == false)
        try await trim.save()
        #expect(writes.made.isEmpty)
        #expect(holds.made.last == .some(nil))
    }

    @Test func aPinchPutsBackWhatItsFirstFingerMoved() {
        let trim = model()
        trim.select(.end)
        trim.moveHandles(startMs: 8000, endMs: 60_000, holdsDetail: true)
        #expect(trim.focus == .start)
        #expect(trim.start == 8000)
        trim.pinch(2)
        #expect(trim.start == 0)
        #expect(trim.zoom == 12)
        // The finger's later moves come to nothing until its drag ends.
        trim.moveHandles(startMs: 9000, endMs: 60_000, holdsDetail: true)
        #expect(trim.start == 0)
        trim.pinch(0.5)
        #expect(trim.zoom == 3)
        trim.endPinch()
        trim.commitHandles()
        #expect(trim.handleDrag == nil)

        // A pinch with no finger on a handle, as a trackpad makes, moves no handle.
        trim.drag(.start, to: 5000)
        trim.pinch(2)
        #expect(trim.start == 5000)
        trim.endPinch()
    }

    @Test func theDetailFollowsTheZoomOnceAPinchEndsADrag() {
        let trim = model()
        trim.moveHandles(startMs: 8000, endMs: 60_000, holdsDetail: true)
        let held = trim.shownDetailWindow
        #expect(held == trim.handleDrag?.heldWindow)
        trim.pinch(2)
        #expect(trim.shownDetailWindow == trim.detailWindow())
        #expect(trim.shownDetailWindow != held)
        trim.endPinch()
    }

    @Test func aPinchCancelsTheSeekItsFirstFingerBegan() {
        let trim = model()
        trim.beginSeek()
        #expect(trim.seekCancelled == false)
        trim.pinch(2)
        #expect(trim.seekCancelled)
        trim.endPinch()
        trim.endSeek()
        trim.beginSeek()
        #expect(trim.seekCancelled == false)
    }

    @Test func aDragInTheDetailHoldsItsWindowUntilItEnds() {
        let trim = model()
        let opening = trim.detailWindow()
        trim.moveHandles(startMs: 0, endMs: 55_000, holdsDetail: true)
        #expect(trim.focus == .end)
        #expect(trim.shownDetailWindow == opening)
        trim.commitHandles()
        #expect(trim.shownDetailWindow == trim.detailWindow())
        #expect(trim.shownDetailWindow != opening)
    }

    @Test func aDragInTheOverviewLetsTheDetailFollow() {
        let trim = model()
        trim.moveHandles(startMs: 0, endMs: 55_000, holdsDetail: false)
        #expect(trim.shownDetailWindow == trim.detailWindow(center: 55_000))
        trim.commitHandles()
    }

    @Test func keyStepsMoveTheHandleWithoutHoldingTheDetail() {
        let trim = model()
        trim.stepHandles(startMs: 100, endMs: 60_000)
        #expect(trim.start == 100)
        #expect(trim.handleDrag == nil)
        trim.stepHandles(startMs: 100, endMs: 59_900)
        #expect(trim.end == 59_900)
        #expect(trim.focus == .end)
    }

    @Test func aDragTheSystemTookAwayPutsTheHandleBack() {
        let trim = model()
        trim.moveHandles(startMs: 7000, endMs: 60_000, holdsDetail: false)
        // The handles report the span the drag began with.
        trim.moveHandles(startMs: 0, endMs: 60_000, holdsDetail: false)
        trim.commitHandles()
        #expect(trim.start == 0)
        #expect(trim.isChanged == false)
    }

    @Test func aTapOnAHandleMakesItTheOneTheDetailFollows() {
        let trim = placed(start: 10_000, end: 40_000)
        trim.selectHandle(nearestMs: 39_000)
        #expect(trim.focus == .end)
        trim.selectHandle(nearestMs: 11_000)
        #expect(trim.focus == .start)
    }

    @Test func fitShowsTheWholeRangeInTheDetail() {
        let trim = model()
        #expect(trim.canZoomOut)
        trim.fit()
        #expect(trim.zoom == 1)
        #expect(trim.canZoomOut == false)
        #expect(trim.detailWindow() == 0...60_000)
    }

    @Test func formatsTheReadoutsAndTheQuestion() {
        #expect(RecordingScreenText.preciseTime(milliseconds: 0) == "0:00.0")
        #expect(RecordingScreenText.preciseTime(milliseconds: 72_349) == "1:12.3")
        #expect(RecordingScreenText.preciseTime(milliseconds: 59_960) == "1:00.0")
        #expect(RecordingScreenText.trimConfirmTitle(milliseconds: 192_400) == "Trim to 3:12?")
    }
}

@MainActor
struct SelectionStopTests {
    /// Plays a stop through `readings` of (playing, elapsed), with the end handle at `end` of a
    /// window `length` long, and returns what it asked for.
    private func run(
        _ readings: [(Bool, TimeInterval)], end: TimeInterval, length: TimeInterval = 60
    ) -> [SelectionStop.Action] {
        var stop = SelectionStop()
        stop.arm()
        return readings.map { stop.observe(playing: $0.0, elapsed: $0.1, end: end, length: length) }
    }

    @Test func stopsOnTheEndHandleWithinHalfATick() {
        let actions = run([(true, 9.5), (true, 9.75), (true, 9.9)], end: 10)
        #expect(actions == [.none, .none, .stop(at: 10)])
    }

    @Test func followsTheEndHandleAsItMoves() {
        var stop = SelectionStop()
        stop.arm()
        #expect(stop.observe(playing: true, elapsed: 9.9, end: 12, length: 60) == .none)
        #expect(stop.observe(playing: true, elapsed: 9.9, end: 10, length: 60) == .stop(at: 10))
        #expect(stop.isArmed == false)
    }

    @Test func putsThePlayheadBackOnAnEndHandleThePlayerRanOff() {
        let actions = run([(true, 59.5), (true, 59.75), (false, 0)], end: 60)
        #expect(actions == [.none, .none, .park(at: 60)])
    }

    @Test func leavesAnOrdinaryPauseWhereItIs() {
        #expect(run([(true, 0), (false, 0)], end: 60) == [.none, .none])
        #expect(run([(true, 59.5), (true, 59.75), (false, 59.8)], end: 60) == [.none, .none, .none])
        // The player's own return to the start only comes at the window's end.
        #expect(run([(true, 9.5), (true, 9.75), (false, 0)], end: 10) == [.none, .none, .none])
    }

    @Test func aPauseDisarmsSoTheNextPlayIsOrdinary() {
        var stop = SelectionStop()
        stop.arm()
        _ = stop.observe(playing: true, elapsed: 1, end: 10, length: 60)
        _ = stop.observe(playing: false, elapsed: 1, end: 10, length: 60)
        #expect(stop.isArmed == false)
        #expect(stop.observe(playing: true, elapsed: 9.9, end: 10, length: 60) == .none)
    }

    @Test func waitsForPlaybackToStartBeforeWatching() {
        #expect(run([(false, 3), (true, 3.1)], end: 10) == [.none, .none])
    }
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct TrimHoldTests {
    private let audio = FakeAudio()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio)
        audio.duration = 60
    }

    private func load(_ recording: Recording = row(), sourceLocation: SourceLocation = #_sourceLocation) async throws {
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
        player.play(.recording(recording, tuneTitle: nil))
        try await eventually(sourceLocation: sourceLocation) { player.recordingAudio == .loaded }
    }

    private func trim(write: @escaping TrimModel.Write = { _, _, _ in }) -> TrimModel {
        TrimModel(recording: row(), file: nil, write: write, hold: { [player] in player.hold("r1", $0) })
    }

    @Test func cancelLetsGoOfTheHold() async throws {
        try await load()
        let trim = trim()
        trim.open()
        #expect(audio.calls.suffix(2) == ["setRate(100)", "setPitch(0)"])
        trim.leave()
        #expect(audio.calls.suffix(2) == ["setRate(75)", "setPitch(200)"])
    }

    @Test func saveLetsGoOfTheHold() async throws {
        try await load()
        let trim = trim()
        trim.open()
        trim.drag(.start, to: 5000)
        try await trim.save()
        #expect(audio.calls.suffix(2) == ["setRate(75)", "setPitch(200)"])
    }

    @Test func aFailedSaveKeepsTheHoldUntilTheScreenLeaves() async throws {
        try await load()
        let trim = trim { _, _, _ in throw URLError(.cannotOpenFile) }
        trim.open()
        trim.drag(.start, to: 5000)
        await #expect(throws: URLError.self) { try await trim.save() }
        #expect(audio.calls.suffix(2) == ["setRate(100)", "setPitch(0)"])
        trim.leave()
        #expect(audio.calls.suffix(2) == ["setRate(75)", "setPitch(200)"])
    }

    @Test func switchingRecordingLetsGoOfTheHold() async throws {
        try await load()
        player.hold("r1", PlaybackSettings(speedPercent: 100, pitchCents: 0))
        try await load(row(id: "r2", speedPercent: 60, pitchCents: -100))
        #expect(
            audio.calls.suffix(4) == ["setRate(60)", "setPitch(-100)", "setIsolate(default, mono: false)", "play"])
        // Letting go of the old recording's hold late leaves the new one alone.
        let before = audio.calls.count
        player.hold("r1", nil)
        #expect(audio.calls.count == before)
    }
}
