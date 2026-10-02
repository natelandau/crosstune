import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

private let audioURL = URL(filePath: "/tmp/r1-aaaaaaaa.m4a")

private func take(trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 60_000) -> Recording {
    Recording(
        id: "r1", tuneID: nil, source: "microphone", recordedAt: noon, label: "Jam", state: "ready",
        sourceDurationMs: sourceDurationMs, trimStartMs: trimStartMs, trimEndMs: trimEndMs, speedPercent: 100,
        pitchCents: 0)
}

private func loop(_ id: String, _ startMs: Int64, _ endMs: Int64, label: String? = nil) -> RecordingLoop {
    RecordingLoop(
        id: id, createdAt: noon, updatedAt: noon, recordingID: "r1", label: label, startMs: startMs, endMs: endMs,
        color: 0)
}

/// The recording's loops as the store would hold them: each write lands in `rows` and is fed
/// back to the player, as the live observation does.
@MainActor
private final class FakeLoops {
    let player: PlayerModel
    var rows: [String: RecordingLoop] = [:]
    private(set) var calls: [String] = []
    var refusal: (any Error)?
    private var nextID = 1

    init(player: PlayerModel) {
        self.player = player
    }

    func put(_ loops: [RecordingLoop]) {
        for row in loops { rows[row.id] = row }
        feed()
    }

    /// While set, writes land in `rows` but the player does not hear of them, as while the live
    /// observation has yet to deliver them.
    var paused = false

    func feed() {
        guard !paused else { return }
        player.loopsChanged(id: "r1", to: Array(rows.values))
    }

    func resume() {
        paused = false
        feed()
    }

    var writer: LoopWriter {
        LoopWriter(
            add: { [self] recordingID, span in
                if let refusal { throw refusal }
                calls.append("add(\(span.startMs)-\(span.endMs))")
                let row = loop("n\(nextID)", span.startMs, span.endMs)
                nextID += 1
                rows[row.id] = row
                feed()
                return row
            },
            update: { [self] id, span, label in
                if let refusal { throw refusal }
                guard var row = rows[id] else { return }
                if let span {
                    calls.append("update(\(id), \(span.startMs)-\(span.endMs))")
                    row.startMs = span.startMs
                    row.endMs = span.endMs
                }
                if case .value(let text) = label {
                    calls.append("label(\(id), \(text ?? "nil"))")
                    row.label = text
                }
                rows[id] = row
                feed()
            },
            remove: { [self] id in
                calls.append("remove(\(id))")
                rows[id]?.deletedAt = noon
                feed()
            })
    }
}

@MainActor
@Suite struct PracticeModelTests {
    private let audio = FakeAudio()
    private let player: PlayerModel
    private let store: FakeLoops
    private let spoken = Spoken()

    @MainActor
    private final class Spoken {
        var said: [String] = []
    }

    init() {
        player = PlayerModel(audio: audio)
        audio.duration = 60
        store = FakeLoops(player: player)
    }

    private func load(_ row: Recording = take()) async throws {
        player.audioSource = { _ in
            RecordingAudioFile(url: audioURL, file: RecordingFile(id: "r1", localState: .downloaded))
        }
        player.play(.recording(row, tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
    }

    /// Practice 300 points wide, which opens on 30 seconds: 10 points a second.
    private func practice(_ row: Recording = take(), file: RecordingFile? = nil) -> PracticeModel {
        let model = PracticeModel(
            player: player, recording: row, file: file, writer: store.writer,
            announce: { [spoken] in spoken.said.append($0) })
        model.setWidth(300)
        return model
    }

    /// Seconds into the playback window of a loop from `startMs` to `endMs`, with no trim.
    private func window(_ startMs: Int64, _ endMs: Int64, trimStartMs: Int64 = 0) -> PlaybackWindow {
        PlaybackWindow(from: Double(startMs - trimStartMs) / 1000, to: Double(endMs - trimStartMs) / 1000)
    }

    /// Where `sourceMs` sits on the waveform now.
    private func x(_ model: PracticeModel, _ sourceMs: Int64) throws -> Double {
        try #require(model.laneView).x(ofSourceMs: Double(sourceMs))
    }

    // MARK: Scrolling the audio

    @Test func aScrubHoldsPlaybackAndResumesFromTheNewSpot() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        #expect(audio.isPlaying)
        model.beginScrub()
        #expect(!audio.isPlaying)
        model.scrub(dx: -50)
        #expect(model.scrubbingMs == 15_000)
        #expect(model.centerMs == 15_000)
        #expect(audio.elapsed == 10)
        model.endScrub(predictedDx: -50)
        #expect(model.scrubbingMs == nil)
        #expect(audio.elapsed == 15)
        #expect(audio.isPlaying)
    }

    @Test func aGlidePastEitherEndStopsThere() async throws {
        try await load()
        let model = practice()
        model.glideRun = .milliseconds(30)
        audio.elapsed = 50
        model.beginScrub()
        model.scrub(dx: -20)
        model.endScrub(predictedDx: -100_000)
        try await eventually { model.scrubbingMs == nil }
        #expect(audio.elapsed == 60)
        // A glide to the end ends playback there rather than starting over.
        #expect(!audio.isPlaying)

        audio.play()
        model.beginScrub()
        model.scrub(dx: 20)
        model.endScrub(predictedDx: 100_000)
        try await eventually { model.scrubbingMs == nil }
        #expect(audio.elapsed == 0)
        #expect(audio.isPlaying)
    }

    @Test func aPinchDuringAScrubLeavesThePlayheadWhereItWas() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.beginScrub()
        model.scrub(dx: -50)
        model.pinch(2)
        model.endPinch()
        model.scrub(dx: -60)
        model.endScrub(predictedDx: -60)
        #expect(model.scrubbingMs == nil)
        #expect(audio.elapsed == 10)
        #expect(audio.isPlaying)
    }

    @Test func aTapSelectsTheLoopUnderItAndOutsideDeselects() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 12_000, 18_000, label: "B part")])
        audio.elapsed = 10
        let calls = audio.calls.count
        model.tap(atX: try x(model, 14_000))
        #expect(model.selectedID == "a")
        #expect(spoken.said == [PracticeText.loopSelected("B part")])
        #expect(audio.elapsed == 12)
        // A tap never holds or resumes playback.
        #expect(!audio.calls[calls...].contains("pause"))
        #expect(audio.isPlaying)

        model.tap(atX: try x(model, 25_000))
        #expect(model.selectedID == nil)
        #expect(audio.isPlaying)
    }

    @Test func theSeamBelongsToTheLoopThatStartsThere() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 10_000), loop("b", 10_000, 15_000)])
        audio.elapsed = 0
        model.tap(atX: try x(model, 10_000))
        #expect(model.selectedID == "b")
    }

    @Test func aPlainTapOnTheSelectedLoopKeepsIt() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.tap(atX: try x(model, 6000))
        #expect(model.selectedID == "a")
        #expect(spoken.said.isEmpty)
    }

    // MARK: Zoom

    @Test func everyZoomKeepsThePlayheadAtTheCenter() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 20
        #expect(model.scale == 10)
        model.zoom(by: 2)
        #expect(model.scale == 20)
        #expect(try x(model, 20_000) == 150)
        model.pinch(2)
        model.endPinch()
        #expect(model.scale == 40)
        #expect(try x(model, 20_000) == 150)

        // Turning the phone keeps the scale.
        model.setWidth(600)
        #expect(model.scale == 40)
    }

    @Test func fitMovesAnOutsidePlayheadToTheLoopStart() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 20_000, 30_000)])
        model.select("a")
        audio.elapsed = 5
        model.fit()
        #expect(audio.elapsed == 20)
        // Centered on the loop's start, the far end shows with its margin: 11 s each side.
        #expect(abs(try #require(model.scale) - 150.0 / 11) < 0.001)

        audio.elapsed = 25
        model.fit()
        #expect(audio.elapsed == 25)
        #expect(model.scale == 25)

        model.select(nil)
        model.fit()
        #expect(model.scale == 5)
    }

    @Test func theViewOpensOnTheSelectedLoop() async throws {
        try await load()
        store.put([loop("a", 20_000, 30_000)])
        player.loops.select("a")
        let model = practice()
        #expect(abs(try #require(model.scale) - 150.0 / 11) < 0.001)
    }

    @Test func aTakeStillCapturingHasNoViewUntilItsLengthIsKnown() {
        let capturing = RecordingFile(id: "r1", localState: .capturing)
        let model = practice(take(sourceDurationMs: nil), file: capturing)
        #expect(model.lengthMs == 0)
        #expect(model.laneView == nil)
        #expect(model.newLoopState == .noRoom)

        model.follow(take(sourceDurationMs: 30_000), file: RecordingFile(id: "r1", localState: .downloaded))
        #expect(model.laneView != nil)
    }

    // MARK: Selection and repeat

    @Test func selectingALoopRepeatsItAndMovesAnOutsidePlayheadToItsStart() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000), loop("b", 20_000, 25_000)])
        model.select("a")
        #expect(audio.isRepeating && model.isRepeating)
        #expect(audio.loop == window(5000, 15_000))

        audio.elapsed = 13
        model.select("b")
        #expect(audio.loop == window(20_000, 25_000))
        #expect(audio.elapsed == 20)
        #expect(model.isRepeating)
    }

    @Test func aSyncedSpanChangeAndATrimMoveTheRepeatingLoop() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000, label: "B part")])
        model.select("a")
        store.put([loop("a", 6000, 14_000, label: "B part")])
        #expect(audio.loop == window(6000, 14_000))
        #expect(player.loops.selectedName == "B part")

        player.recordingChanged(
            id: "r1", to: take(trimStartMs: 2000),
            audioFile: RecordingAudioFile(
                url: audioURL, file: RecordingFile(id: "r1", localState: .downloaded)), tuneTitle: nil)
        #expect(audio.loop == window(6000, 14_000, trimStartMs: 2000))
    }

    @Test func aTombstonedLoopTurnsRepeatOffAndClearsTheSelection() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        store.rows["a"]?.deletedAt = noon
        store.feed()
        #expect(model.selectedID == nil)
        #expect(!model.isRepeating)
        #expect(!audio.isRepeating)
        #expect(audio.loop == nil)
        #expect(audio.isPlaying)
    }

    @Test func aLoopSelectedBeforeItsRowArrivesIsSelectedOnceItDoes() async throws {
        try await load()
        let model = practice()
        model.select("late")
        #expect(model.selectedID == nil)
        store.put([loop("late", 5000, 15_000)])
        #expect(model.selectedID == "late")
        #expect(audio.loop == window(5000, 15_000))
    }

    @Test func theSelectionOutlivesTheScreenWhileTheRecordingStaysLoaded() async throws {
        try await load()
        store.put([loop("a", 5000, 15_000)])
        practice().select("a")
        #expect(practice().selectedID == "a")
        #expect(practice().isRepeating)

        player.close()
        #expect(player.loops.selectedID == nil)
        #expect(!player.loops.isRepeating)
    }

    @Test func aFailedRecordingDeleteKeepsRepeatOn() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        await player.deleteLoadedRecording { throw CommandError.recordingNotFound }
        try await eventually { player.recordingAudio == .loaded }
        #expect(model.isRepeating)
        #expect(audio.isRepeating)
        #expect(audio.loop == window(5000, 15_000))
    }

    // MARK: Loops mode

    @Test func newLoopPadsFourSecondsAroundThePlayheadWithinTheTrim() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 20
        model.newLoop()
        await model.settle()
        audio.elapsed = 59.8
        model.newLoop()
        await model.settle()
        #expect(store.calls == ["add(16000-24000)", "add(55800-60000)"])
        #expect(model.selectedID == "n2")
        #expect(model.isRepeating)
        #expect(spoken.said == [PracticeText.loopCreated, PracticeText.loopCreated])
    }

    @Test func newLoopIsDisabledWithEachReason() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 0, 10_000, label: "B part"), loop("b", 10_499, 20_000)])
        audio.elapsed = 5
        #expect(model.newLoopState == .inside(id: "a"))
        #expect(model.newLoopReason == "The playhead is in B part.")

        audio.elapsed = 10.2
        #expect(model.newLoopState == .noRoom)
        #expect(model.newLoopReason == PracticeText.noRoom)

        store.put([loop("b", 10_500, 20_000)])
        #expect(model.newLoopState == .span(LoopSpan(startMs: 10_000, endMs: 10_500)))
        #expect(model.newLoopReason == nil)

        store.put((0..<100).map { loop("l\($0)", 20_000 + Int64($0) * 500, 20_500 + Int64($0) * 500) })
        #expect(model.newLoopState == .atCap)
        #expect(model.newLoopReason == PracticeText.loopLimit)
    }

    @Test func aRefusedNewLoopWritesNothingAndSaysWhy() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 0, 10_000, label: "B part")])
        audio.elapsed = 5
        model.newLoop()
        await model.settle()
        #expect(store.calls.isEmpty)
        #expect(spoken.said == ["The playhead is in B part."])
    }

    @Test(arguments: [
        (CommandError.noRoom, PracticeText.noRoom), (CommandError.loopLimit, PracticeText.loopLimit),
    ])
    func aNewLoopTheWriterRefusesSaysWhyInItsOwnWords(_ refusal: CommandError, _ text: String) async throws {
        try await load()
        let model = practice()
        store.refusal = refusal
        audio.elapsed = 20
        model.newLoop()
        await model.settle()
        #expect(model.failure == text)
    }

    @Test func aRecordingShorterThanTheShortestLoopHasNoRoom() async throws {
        audio.duration = 0.4
        try await load(take(sourceDurationMs: 400))
        let model = practice(take(sourceDurationMs: 400))
        #expect(model.newLoopState == .noRoom)
        model.newLoop()
        await model.settle()
        #expect(store.calls.isEmpty)
    }

    @Test func previousAndNextSelectAndMoveThePlayhead() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 10_000), loop("b", 20_000, 25_000, label: "B part"), loop("c", 40_000, 45_000)])
        audio.elapsed = 15
        #expect(model.adjacent(.previous)?.id == "a")
        model.step(.next)
        #expect(model.selectedID == "b")
        #expect(audio.elapsed == 20)
        #expect(spoken.said == [PracticeText.loopSelected("B part")])
        model.step(.next)
        #expect(model.selectedID == "c")
        #expect(audio.elapsed == 40)
        #expect(model.adjacent(.next) == nil)
        model.step(.previous)
        #expect(model.selectedID == "b")
        #expect(audio.elapsed == 20)
    }

    @Test func theSwitcherNamesTheSelectedLoopOrNoLoopAndIsGoneWithNoLoops() async throws {
        try await load()
        let model = practice()
        #expect(model.switcherLabel == nil)
        store.put([loop("a", 5000, 10_000, label: "B part"), loop("b", 20_000, 25_000)])
        #expect(model.switcherLabel == PracticeText.noLoop)
        model.select("a")
        #expect(model.switcherLabel == "B part")
        model.select("b")
        #expect(model.switcherLabel == PracticeText.loopName("0:20"))
    }

    @Test func theSwitchersArrowsGoOffWithNoLoopThatWayOrNoAudio() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 10_000), loop("b", 20_000, 25_000)])
        audio.elapsed = 15
        #expect(model.canStep(.previous))
        #expect(model.canStep(.next))
        model.step(.next)
        #expect(model.selectedID == "b")
        #expect(audio.elapsed == 20)
        #expect(model.canStep(.previous))
        #expect(!model.canStep(.next))
        audio.hasFailed = true
        #expect(!model.canStep(.previous))
    }

    @Test func deleteLoopIsOffUntilALoopIsSelected() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        #expect(!model.canDeleteSelected)
        model.select("a")
        #expect(model.canDeleteSelected)
        audio.hasFailed = true
        #expect(!model.canDeleteSelected)
    }

    @Test func deleteRemovesTheSelectedLoopAtOnceAndPlaysOn() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        #expect(!model.deleteSelected())
        model.select("a")
        #expect(model.deleteSelected())
        await model.settle()
        #expect(store.calls == ["remove(a)"])
        #expect(model.selectedID == nil)
        #expect(!audio.isRepeating)
        #expect(audio.isPlaying)
    }

    @Test func bracketsMoveTheSelectedLoopsEdgesUpToItsNeighbors() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 9000), loop("b", 12_000, 15_000)])
        model.select("a")
        audio.elapsed = 6
        model.setEdge(.start)
        await model.settle()
        #expect(store.calls == ["update(a, 6000-9000)"])

        audio.elapsed = 13
        model.setEdge(.end)
        await model.settle()
        #expect(store.calls.last == "update(a, 6000-12000)")

        model.select(nil)
        model.setEdge(.start)
        await model.settle()
        #expect(store.calls.count == 2)
    }

    // MARK: Handles

    @Test func aHandleStopsFlushAtTheNeighbor() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 10_000), loop("b", 12_000, 15_000)])
        model.select("a")
        model.beginHandleDrag(.end)
        model.dragHandle(toX: try x(model, 14_000), snapping: false)
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5000, endMs: 12_000))
        #expect(store.calls.isEmpty)
        model.endHandleDrag(atX: try x(model, 14_000), snapping: false)
        await model.settle()
        #expect(store.calls == ["update(a, 5000-12000)"])
    }

    @Test func aHandleSnapsToThePlayheadUnlessSnappingIsOff() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 10_000)])
        model.select("a")
        audio.elapsed = 8
        model.beginHandleDrag(.end)
        model.dragHandle(toX: try x(model, 8300), snapping: true)
        #expect(model.shownSpan("a")?.endMs == 8000)
        #expect(model.snaps == 1)
        model.dragHandle(toX: try x(model, 8300), snapping: false)
        #expect(model.shownSpan("a")?.endMs == 8300)
        model.endHandleDrag(atX: try x(model, 8300), snapping: false)
        await model.settle()
        #expect(store.calls == ["update(a, 5000-8300)"])
    }

    @Test func aRepeatingLoopFollowsItsHandleWhileThePlayheadIsInside() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        audio.elapsed = 6
        model.beginHandleDrag(.end)
        model.dragHandle(toX: try x(model, 12_000), snapping: false)
        #expect(audio.loop == window(5000, 12_000))
        model.endHandleDrag(atX: try x(model, 12_000), snapping: false)
        await model.settle()
        #expect(audio.loop == window(5000, 12_000))
    }

    @Test func aPinchPutsAHandleDragBackAndWritesNothing() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.beginHandleDrag(.end)
        model.dragHandle(toX: try x(model, 12_000), snapping: false)
        model.pinch(1.5)
        model.endPinch()
        model.endHandleDrag(atX: try x(model, 12_000), snapping: false)
        await model.settle()
        #expect(store.calls.isEmpty)
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5000, endMs: 15_000))
    }

    @Test func aSecondDragShowsItsOwnSpanUntilItsWriteLands() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        func drag(to ms: Int64) throws {
            model.beginHandleDrag(.end)
            model.dragHandle(toX: try x(model, ms), snapping: false)
            model.endHandleDrag(atX: try x(model, ms), snapping: false)
        }
        try drag(to: 14_000)
        await model.settle()
        #expect(model.shownSpan("a")?.endMs == 14_000)

        store.paused = true
        try drag(to: 13_000)
        await model.settle()
        #expect(model.shownSpan("a")?.endMs == 13_000)
        store.resume()
        #expect(model.shownSpan("a")?.endMs == 13_000)
    }

    @Test func aNudgeWritesOnceWhenTheKeyIsLetGo() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.nudge(.start, by: 100)
        model.nudge(.start, by: 100)
        #expect(store.calls.isEmpty)
        model.commitNudge()
        await model.settle()
        #expect(store.calls == ["update(a, 5200-15000)"])
        #expect(model.handleValue(.start) == "Loop 0:05 start, 0:05.2")
    }

    @Test func aSecondNudgeShowsItsOwnSpanUntilItsWriteLands() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.nudge(.start, by: 100)
        model.commitNudge()
        await model.settle()
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5100, endMs: 15_000))

        store.paused = true
        model.nudge(.start, by: 100)
        model.commitNudge()
        await model.settle()
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5200, endMs: 15_000))
        store.resume()
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5200, endMs: 15_000))
        #expect(store.calls == ["update(a, 5100-15000)", "update(a, 5200-15000)"])
    }

    @Test func anEarlierWriteLandingNeverShowsOverALaterOneStillPending() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        store.paused = true
        model.nudge(.start, by: 100)
        model.commitNudge()
        await model.settle()
        model.nudge(.start, by: 100)
        model.commitNudge()
        await model.settle()
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5200, endMs: 15_000))

        // The first write reaches the observation before the second does.
        player.loopsChanged(id: "r1", to: [loop("a", 5100, 15_000)])
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5200, endMs: 15_000))
        store.resume()
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5200, endMs: 15_000))
    }

    // MARK: Rename and Escape

    @Test func renamingWritesTheLabelOnceAndAnEmptyNameClearsIt() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        #expect(model.renameSelected())
        #expect(model.renaming == "a")
        model.commitRename("B part")
        await model.settle()
        #expect(store.calls == ["label(a, B part)"])

        model.beginRename("a")
        model.commitRename("B part")
        model.beginRename("a")
        model.commitRename("  ")
        await model.settle()
        #expect(store.calls == ["label(a, B part)", "label(a, nil)"])

        model.beginRename("a")
        #expect(model.cancelRename())
        #expect(!model.cancelRename())
    }

    @Test func theNameFieldOpensOnTheStoredLabelAndLeavesAnUnnamedLoopUnnamed() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000), loop("b", 20_000, 25_000, label: "B part")])
        #expect(model.renameText("a") == "")
        #expect(model.renameText("b") == "B part")
        model.beginRename("a")
        model.commitRename("")
        await model.settle()
        #expect(store.calls.isEmpty)
    }

    @Test func aChipPressedAsTheFieldLosesFocusWritesTheChipOnce() async throws {
        try await load()
        let model = practice()
        model.blurDelay = .milliseconds(30)
        store.put([loop("a", 5000, 15_000)])
        model.beginRename("a")
        model.renameLostFocus("Typed")
        model.commitRename("B part")
        try await Task.sleep(for: .milliseconds(100))
        await model.settle()
        #expect(store.calls == ["label(a, B part)"])

        model.beginRename("a")
        model.renameLostFocus("Typed")
        try await eventually { store.calls.count == 2 }
        await model.settle()
        #expect(store.calls.last == "label(a, Typed)")
    }

    @Test func aTapOrScrubElsewhereSavesTheNameBeingTyped() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 12_000, 18_000)])
        model.tap(atX: try x(model, 14_000))
        model.beginRename("a")
        model.renameTyped("Reel")
        model.tap(atX: try x(model, 14_000))
        await model.settle()
        #expect(model.renaming == nil)
        #expect(store.calls == ["label(a, Reel)"])

        model.beginRename("a")
        model.renameTyped("Roll")
        model.beginScrub()
        model.cancelScrub()
        await model.settle()
        #expect(model.renaming == nil)
        #expect(store.calls.last == "label(a, Roll)")
    }

    @Test func aNameLeftByOpeningAnotherLoopsFieldGoesToItsOwnLoop() async throws {
        try await load()
        let model = practice()
        model.blurDelay = .milliseconds(30)
        store.put([loop("a", 5000, 15_000), loop("b", 20_000, 25_000)])
        model.beginRename("a")
        model.renameLostFocus("A part")
        model.beginRename("b")
        #expect(model.renaming == "b")
        try await Task.sleep(for: .milliseconds(100))
        await model.settle()
        #expect(store.calls == ["label(a, A part)"])
        #expect(model.renaming == "b")
    }

    @Test func escapeCancelsARenameThenDeselects() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.beginRename("a")
        #expect(model.escape())
        #expect(model.renaming == nil)
        #expect(model.selectedID == "a")
        #expect(model.escape())
        #expect(model.selectedID == nil)
        #expect(!model.escape())
        await model.settle()
        #expect(store.calls.isEmpty)
    }

    @Test func theScreensEscapeRunsTheChainAndClosesOnlyWhenNothingIsLeft() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.beginRename("a")
        var closed = 0
        model.escape { closed += 1 }
        #expect(model.renaming == nil)
        #expect(model.selectedID == "a")
        #expect(closed == 0)
        model.escape { closed += 1 }
        #expect(model.selectedID == nil)
        #expect(closed == 0)
        model.escape { closed += 1 }
        #expect(closed == 1)
    }

    // MARK: The shown playhead

    @Test func newLoopDuringAScrubActsWhereThePlayheadShows() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.beginScrub()
        model.scrub(dx: -50)
        model.newLoop()
        await model.settle()
        #expect(store.calls == ["add(11000-19000)"])
    }

    @Test func newLoopDuringAGlideStopsItWhereItShows() async throws {
        try await load()
        let model = practice()
        model.glideRun = .seconds(10)
        audio.elapsed = 10
        model.beginScrub()
        model.scrub(dx: -50)
        model.endScrub(predictedDx: -400)
        try await Task.sleep(for: .milliseconds(50))
        let shown = try #require(model.scrubbingMs)
        model.newLoop()
        #expect(model.scrubbingMs == nil)
        #expect(model.glide == nil)
        #expect(audio.elapsed == Double(shown) / 1000)
        await model.settle()
        #expect(store.calls == ["add(\(shown - 4000)-\(shown + 4000))"])
    }

    @Test func aSeekFromTheOverviewStopsAGlide() async throws {
        try await load()
        let model = practice()
        model.glideRun = .seconds(10)
        audio.elapsed = 10
        model.beginScrub()
        model.scrub(dx: -50)
        model.endScrub(predictedDx: -400)
        #expect(model.glide != nil)
        model.seek(toMs: 30_000)
        #expect(model.glide == nil)
        #expect(model.scrubbingMs == nil)
        #expect(audio.elapsed == 30)
        #expect(audio.isPlaying)
        try await Task.sleep(for: .milliseconds(50))
        #expect(audio.elapsed == 30)
    }

    @Test func aTapOnAHandleOutsideItsLoopIsATapOnTheWaveform() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 20_000, 30_000)])
        model.select("a")
        // Inside the end handle's 44 point target, just past the loop's end.
        model.tap(atX: try x(model, 30_000) + 10)
        #expect(model.selectedID == nil)

        model.select("a")
        model.tap(atX: try x(model, 30_000) - 10)
        #expect(model.selectedID == "a")
    }

    @Test func withNoAudioToPlayTheLoopCommandsDoNothing() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000), loop("b", 40_000, 45_000)])
        model.select("a")
        audio.hasFailed = true
        #expect(!model.isLoaded)
        model.newLoop()
        model.setEdge(.end)
        model.step(.next)
        #expect(!model.deleteSelected())
        await model.settle()
        #expect(store.calls.isEmpty)
        #expect(model.selectedID == "a")
        #expect(spoken.said.isEmpty)
    }

    @Test func suggestsTheTunesPartsWithLabelsInUseLast() async throws {
        try await load()
        let model = practice()
        model.partStructure = "AABBCC"
        store.put([loop("a", 5000, 15_000, label: "A part"), loop("b", 20_000, 25_000)])
        #expect(model.suggestions(for: "b") == ["B part", "C part", "A part"])
        #expect(model.suggestions(for: "a") == ["A part", "B part", "C part"])
    }

    @Test func eachLoopColorHasALightAndADarkVariantMatchingTheWeb() {
        #expect(LoopColor.hex(0, dark: false) == "#1f5fd6")
        #expect(LoopColor.hex(5, dark: false) == "#6b3fc4")
        #expect(LoopColor.hex(0, dark: true) == "#3570dc")
        #expect(LoopColor.hex(4, dark: true) == "#0f808a")
        #expect(LoopColor.hex(9, dark: false) == LoopColor.hex(3, dark: false))
    }
}
