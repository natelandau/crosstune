import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneAudio

@MainActor
@Suite struct RecorderTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let input = FakeInput()
    let recorder: Recorder

    init() throws {
        store = try root.open()
        recorder = Recorder(store: store, input: input)
    }

    private var captureID: String? {
        get async throws {
            try await store.read { db in
                try RecordingFile.filter(RecordingFile.CodingKeys.localState == LocalFileState.capturing).fetchOne(db)?
                    .id
            }
        }
    }

    @Test func recordsIntoACaptureAndReportsLevelsAndTime() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        #expect(recorder.state == .recording)
        #expect(abs(recorder.elapsed - 1) < 0.01)
        #expect(recorder.levels.count == InputLevels.perSecond)
        #expect(recorder.levels.allSatisfy { $0 > 0.3 })
        let id = try #require(try await captureID)
        #expect(fileExists(CaptureFinisher(store: store).captureURL(id)))
    }

    @Test func countsEveryLevelPastTheWindow() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 4)

        #expect(recorder.levels.count == InputLevels.capacity)
        #expect(recorder.levelCount == 4 * InputLevels.perSecond)

        await recorder.stop()
        await recorder.start(tuneID: nil)
        #expect(recorder.levelCount == 0)
    }

    @Test func stoppingSavesTheTakeAsARecordingUnderItsTune() async throws {
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Soldier's Joy"), userTune: UserTuneInput(status: "known"))
        await recorder.start(tuneID: tuneID)
        try input.play(seconds: 1)

        let saved = try #require(await recorder.stop())

        #expect(recorder.state == .idle)
        #expect(recorder.savedRecordingID == saved)
        #expect(input.stopped)
        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: saved) })
        #expect(row.tuneID == tuneID)
        #expect(row.label == defaultRecordingLabel(recordedAt: row.recordedAt))
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: saved) }?.localState == .captured)
        #expect(fileExists(CaptureFinisher(store: store).finishedURL(saved)))
    }

    @Test func aPhoneCallPausesTheTakeAndOffersResumeOnceItEnds() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        input.send(.interrupted)
        #expect(recorder.state == .paused)
        #expect(!recorder.resumeAvailable)
        await recorder.resume()
        #expect(input.resumed == 0)

        input.send(.interruptionEnded)
        #expect(recorder.state == .paused)
        #expect(recorder.resumeAvailable)

        await recorder.resume()
        try input.play(seconds: 1)
        #expect(input.resumed == 1)
        #expect(recorder.state == .recording)
        #expect(!recorder.resumeAvailable)
        #expect(abs(recorder.elapsed - 2) < 0.01)
    }

    @Test func stoppingWhileTheMicrophoneStartsBacksTheStartOut() async throws {
        input.holdsStart = true
        let start = Task { await recorder.start(tuneID: nil) }
        await input.startIsHeld()
        #expect(await recorder.stop() == nil)
        await input.finishStarting()
        await start.value

        #expect(recorder.state == .idle)
        #expect(input.stopped)
        #expect(try await captureID == nil)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
    }

    @Test func stoppingWhileTheMicrophoneResumesKeepsTheTakeStopped() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)
        input.send(.interruptionEnded)
        input.holdsStart = true

        let resume = Task { await recorder.resume() }
        await input.startIsHeld()
        #expect(await recorder.stop() != nil)
        await input.finishStarting()
        await resume.value

        #expect(recorder.state == .idle)
    }

    @Test func aResumeThatFailsAfterAStopSaysNothing() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)
        input.send(.interruptionEnded)
        input.holdsStart = true
        input.failsToResume = true

        let resume = Task { await recorder.resume() }
        await input.startIsHeld()
        #expect(await recorder.stop() != nil)
        await input.finishStarting()
        await resume.value

        #expect(recorder.state == .idle)
        #expect(recorder.errorMessage == nil)
    }

    @Test func aResumeThatFailsSaysTheMicrophoneFailedAndKeepsTheTakePaused() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)
        input.send(.interruptionEnded)
        input.failsToResume = true

        await recorder.resume()

        #expect(recorder.state == .paused)
        #expect(recorder.errorMessage == Recorder.microphoneFailed)
        #expect(await recorder.stop() != nil, "the take so far can still be saved")
    }

    @Test func aTakeCanBeStoppedWhilePaused() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)

        #expect(await recorder.stop() != nil)
    }

    @Test func aFailedWriteKeepsWhatWasCapturedAndSaysSo() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        input.send(.writeFailed)
        while recorder.state != .idle { await Task.yield() }

        #expect(recorder.savedRecordingID != nil)
        #expect(recorder.errorMessage == Recorder.partialSave)
    }

    @Test func aTakeStopsAndSavesAtTheSizeLimit() async throws {
        let maxFileBytes = 100_000
        try await store.setMeta(
            .storage, to: StorageFigures(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: maxFileBytes))
        await recorder.start(tuneID: nil)

        var buffers = 0
        while recorder.state == .recording, buffers < 1_000 {
            try input.play(seconds: 0.1)
            buffers += 1
            await Task.yield()
        }
        while recorder.state != .idle { await Task.yield() }

        let saved = try #require(recorder.savedRecordingID)
        #expect(recorder.errorMessage == Recorder.sizeLimit)
        let bytes = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: saved) }?.bytes)
        #expect(bytes < maxFileBytes)
        #expect(Double(bytes) > Double(maxFileBytes) * 0.9)
    }

    @Test func stoppingATakeWithNoAudioSaysNothingWasRecorded() async throws {
        await recorder.start(tuneID: nil)

        #expect(await recorder.stop() == nil)

        #expect(recorder.errorMessage == Recorder.nothingRecorded)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
    }

    @Test func dismissingDuringThePermissionPromptBacksTheStartOut() async throws {
        input.holdsPermission = true

        let start = Task { await recorder.start(tuneID: nil) }
        while !recorder.isStarting { await Task.yield() }
        await recorder.discard()
        await input.answerPermission()
        await start.value

        #expect(recorder.state == .idle)
        #expect(input.started == 0)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func stoppingDuringThePermissionPromptBacksTheStartOut() async throws {
        input.holdsPermission = true

        let start = Task { await recorder.start(tuneID: nil) }
        while !recorder.isStarting { await Task.yield() }
        #expect(await recorder.stop() == nil)
        await input.answerPermission()
        await start.value

        #expect(recorder.state == .idle)
        #expect(recorder.errorMessage == nil)
        #expect(input.started == 0)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func discardingWritesNoRecording() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        let id = try #require(try await captureID)

        await recorder.discard()

        #expect(recorder.state == .idle)
        #expect(!fileExists(CaptureFinisher(store: store).captureURL(id)))
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
    }

    @Test func aRefusedMicrophoneSaysSoAndRecordsNothing() async throws {
        input.permission = false

        await recorder.start(tuneID: nil)

        #expect(recorder.state == .idle)
        #expect(recorder.permissionDenied)
        #expect(recorder.errorMessage == Recorder.microphoneDenied)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func aMicrophoneThatWillNotStartSaysSoAndLeavesNothingBehind() async throws {
        input.failsToStart = true

        await recorder.start(tuneID: nil)

        #expect(recorder.state == .idle)
        #expect(!recorder.permissionDenied)
        #expect(recorder.errorMessage == Recorder.microphoneFailed)
        #expect(input.stopped)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
        let files = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path())
        #expect(files.isEmpty)
    }

    @Test func launchRecoveryLeavesTheLiveTakeAlone() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        await Recorder.recoverLeftoverCaptures(in: store)

        #expect(try await captureID != nil)
        await recorder.discard()
    }
}

@MainActor
@Suite struct RecorderStartTests {
    @Test func aSecondStartWhileTheFirstIsUnderWayBeginsNoSecondTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let recorder = Recorder(store: store, input: FakeInput())

        async let first: Void = recorder.start(tuneID: nil)
        async let second: Void = recorder.start(tuneID: nil)
        _ = await (first, second)

        #expect(recorder.state == .recording)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 1)
        await recorder.discard()
    }
}
