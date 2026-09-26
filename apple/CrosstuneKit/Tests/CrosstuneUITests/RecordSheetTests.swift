@preconcurrency import AVFoundation
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct WaveformBarsTests {
    private let step = WaveformBars.step

    @Test func fitsOneBarPerStepAcrossTheWidth() {
        #expect(WaveformBars.count(forWidth: 10 * step) == 10)
        #expect(WaveformBars.count(forWidth: 10 * step + 1) == 11)
        #expect(WaveformBars.count(forWidth: 0) == 0)
    }

    @Test func scrollsTheNewestLevelInAtTheRightEdgeAndDropsTheOldest() {
        var bars = WaveformBars(mode: .scrolling)
        for level: Float in [0.1, 0.2, 0.3] { bars.push(level, capacity: 2) }
        #expect(bars.levels == [0.2, 0.3])
        #expect(bars.layout(width: 10 * step, height: 100).map(\.minX) == [8 * step, 9 * step])
    }

    @Test func fixedModeWritesEachLevelInPlaceAndCyclesTheSlotWithoutMovingBars() {
        var bars = WaveformBars(mode: .fixed)
        for level: Float in [0.1, 0.2, 0.3] { bars.push(level, capacity: 2) }
        #expect(bars.levels == [0.3, 0.2])
        #expect(bars.cursor == 1)
        #expect(bars.layout(width: 10 * step, height: 100).map(\.minX) == [0, step])
    }

    @Test func keepsFixedSlotsThatStillFitWhenTheBarCountChanges() {
        var bars = WaveformBars(mode: .fixed)
        for level: Float in [0.1, 0.2, 0.3] { bars.push(level, capacity: 3) }
        bars.push(0.9, capacity: 2)
        #expect(bars.levels == [0.9, 0.2])
        #expect(bars.cursor == 1)
    }

    @Test func pushesNothingWithNoRoom() {
        var bars = WaveformBars(mode: .scrolling)
        bars.push(0.5, capacity: 0)
        #expect(bars.levels.isEmpty)
    }

    @Test func clampsBarHeightBetweenAVisibleMinimumAndTheCanvasCenteredVertically() {
        var bars = WaveformBars(mode: .scrolling)
        bars.push(0, capacity: 3)
        bars.push(1, capacity: 3)
        let rects = bars.layout(width: 100, height: 40)
        #expect(rects[0].height == 2)
        #expect(rects[0].minY == 19)
        #expect(rects[1].height == 40)
        #expect(rects[1].minY == 0)
        #expect(rects.allSatisfy { $0.width == WaveformBars.barWidth })
    }
}

@Suite struct WaveformFeedTests {
    private let frame = 1 / WaveformFeed.rate

    @Test func drawsLevelsAtTheRateTheyWereMeasured() {
        let feed = WaveformFeed(mode: .scrolling)
        feed.receive([0.1, 0.2, 0.3, 0.4], total: 4)
        feed.advance(to: 0, capacity: 10)
        #expect(feed.bars.levels.isEmpty)
        feed.advance(to: frame, capacity: 10)
        #expect(feed.bars.levels == [0.1])
        feed.advance(to: 3 * frame, capacity: 10)
        #expect(feed.bars.levels == [0.1, 0.2, 0.3])
    }

    @Test func takesOnlyTheLevelsItHasNotSeen() {
        let feed = WaveformFeed(mode: .scrolling)
        feed.receive([0.1, 0.2], total: 2)
        // A full window has dropped its oldest level; only the newest is new.
        feed.receive([0.2, 0.3], total: 3)
        feed.advance(to: 0, capacity: 10)
        feed.advance(to: 10 * frame, capacity: 10)
        #expect(feed.bars.levels == [0.1, 0.2, 0.3])
    }

    @Test func startsOverWithANewTake() {
        let feed = WaveformFeed(mode: .scrolling)
        feed.receive([0.1, 0.2, 0.3], total: 3)
        feed.receive([0.9], total: 1)
        feed.advance(to: 0, capacity: 10)
        feed.advance(to: 10 * frame, capacity: 10)
        #expect(feed.bars.levels == [0.1, 0.2, 0.3, 0.9])
    }

    @Test func catchesUpRatherThanTrailingTheSound() {
        let feed = WaveformFeed(mode: .scrolling)
        let levels = Array(repeating: Float(0.5), count: WaveformFeed.maximumQueued + 10)
        feed.receive(levels, total: levels.count)
        feed.advance(to: 0, capacity: 100)
        #expect(feed.bars.levels.count == 10)
    }

    @Test func idleTimeDoesNotBankIntoABurst() {
        let feed = WaveformFeed(mode: .scrolling)
        feed.advance(to: 0, capacity: 10)
        feed.advance(to: 1, capacity: 10)
        feed.receive([0.1, 0.2, 0.3], total: 3)
        feed.advance(to: 1 + frame, capacity: 10)
        #expect(feed.bars.levels == [0.1])
    }
}

/// A microphone that writes a tone on demand, standing in for the device in tests.
@MainActor
private final class ToneInput: AudioInput {
    var permission = true
    private var writer: CaptureWriter?
    private var onLevels: (@MainActor @Sendable ([Float]) -> Void)?
    private var onEvent: (@MainActor @Sendable (AudioInputEvent) -> Void)?
    private var meter = LevelMeter()

    func requestPermission() async -> Bool { permission }

    func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) throws {
        self.writer = writer
        self.onLevels = onLevels
        self.onEvent = onEvent
    }

    func resume() throws {}

    func stop() {
        onLevels = nil
        onEvent = nil
    }

    func play(seconds: Double) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let frames = AVAudioFrameCount(seconds * 48_000)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for frame in 0..<Int(frames) { samples[frame] = 0.5 * Float(sin(2 * .pi * 440 * Double(frame) / 48_000)) }
        try writer?.write(buffer)
        onLevels?(meter.levels(of: buffer))
    }

    func send(_ event: AudioInputEvent) {
        onEvent?(event)
    }
}

@MainActor
@Suite struct RecordSheetModelTests {
    private let root = TemporaryRoot()
    private let input = ToneInput()
    private let store: CrosstuneStore
    private let recorder: Recorder

    init() throws {
        store = try root.open()
        recorder = Recorder(store: store, input: input)
    }

    private func recordings() async throws -> [Recording] {
        try await store.read { db in try Recording.fetchAll(db) }
    }

    @Test func readsAsStartingUntilItBegins() async throws {
        // A recorder left saved from an earlier take must not close a fresh sheet.
        let earlier = RecordSheetModel(recorder: recorder, tuneID: nil)
        await earlier.begin()
        try input.play(seconds: 0.5)
        await earlier.stop()
        #expect(recorder.savedRecordingID != nil)

        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        #expect(model.phase == .starting)
        #expect(model.status == RecordSheetModel.startingMicrophone)
        #expect(model.isLive)
        #expect(!model.hasStarted)
        #expect(model.message == nil)
    }

    @Test func recordsAndStopsSavingUnderTheTuneAndCloses() async throws {
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Soldier's Joy"), userTune: UserTuneInput(status: "known"))
        let model = RecordSheetModel(recorder: recorder, tuneID: tuneID)
        await model.begin()
        try input.play(seconds: 1)

        #expect(model.phase == .recording)
        #expect(model.status == RecordingText.recording)
        #expect(model.hasStarted)
        #expect(model.showsTimer)
        #expect(abs(model.elapsedMilliseconds - 1000) < 20)

        await model.stop()
        let saved = try #require(try await recordings().first)
        #expect(saved.tuneID == tuneID)
        #expect(model.outcome == .saved(recordingID: saved.id))
    }

    @Test func aSaveWithSomethingToSayStaysOpenUntilDone() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)
        input.send(.writeFailed)
        try await eventually { model.phase == .saved }
        model.settle()

        #expect(model.outcome == nil)
        #expect(model.status == RecordSheetModel.saved)
        #expect(model.message == Recorder.partialSave)
        #expect(!model.isLive)

        model.finish()
        let saved = try #require(try await recordings().first)
        #expect(model.outcome == .saved(recordingID: saved.id))
    }

    @Test func cancelAsksFirstOnceAudioIsCapturedAndKeepsTheTakeWhenRefused() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)

        await model.cancel()
        #expect(model.confirmsDiscard)
        #expect(model.phase == .recording)

        model.confirmsDiscard = false
        #expect(model.outcome == nil)

        await model.discard()
        #expect(model.outcome == .dropped)
        #expect(try await recordings().isEmpty)
    }

    @Test func cancelDiscardsWithoutAskingWhileTheMicrophoneIsStarting() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        let begin = Task { await model.begin() }
        try await eventually { recorder.isStarting }
        await model.cancel()
        await begin.value

        #expect(!model.confirmsDiscard)
        #expect(model.outcome == .dropped)
        #expect(recorder.state == .idle)
    }

    @Test func anInterruptionPausesAndOffersResumeOnceItEnds() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)

        input.send(.interrupted)
        #expect(model.phase == .interrupted)
        #expect(model.status == RecordSheetModel.interrupted)
        #expect(model.isLive)
        #expect(!model.canResume)

        input.send(.interruptionEnded)
        #expect(model.canResume)
        await model.resume()
        #expect(model.phase == .recording)
    }

    @Test func aRefusedMicrophoneSaysSoAndOffersAWayOut() async throws {
        input.permission = false
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()

        #expect(model.phase == .notRecording)
        #expect(model.status == RecordSheetModel.notRecording)
        #expect(model.message == Recorder.microphoneDenied)
        #expect(!model.isLive)
        #expect(recorder.permissionDenied)

        await model.cancel()
        #expect(model.outcome == nil)
        model.finish()
        #expect(model.outcome == .dropped)
    }

    @Test func aSecondStopDoesNothing() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)

        async let first: Void = model.stop()
        async let second: Void = model.stop()
        _ = await (first, second)
        #expect(try await recordings().count == 1)
    }

    @Test func aSheetThatNeverGetsTheRecorderClosesHoldingNothing() async {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        #expect(model.isPending)
        await model.open(claim: { false })

        #expect(!model.isPending)
        #expect(model.outcome == .dropped)
        #expect(!model.holdsRecorder)
        #expect(!model.releaseRecorder())
        #expect(recorder.state == .idle)
    }

    @Test func aSheetThatGetsTheRecorderStartsAndGivesItBackOnce() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.open(claim: { true })
        #expect(model.phase == .recording)
        #expect(model.releaseRecorder())
        #expect(!model.releaseRecorder())
        await model.discard()
    }

    @Test func aSavedUnfiledTakeLandsOnRecordingsEvenWhenSwipedAway() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)
        #expect(!model.landsOnRecordings)
        input.send(.writeFailed)
        try await eventually { model.phase == .saved }
        model.settle()

        // Saved with a note, so the sheet stays up until it is swiped away with no outcome.
        #expect(model.outcome == nil)
        #expect(model.landsOnRecordings)
    }

    @Test func aTakeForATuneOrADiscardedOneStaysPut() async throws {
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Soldier's Joy"), userTune: UserTuneInput(status: "known"))
        let filed = RecordSheetModel(recorder: recorder, tuneID: tuneID)
        await filed.begin()
        try input.play(seconds: 0.5)
        await filed.stop()
        #expect(filed.outcome != nil)
        #expect(!filed.landsOnRecordings)

        let dropped = RecordSheetModel(recorder: recorder, tuneID: nil)
        await dropped.begin()
        try input.play(seconds: 0.5)
        await dropped.discard()
        #expect(dropped.outcome == .dropped)
        #expect(!dropped.landsOnRecordings)
    }

    @Test func mayAskForATakeOnlyOverNoneOrOneThatNeverShowed() async {
        #expect(RecordTake.mayReplace(nil))
        let pending = RecordTake(model: RecordSheetModel(recorder: recorder, tuneID: nil))
        #expect(RecordTake.mayReplace(pending))
        let shown = RecordTake(model: RecordSheetModel(recorder: recorder, tuneID: nil))
        await shown.model.open(claim: { false })
        #expect(!RecordTake.mayReplace(shown))
    }

    @Test func aSheetThatGoesAwayLiveKeepsTheTake() async throws {
        let model = RecordSheetModel(recorder: recorder, tuneID: nil)
        await model.begin()
        try input.play(seconds: 0.5)

        await model.abandon()
        #expect(try await recordings().count == 1)
        #expect(recorder.state == .idle)
    }
}

@Suite struct RecordFeedbackTests {
    @Test func startsAsCaptureBegins() {
        #expect(RecordSheetModel.feedback(from: .starting, to: .recording) == .start)
        #expect(RecordSheetModel.feedback(from: .interrupted, to: .recording) == nil)
    }

    @Test func stopsAsCaptureEndsWhateverTheSaveCameTo() {
        for old in [RecordPhase.recording, .interrupted] {
            for new in [RecordPhase.saving, .saved, .notRecording] {
                #expect(RecordSheetModel.feedback(from: old, to: new) == .stop)
            }
        }
        #expect(RecordSheetModel.feedback(from: .saving, to: .saved) == nil)
        #expect(RecordSheetModel.feedback(from: .starting, to: .notRecording) == nil)
    }
}

@MainActor
@Suite struct RecorderHostTests {
    private let root = TemporaryRoot()

    @Test func sharesOneRecorderPerStore() throws {
        let host = RecorderHost(makeInput: { ToneInput() })
        let first = try root.open("user_a")
        let second = try root.open("user_b")

        #expect(host.recorder(for: first) === host.recorder(for: first))
        #expect(host.recorder(for: second) !== host.recorder(for: first))
    }

    @Test func isFreeOnlyWhileNoSheetHoldsTheRecorder() throws {
        let host = RecorderHost(makeInput: { ToneInput() })
        let store = try root.open()

        #expect(host.isFree(for: store))
        _ = host.claim(for: store)
        #expect(!host.isFree(for: store))
        host.release()
        #expect(host.isFree(for: store))
    }

    @Test func oneSheetHoldsTheRecorderAtATime() throws {
        let host = RecorderHost(makeInput: { ToneInput() })
        let store = try root.open()

        #expect(host.claim(for: store) != nil)
        #expect(host.claim(for: store) == nil)
        host.release()
        #expect(host.claim(for: store) != nil)
    }

    @Test func aTakeStillSavingKeepsTheRecorderBusy() async throws {
        let input = ToneInput()
        let host = RecorderHost(makeInput: { input })
        let store = try root.open()
        let recorder = try #require(host.claim(for: store))
        await recorder.start(tuneID: nil)
        host.release()

        #expect(host.claim(for: store) == nil)
        await recorder.discard()
        #expect(host.claim(for: store) != nil)
    }
}

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}
