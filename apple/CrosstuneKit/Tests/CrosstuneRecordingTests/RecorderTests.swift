@preconcurrency import AVFoundation
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneAudio
@testable import CrosstuneRecording

/// The device's channel setting as a test sets it.
@MainActor
final class ChannelSetting {
    var value = CaptureChannels.mono
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct RecorderTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let input = FakeInput()
    let setting = ChannelSetting()
    let location = FakeLocation()
    let clock = HeldSleep()
    let recorder: Recorder

    init() throws {
        store = try root.open()
        recorder = Recorder(
            store: store, input: input, channels: { [setting] in setting.value }, location: location,
            sleep: { [clock] in await clock.sleep($0) })
    }

    private func savedRow(_ id: String) async throws -> Recording {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
    }

    private func channelCount(of recordingID: String) throws -> AVAudioChannelCount {
        try AVAudioFile(forReading: CaptureFinisher(store: store).finishedURL(recordingID)).fileFormat.channelCount
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

    @Test func stoppingSavesTheRecordingUnderItsTune() async throws {
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
        let recordedAt = try #require(row.recordedAt)
        #expect(row.recordedPrecision == RecordingPrecision.time.rawValue)
        #expect(row.label == defaultRecordingLabel(recordedAt: recordedAt))
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: saved) }?.localState == .captured)
        #expect(fileExists(CaptureFinisher(store: store).finishedURL(saved)))
    }

    @Test func aPhoneCallPausesTheRecordingAndOffersResumeOnceItEnds() async throws {
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
        #expect(input.started == 0)
        #expect(try await captureID == nil)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
    }

    @Test func discardingWhileTheMicrophoneStartsBacksTheStartOut() async throws {
        input.holdsStart = true
        let start = Task { await recorder.start(tuneID: nil) }
        await input.startIsHeld()
        await recorder.discard()
        await input.finishStarting()
        await start.value

        #expect(recorder.state == .idle)
        #expect(input.stopped)
        #expect(input.started == 0)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func recordsStereoWhenTheSettingAndTheInputAllowIt() async throws {
        setting.value = .stereo
        input.inputChannels = 2
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        let saved = try #require(await recorder.stop())

        #expect(try channelCount(of: saved) == 2)
        #expect(input.preferred == .stereo)
    }

    @Test func recordsMonoFromAMonoInputEvenWhenStereoIsChosen() async throws {
        setting.value = .stereo
        input.inputChannels = 1
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        let saved = try #require(await recorder.stop())

        #expect(try channelCount(of: saved) == 1)
        #expect(input.writer?.bitrate == 64_000)
    }

    @Test func recordsMonoByDefault() async throws {
        input.inputChannels = 2
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        let saved = try #require(await recorder.stop())

        #expect(try channelCount(of: saved) == 1)
        #expect(input.preferred == .mono)
    }

    @Test func stereoDoublesTheQualitysRate() async throws {
        try await Commands(store: store).setAudioQuality(clerkUserID: store.userID, quality: "high")
        setting.value = .stereo

        await recorder.start(tuneID: nil)

        #expect(input.writer?.bitrate == 256_000)
        await recorder.discard()
    }

    @Test func stereoHighestAsksForThePassThroughRate() async throws {
        try await Commands(store: store).setAudioQuality(clerkUserID: store.userID, quality: "highest")
        setting.value = .stereo

        await recorder.start(tuneID: nil)

        #expect(input.writer?.bitrate == 320_000)
        await recorder.discard()
    }

    @Test func stoppingWhileTheMicrophoneResumesKeepsTheRecordingStopped() async throws {
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

    @Test func aResumeThatFailsSaysTheMicrophoneFailedAndKeepsTheRecordingPaused() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)
        input.send(.interruptionEnded)
        input.failsToResume = true

        await recorder.resume()

        #expect(recorder.state == .paused)
        #expect(recorder.errorMessage == Recorder.microphoneFailed)
        #expect(await recorder.stop() != nil, "the recording so far can still be saved")
    }

    @Test func aRecordingCanBeStoppedWhilePaused() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        input.send(.interrupted)

        #expect(await recorder.stop() != nil)
    }

    @Test func aFailedWriteKeepsWhatWasCapturedAndSaysSo() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        input.send(.writeFailed)
        try await eventually { recorder.state == .idle }

        #expect(recorder.savedRecordingID != nil)
        #expect(recorder.errorMessage == Recorder.partialSave)
    }

    @Test func aRecordingStopsAndSavesAtTheSizeLimit() async throws {
        let maxFileBytes = 100_000
        try await store.setMeta(
            .storage, to: StorageUsage(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: maxFileBytes))
        await recorder.start(tuneID: nil)

        var buffers = 0
        while recorder.state == .recording, buffers < 1_000 {
            try input.play(seconds: 0.1)
            buffers += 1
            await Task.yield()
        }
        try await eventually { recorder.state == .idle }

        let saved = try #require(recorder.savedRecordingID)
        #expect(recorder.errorMessage == Recorder.sizeLimit)
        let bytes = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: saved) }?.bytes)
        #expect(bytes < maxFileBytes)
        #expect(Double(bytes) > Double(maxFileBytes) * 0.9)
    }

    @Test func stoppingARecordingWithNoAudioSaysNothingWasRecorded() async throws {
        await recorder.start(tuneID: nil)

        #expect(await recorder.stop() == nil)

        #expect(recorder.errorMessage == Recorder.nothingRecorded)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
    }

    @Test func dismissingDuringThePermissionPromptBacksTheStartOut() async throws {
        input.holdsPermission = true

        let start = Task { await recorder.start(tuneID: nil) }
        try await eventually { recorder.isStarting }
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
        try await eventually { recorder.isStarting }
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

    @Test func aMicrophoneThatPreparesButWillNotStartLeavesNothingBehind() async throws {
        input.failsToStartEngine = true

        await recorder.start(tuneID: nil)

        #expect(recorder.state == .idle)
        #expect(recorder.errorMessage == Recorder.microphoneFailed)
        #expect(input.preferred != nil)
        #expect(input.stopped)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
        let files = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path())
        #expect(files.isEmpty)
    }

    @Test func launchRecoveryLeavesTheLiveRecordingAlone() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        await Recorder.recoverLeftoverCaptures(in: store)

        #expect(try await captureID != nil)
        await recorder.discard()
    }

    @Test func asksForTheLocationOnceTheMicrophoneIsAllowed() async throws {
        await recorder.start(tuneID: nil)

        #expect(location.requests == 1)
    }

    @Test func neverAsksForTheLocationWhenTheMicrophoneIsRefused() async throws {
        input.permission = false

        await recorder.start(tuneID: nil)

        #expect(location.requests == 0)
    }

    @Test func aFixSettledBeforeStopIsSavedWithItsAccuracyAndNoName() async throws {
        let fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.fix = fix
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        try await eventually { recorder.settledCoordinate != nil }

        let saved = try #require(await recorder.stop())

        let row = try await savedRow(saved)
        #expect(row.placeLat == fix.lat)
        #expect(row.placeLon == fix.lon)
        #expect(row.placeAccuracyM == 14)
        #expect(row.placeName == nil)
        #expect(recorder.errorMessage == nil)
        #expect(recorder.lateFixes.isEmpty)
        for _ in 0..<10 { await Task.yield() }
        #expect(clock.requested.isEmpty)
    }

    @Test func aFixStillPendingAtStopIsWrittenToTheSavedRecordingOnceItSettles() async throws {
        let fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.fix = fix
        location.holds = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()

        let saved = try #require(await recorder.stop())
        #expect(try await savedRow(saved).placeLat == nil)
        #expect(recorder.errorMessage == nil)
        await clock.hasText()
        #expect(clock.requested == [Recorder.lateFixWindow])
        await location.answer()
        await recorder.lateFixes[saved]?.value

        let row = try await savedRow(saved)
        #expect(row.placeLat == fix.lat)
        #expect(row.placeLon == fix.lon)
        #expect(row.placeAccuracyM == 14)
        #expect(row.placeName == nil)
        #expect(recorder.lateFixes[saved] == nil)
    }

    @Test func aFixThatSettlesWhileStopSavesIsWrittenOnceSaved() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()

        let stop = Task { await recorder.stop() }
        while recorder.state != .finishing { await Task.yield() }
        await location.answer()
        let saved = try #require(await stop.value)
        await recorder.lateFixes[saved]?.value

        #expect(try await savedRow(saved).placeAccuracyM == 14)
        #expect(recorder.settledCoordinate == nil)
    }

    @Test func theWindowClosingAfterStopCancelsTheFixAndWritesNothing() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        location.answersCancelledAtOnce = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()

        let saved = try #require(await recorder.stop())
        let late = try #require(recorder.lateFixes[saved])
        await clock.elapse()
        await late.value

        #expect(try await savedRow(saved).placeLat == nil)
    }

    @Test func aLateFixNeverReplacesAPlaceSetMeanwhile() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()

        let saved = try #require(await recorder.stop())
        let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.66, lon: -80.92))
        try await Commands(store: store).updateRecording(saved, place: .value(galax))
        await location.answer()
        await recorder.lateFixes[saved]?.value

        let row = try await savedRow(saved)
        #expect(row.place == galax)
        #expect(row.placeAccuracyM == nil)
    }

    @Test func aLocationClearedBeforeTheLateFixStaysCleared() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()

        let saved = try #require(await recorder.stop())
        try await Commands(store: store).updateRecording(saved, place: .value(nil))
        await location.answer()
        await recorder.lateFixes[saved]?.value

        let row = try await savedRow(saved)
        #expect(row.placeLat == nil)
        #expect(row.placeAccuracyM == nil)
    }

    @Test func aNewRecordingLeavesThePreviousRecordingsLateFixToLand() async throws {
        let fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.fix = fix
        location.holds = true
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        await location.hasText()
        let first = try #require(await recorder.stop())

        await recorder.start(tuneID: nil)
        #expect(recorder.state == .recording)
        await location.hasText(count: 2)
        await location.answer()
        await recorder.lateFixes[first]?.value

        #expect(try await savedRow(first).placeAccuracyM == 14)
        try await eventually { recorder.settledCoordinate != nil }
        #expect(recorder.settledCoordinate == fix)
        await recorder.discard()
    }

    @Test func discardingDropsTheFix() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        await recorder.start(tuneID: nil)
        try await eventually { recorder.settledCoordinate != nil }

        await recorder.discard()

        #expect(recorder.settledCoordinate == nil)
    }

    @Test func aFixThatSettlesAfterADiscardWritesNothing() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        await recorder.start(tuneID: nil)
        await location.hasText()

        await recorder.discard()
        await location.answer()
        for _ in 0..<10 { await Task.yield() }

        #expect(recorder.settledCoordinate == nil)
        #expect(recorder.lateFixes.isEmpty)
    }

    @Test func aBackedOutStartDropsTheFix() async throws {
        location.fix = Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14)
        location.holds = true
        input.failsToStart = true

        await recorder.start(tuneID: nil)
        #expect(location.requests == 1)
        await location.answer()
        for _ in 0..<10 { await Task.yield() }

        #expect(recorder.state == .idle)
        #expect(recorder.settledCoordinate == nil)
    }

    @Test func aRequestSettledBeforeStopStartsNoLateFixWindow() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)
        try await eventually { recorder.isFixSettled }

        let saved = try #require(await recorder.stop())

        #expect(try await savedRow(saved).placeLat == nil)
        #expect(recorder.lateFixes.isEmpty)
        for _ in 0..<10 { await Task.yield() }
        #expect(clock.requested.isEmpty)
    }

    @Test func noFixSavesNoPlaceAndNoError() async throws {
        await recorder.start(tuneID: nil)
        try input.play(seconds: 1)

        let saved = try #require(await recorder.stop())

        #expect(location.requests == 1)
        #expect(try await savedRow(saved).placeLat == nil)
        #expect(recorder.errorMessage == nil)
    }
}

@MainActor
@Suite struct RecorderStartTests {
    @Test func aSecondStartWhileTheFirstIsUnderWayBeginsNoSecondRecording() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let recorder = Recorder(store: store, input: FakeInput(), channels: { .mono })

        async let first: Void = recorder.start(tuneID: nil)
        async let second: Void = recorder.start(tuneID: nil)
        _ = await (first, second)

        #expect(recorder.state == .recording)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 1)
        await recorder.discard()
    }
}

@MainActor
@Suite struct UnfinishedCaptureTests {
    @Test func discardsALeftoverCaptureButNeverOneBeingRecorded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = newID()
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: nil, recordedAt: noon)
        let capture = CaptureFinisher(store: store).captureURL(id)
        try writeTone(to: capture, seconds: 1)
        let row = { try await store.read { db in try RecordingFile.fetchOne(db, key: id) } }

        Recorder.active.insert(id)
        #expect(Recorder.isRecording(id))
        try await Recorder.discardUnfinishedCapture(id, in: store)
        #expect(try await row() != nil)
        #expect(fileExists(capture))

        Recorder.active.remove(id)
        #expect(!Recorder.isRecording(id))
        try await Recorder.discardUnfinishedCapture(id, in: store)
        #expect(try await row() == nil)
        #expect(!fileExists(capture))
    }
}
