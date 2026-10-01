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

private func take(trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64 = 60_000) -> Recording {
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

/// A clock a test moves by hand.
@MainActor
private final class Clock {
    var now = ContinuousClock.now

    func advance(_ duration: Duration) {
        now = now.advanced(by: duration)
    }
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
    /// Set by another registrant's undo, which Practice's banner must never run.
    var otherUndone = false

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
            },
            restore: { [self] id in
                calls.append("restore(\(id))")
                rows[id]?.deletedAt = nil
                feed()
            })
    }
}

@MainActor
@Suite struct PracticeModelTests {
    private let audio = FakeAudio()
    private let player: PlayerModel
    private let store: FakeLoops
    private let clock = Clock()
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

    private func practice(_ row: Recording = take()) -> PracticeModel {
        let model = PracticeModel(
            player: player, recording: row, file: nil, writer: store.writer, clock: { [clock] in clock.now },
            announce: { [spoken] in spoken.said.append($0) })
        model.setWidth(300)
        return model
    }

    /// Seconds into the playback window of a loop from `startMs` to `endMs`, with no trim.
    private func window(_ startMs: Int64, _ endMs: Int64, trimStartMs: Int64 = 0) -> PlaybackWindow {
        PlaybackWindow(from: Double(startMs - trimStartMs) / 1000, to: Double(endMs - trimStartMs) / 1000)
    }

    // MARK: A B

    @Test func aBMarksAStartThenMakesASelectedRepeatingLoop() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.markAB()
        #expect(model.isMarking)
        #expect(spoken.said == [PracticeText.loopStartMarked])
        clock.advance(.seconds(2))
        audio.elapsed = 12
        model.observe(elapsed: 12)
        #expect(model.isMarking)
        #expect(model.markBand == LoopSpan(startMs: 10_000, endMs: 12_000))

        clock.advance(.seconds(2))
        audio.elapsed = 14
        model.observe(elapsed: 14)
        model.markAB()
        await model.settle()
        #expect(store.calls == ["add(10000-14000)"])
        #expect(!model.isMarking)
        #expect(model.selectedID == "n1")
        #expect(model.isRepeating)
        #expect(audio.isRepeating)
        #expect(audio.loop == window(10_000, 14_000))
        #expect(spoken.said == [PracticeText.loopStartMarked, PracticeText.loopCreated])
    }

    @Test func aSecondTapSoonerThanHalfASecondCancels() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.markAB()
        clock.advance(.milliseconds(300))
        model.markAB()
        await model.settle()
        #expect(!model.isMarking)
        #expect(store.calls.isEmpty)
    }

    @Test func aSeekOrEscapeCancelsAPendingMark() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.markAB()
        model.observe(elapsed: 10.05)
        #expect(model.isMarking)
        model.observe(elapsed: 30)
        #expect(!model.isMarking)

        model.markAB()
        #expect(model.cancelMark())
        #expect(!model.cancelMark())
        await model.settle()
        #expect(store.calls.isEmpty)
    }

    @Test func aShortSecondTapStretchesToTheShortestLoop() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 10
        model.markAB()
        clock.advance(.milliseconds(600))
        audio.elapsed = 10.2
        model.markAB()
        await model.settle()
        #expect(store.calls == ["add(10000-10500)"])
    }

    @Test func bracketsMoveTheSelectedLoopsEdgesOrMarkALoop() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 9000)])
        model.select("a")
        audio.elapsed = 6
        model.markStart()
        await model.settle()
        #expect(store.calls == ["update(a, 6000-9000)"])

        model.select(nil)
        audio.elapsed = 20
        model.markStart()
        #expect(model.isMarking)
        clock.advance(.seconds(1))
        audio.elapsed = 22
        model.markEnd()
        await model.settle()
        #expect(store.calls.last == "add(20000-22000)")
    }

    // MARK: Selection and Repeat

    @Test func repeatMovesWithTheSelectionAndThePlayheadToItsStart() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000), loop("b", 8000, 12_000)])
        #expect(!model.canRepeat)
        model.select("a")
        model.toggleRepeat()
        #expect(audio.isRepeating && model.isRepeating)
        #expect(audio.loop == window(5000, 15_000))

        audio.elapsed = 9
        model.select("b")
        #expect(audio.loop == window(8000, 12_000))
        #expect(audio.elapsed == 8)
        #expect(model.isRepeating)
    }

    @Test func aSyncedSpanChangeAndATrimMoveTheRepeatingLoop() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000, label: "B part")])
        model.select("a")
        model.toggleRepeat()
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
        model.toggleRepeat()
        store.rows["a"]?.deletedAt = noon
        store.feed()
        #expect(model.selectedID == nil)
        #expect(!model.isRepeating)
        #expect(!audio.isRepeating)
        #expect(audio.loop == nil)
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

    @Test func theSelectionOutlivesPracticeWhileTheRecordingStaysLoaded() async throws {
        try await load()
        store.put([loop("a", 5000, 15_000)])
        practice().select("a")
        player.loops.setRepeat(true)
        #expect(practice().selectedID == "a")
        #expect(practice().isRepeating)

        player.close()
        #expect(player.loops.selectedID == nil)
        #expect(!player.loops.isRepeating)
    }

    // MARK: Gestures

    @Test func aDragWritesOnceOnReleaseAndMovesARepeatingLoopOnlyThen() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.toggleRepeat()
        model.fit()
        let view = try #require(model.laneView)
        let loops = audio.calls.filter { $0 == "setLoop" }.count

        model.beginLaneDrag(at: CGPoint(x: view.x(ofSourceMs: 10_000), y: LaneMetrics.standard.rowTop(0) + 4))
        for dx in [10.0, 20, 30] {
            model.drag(toX: view.x(ofSourceMs: 10_000) + dx, snapping: false)
        }
        #expect(store.calls.isEmpty)
        #expect(audio.calls.filter { $0 == "setLoop" }.count == loops)
        let shown = try #require(model.shownSpan("a"))
        #expect(shown.startMs > 5000)

        model.endDrag(atX: view.x(ofSourceMs: 10_000) + 30, snapping: false)
        await model.settle()
        #expect(store.calls.count == 1)
        #expect(store.calls.first?.hasPrefix("update(a, ") == true)
        #expect(audio.loop == window(shown.startMs, shown.endMs))
    }

    @Test func drawingOnEmptyLaneMakesASelectedLoop() async throws {
        try await load()
        let model = practice()
        model.fit()
        let view = try #require(model.laneView)
        let y = LaneMetrics.standard.rowTop(0) + 4
        model.beginLaneDrag(at: CGPoint(x: view.x(ofSourceMs: 10_000), y: y))
        model.drag(toX: view.x(ofSourceMs: 20_000), snapping: false)
        model.endDrag(atX: view.x(ofSourceMs: 20_000), snapping: false)
        await model.settle()
        #expect(store.calls.count == 1)
        #expect(model.selectedID == "n1")
        #expect(!model.isRepeating)
    }

    @Test func aPinchPutsADragBackAndWritesNothing() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.fit()
        let view = try #require(model.laneView)
        model.beginLaneDrag(at: CGPoint(x: view.x(ofSourceMs: 10_000), y: LaneMetrics.standard.rowTop(0) + 4))
        model.drag(toX: view.x(ofSourceMs: 10_000) + 40, snapping: false)
        model.pinch(1.5)
        model.endPinch()
        model.endDrag(atX: view.x(ofSourceMs: 10_000) + 40, snapping: false)
        await model.settle()
        #expect(store.calls.isEmpty)
        #expect(model.shownSpan("a") == LoopSpan(startMs: 5000, endMs: 15_000))
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

    @Test func aSecondDragShowsItsOwnSpanUntilItsWriteLands() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.fit()
        let view = try #require(model.laneView)
        let y = LaneMetrics.standard.rowTop(0) + 4
        func drag(by dx: Double) {
            let x = view.x(ofSourceMs: 10_000)
            model.beginLaneDrag(at: CGPoint(x: x, y: y))
            model.drag(toX: x + dx, snapping: false)
            model.endDrag(atX: x + dx, snapping: false)
        }
        drag(by: 10)
        await model.settle()
        let first = try #require(model.shownSpan("a"))
        #expect(first.startMs > 5000)

        store.paused = true
        drag(by: 10)
        await model.settle()
        let second = try #require(model.shownSpan("a"))
        #expect(second.startMs > first.startMs)
        store.resume()
        #expect(model.shownSpan("a") == second)
    }

    @Test func aPinchAndAScrollZoomAroundWhereTheyHappen() async throws {
        try await load()
        let model = practice()
        model.fit()
        let before = try #require(model.laneView)
        let x = before.x(ofSourceMs: 20_000)
        model.pinch(2, anchorX: x)
        model.endPinch()
        let pinched = try #require(model.laneView)
        #expect(abs(pinched.x(ofSourceMs: 20_000) - x) < 0.01)
        #expect(pinched.pointsPerSecond == before.pointsPerSecond * 2)

        let at = pinched.x(ofSourceMs: 25_000)
        model.zoom(by: 2, aroundX: at)
        let scrolled = try #require(model.laneView)
        #expect(abs(scrolled.x(ofSourceMs: 25_000) - at) < 0.01)
    }

    @Test func aFailedRecordingDeleteKeepsRepeatOn() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.toggleRepeat()
        await player.deleteLoadedRecording { throw CommandError.recordingNotFound }
        try await eventually { player.recordingAudio == .loaded }
        #expect(model.isRepeating)
        #expect(audio.isRepeating)
        #expect(audio.loop == window(5000, 15_000))
    }

    // MARK: List, rename, delete, undo

    @Test func aChipPressedAsTheFieldLosesFocusWritesTheChip() async throws {
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

    @Test func theBannersUndoLeavesAnotherActionOnTheStackAlone() async throws {
        try await load()
        let model = practice()
        let undo = UndoManager()
        undo.groupsByEvent = false
        model.undoManager = undo
        store.put([loop("a", 5000, 15_000)])
        model.delete("a")
        await model.settle()
        undo.beginUndoGrouping()
        undo.registerUndo(withTarget: store) { other in
            MainActor.assumeIsolated { other.otherUndone = true }
        }
        undo.setActionName("Other")
        undo.endUndoGrouping()

        model.undo()
        await model.settle()
        #expect(store.calls == ["remove(a)", "restore(a)"])
        #expect(!store.otherUndone)
    }

    @Test func renamingWritesTheLabelOnceAndAnEmptyNameClearsIt() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.choose("a")
        #expect(model.selectedID == "a")
        #expect(model.renaming == nil)
        model.choose("a")
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

    @Test func suggestsTheTunesPartsWithLabelsInUseLast() async throws {
        try await load()
        let model = practice()
        model.partStructure = "AABBCC"
        store.put([loop("a", 5000, 15_000, label: "A part"), loop("b", 20_000, 25_000)])
        #expect(model.suggestions(for: "b") == ["B part", "C part", "A part"])
        #expect(model.suggestions(for: "a") == ["A part", "B part", "C part"])
    }

    @Test func undoPutsBackADeletedLoopAndItsSelection() async throws {
        try await load()
        let model = practice()
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.delete("a")
        await model.settle()
        #expect(store.calls == ["remove(a)"])
        #expect(model.undoBanner?.message == PracticeText.loopDeleted)
        #expect(model.selectedID == nil)

        model.undo()
        await model.settle()
        #expect(store.calls == ["remove(a)", "restore(a)"])
        #expect(model.undoBanner == nil)
        #expect(model.selectedID == "a")
    }

    @Test func theUndoManagerUndoesAndRedoesEachEdit() async throws {
        try await load()
        let model = practice()
        let undo = UndoManager()
        model.undoManager = undo
        store.put([loop("a", 5000, 15_000)])
        model.select("a")
        model.nudge(.end, by: 1000)
        model.commitNudge()
        await model.settle()
        model.delete("a")
        await model.settle()

        undo.undo()
        await model.settle()
        #expect(store.calls.last == "restore(a)")
        undo.undo()
        await model.settle()
        #expect(store.calls.last == "update(a, 5000-15000)")
        undo.redo()
        await model.settle()
        #expect(store.calls.last == "update(a, 5000-16000)")
    }

    @Test func newLoopRunsFourSecondsFromThePlayheadWithinTheTrim() async throws {
        try await load()
        let model = practice()
        audio.elapsed = 20
        model.newLoop()
        audio.elapsed = 59.8
        model.newLoop()
        await model.settle()
        #expect(store.calls == ["add(20000-24000)", "add(59500-60000)"])
        #expect(model.selectedID == "n2")
    }

    // MARK: Limits

    @Test func atOneHundredLoopsNothingMakesAnother() async throws {
        try await load()
        let model = practice()
        store.put((0..<100).map { loop("l\($0)", Int64($0) * 500, Int64($0) * 500 + 500) })
        #expect(!model.create.allowed)
        #expect(model.create.reason == PracticeText.loopLimit)
        audio.elapsed = 10
        model.markAB()
        model.newLoop()
        #expect(!model.isMarking)
        model.fit()
        let view = try #require(model.laneView)
        model.beginLaneDrag(at: CGPoint(x: 1, y: LaneMetrics.standard.rowTop(50)))
        model.drag(toX: view.width - 1, snapping: false)
        model.endDrag(atX: view.width - 1, snapping: false)
        await model.settle()
        #expect(store.calls.isEmpty)
    }

    @Test func aRecordingShorterThanTheShortestLoopMakesNone() async throws {
        audio.duration = 0.4
        try await load(take(sourceDurationMs: 400))
        let model = practice(take(sourceDurationMs: 400))
        #expect(!model.create.allowed)
        #expect(model.create.reason == nil)
        model.markAB()
        model.newLoop()
        await model.settle()
        #expect(!model.isMarking)
        #expect(store.calls.isEmpty)
    }

    @Test func eachLoopColorHasALightAndADarkVariantMatchingTheWeb() {
        #expect(LoopColor.hex(0, dark: false) == "#1f5fd6")
        #expect(LoopColor.hex(5, dark: false) == "#6b3fc4")
        #expect(LoopColor.hex(0, dark: true) == "#3570dc")
        #expect(LoopColor.hex(4, dark: true) == "#0f808a")
        #expect(LoopColor.hex(9, dark: false) == LoopColor.hex(3, dark: false))
    }
}
