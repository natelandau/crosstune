import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneCommands

@Suite struct DefaultRecordingLabelTests {
    @Test func namesARecordingForItsLocalStartTimeToTheMinute() throws {
        let denver = try #require(TimeZone(identifier: "America/Denver"))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = denver
        let date = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 9, day: 14, hour: 9, minute: 5, second: 59)))

        #expect(defaultRecordingLabel(recordedAt: Timestamp(date), timeZone: denver) == "2026-09-14 09:05")
    }

    @Test func formatsMidnightAndSingleDigitFieldsZeroPadded() throws {
        let utc = try #require(TimeZone(identifier: "UTC"))
        let midnight = Timestamp(iso: "2026-01-02T00:03:00.000Z")!

        #expect(defaultRecordingLabel(recordedAt: midnight, timeZone: utc) == "2026-01-02 00:03")
    }
}

@Suite struct UpdateRecordingTests {
    @Test func updatesLabelAndTuneAndQueuesTheRow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let recordingID = try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: .now)).id
        }

        try await commands.updateRecording(recordingID, label: .value("Recording 2"), tuneID: .value(tuneID))

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: recordingID) })
        #expect(row.label == "Recording 2")
        #expect(row.tuneID == tuneID)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == recordingID })
        #expect(queued.data?["label"] == .string("Recording 2"))
        #expect(queued.data?["tune_id"] == .string(tuneID))
    }

    @Test func attachingToATunePositionsAfterItsExistingRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: tuneID, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "r2", tuneID: nil, source: "microphone", addedAt: .now))
        }

        try await commands.updateRecording("r2", tuneID: .value(tuneID))

        #expect(try await store.read { db in try Recording.fetchOne(db, key: "r2") }?.position == 1)
    }

    @Test func detachingFromATuneKeepsItsPosition() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: tuneID, source: "microphone", addedAt: .now, position: 3))
        }

        try await commands.updateRecording("r1", tuneID: .value(nil))

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(row.tuneID == nil)
        #expect(row.position == 3)
    }

    @Test func putsAFailedUploadBackInTheQueueWhenTheRecordingIsEdited() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: .now))
            try RecordingFile(id: "r1", localState: .failedUpload, error: "bad type").insert(writer.db)
        }

        try await commands.updateRecording("r1", label: .value("Recording 3"))

        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") })
        #expect(file.localState == .captured)
        #expect(file.error == nil)
    }

    @Test func rejectsMovingARecordingToADeletedTuneAndLeavesTheRowUnchanged() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await commands.deleteTune(tuneID)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: .now))
        }
        let before = try await store.read { db in try Recording.fetchOne(db, key: "r1") }

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.updateRecording("r1", tuneID: .value(tuneID))
        }
        #expect(try await store.read { db in try Recording.fetchOne(db, key: "r1") } == before)
    }

    @Test func updatingSpeedAndPitchQueuesOneChangeWithoutServerFields() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: .now))
        }

        try await commands.updateRecording(
            "r1", trimStartMs: .value(500), trimEndMs: .value(9000), speedPercent: .value(120),
            pitchCents: .value(-200))

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(row.trimStartMs == 500)
        #expect(row.trimEndMs == 9000)
        #expect(row.speedPercent == 120)
        #expect(row.pitchCents == -200)
        #expect(try await store.pendingChangeCount() == 1)
        let data = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == "r1" }?.data)
        #expect(data["trim_start_ms"] == .integer(500))
        #expect(data["trim_end_ms"] == .integer(9000))
        #expect(data["speed_percent"] == .integer(120))
        #expect(data["pitch_cents"] == .integer(-200))
        #expect(!data.keys.contains("source_duration_ms"))
        #expect(!data.keys.contains("playback_start_ms"))
        #expect(!data.keys.contains("playback_end_ms"))
        #expect(!data.keys.contains("playback_rev"))
        #expect(!data.keys.contains("peaks_rev"))
    }

    @Test func rejectsAMissingOrDeletedRecording() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.updateRecording("missing", label: .value("X"))
        }
    }
}

@Suite struct DeleteRecordingTests {
    @Test func deletesWithATombstoneAndDropsTheLocalFile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: .now))
            try RecordingFile(id: "r1", localState: .captured).insert(writer.db)
        }

        try await commands.deleteRecording("r1")

        #expect(try await store.read { db in try Recording.fetchOne(db, key: "r1") }?.deletedAt != nil)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == "r1" })
        #expect(queued.op == .delete)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") } == nil)
    }

    @Test func deletingATuneTombstonesItsRecordingsWithoutASecondDeleteChange() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: tuneID, source: "microphone", addedAt: .now))
            try RecordingFile(id: "r1", localState: .captured).insert(writer.db)
        }

        try await commands.deleteTune(tuneID)

        #expect(try await store.read { db in try Recording.fetchOne(db, key: "r1") }?.deletedAt != nil)
        #expect(try await store.pendingChanges(limit: 10).first { $0.rowID == "r1" } == nil)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") } == nil)
    }
}

@Suite struct ActiveRecordingsForTuneTests {
    @Test func returnsALivesTunesRecordingsInPositionOrderOnly() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r2", tuneID: tuneID, source: "microphone", addedAt: .now, position: 1))
            try writer.put(Recording(id: "r1", tuneID: tuneID, source: "microphone", addedAt: .now, position: 0))
            try writer.put(
                Recording(
                    id: "r3", deletedAt: .now, tuneID: tuneID, source: "microphone", addedAt: .now,
                    position: 2))
        }

        #expect(try await commands.activeRecordingsForTune(tuneID).map(\.id) == ["r1", "r2"])
    }
}

@Suite struct CaptureCommandsTests {
    @Test func beginningACaptureWritesOnlyTheLocalFileRow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()

        try await Commands(store: store).beginCapture("r1", fileName: "r1.aac", tuneID: "t1", recordedAt: noon)

        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") })
        #expect(file.localState == .capturing)
        #expect(file.fileName == "r1.aac")
        #expect(file.tuneID == "t1")
        #expect(file.recordedAt == noon)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 0)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func finishingWritesTheRecordingAndItsCapturedFileTogether() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r0", tuneID: tuneID, source: "microphone", addedAt: noon))
        }
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: tuneID, recordedAt: noon)

        #expect(try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 1234, durationMs: 5000))

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(row.tuneID == tuneID)
        #expect(row.source == "microphone")
        #expect(row.addedAt == noon)
        #expect(row.recordedAt == noon)
        #expect(row.recordedPrecision == RecordingPrecision.time.rawValue)
        #expect(row.label == defaultRecordingLabel(recordedAt: noon))
        #expect(row.position == 1)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == "r1" })
        #expect(queued.data?["added_at"] == .string(noon.iso))
        #expect(queued.data?["recorded_at"] == .string(noon.iso))
        #expect(queued.data?["recorded_precision"] == .string("time"))
        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") })
        #expect(file.localState == .captured)
        #expect(file.fileName == "r1.m4a")
        #expect(file.contentType == "audio/mp4")
        #expect(file.bytes == 1234)
        #expect(file.localDurationMs == 5000)
        #expect(file.uploadAttempts == 0)
    }

    @Test func aNewCaptureDefaultsTrimSpeedAndPitch() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: nil, recordedAt: noon)

        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 1, durationMs: 1000)

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(row.trimStartMs == 0)
        #expect(row.trimEndMs == nil)
        #expect(row.speedPercent == 100)
        #expect(row.pitchCents == 0)
    }

    @Test func aRepeatedFinishOrOneAfterCancelDoesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: nil, recordedAt: noon)
        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 1, durationMs: 1)

        #expect(try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 2, durationMs: 2) == false)

        try await commands.beginCapture("r2", fileName: "r2.aac", tuneID: nil, recordedAt: noon)
        try await commands.cancelCapture("r2")
        #expect(try await commands.finishCapture("r2", fileName: "r2.m4a", bytes: 1, durationMs: 1) == false)
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 1)
    }

    @Test func cancellingLeavesAFinishedRecordingsFileAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: nil, recordedAt: noon)
        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 1, durationMs: 1)

        try await commands.cancelCapture("r1")

        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") }?.localState == .captured)
    }

    @Test func addingAnUploadedFileWritesAnUploadRecording() async throws {
        let root = TemporaryRoot()
        let store = try root.open()

        let id = try await Commands(store: store).addUploadedFile(
            fileName: "take.wav", contentType: nil, bytes: 99, tuneID: nil, label: "Take", at: noon)

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
        #expect(row.source == "upload")
        #expect(row.label == "Take")
        #expect(row.addedAt == noon)
        #expect(row.recordedAt == nil)
        #expect(row.recordedPrecision == nil)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(queued.data?["added_at"] == .string(noon.iso))
        #expect(queued.data?["recorded_at"] == .null)
        #expect(queued.data?["recorded_precision"] == .null)
        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: id) })
        #expect(file.localState == .captured)
        #expect(file.contentType == "application/octet-stream")
        #expect(file.bytes == 99)
    }
}

@Suite struct RecordingDateTests {
    private func take(_ store: CrosstuneStore) async throws -> String {
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: nil, recordedAt: noon)
        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 1, durationMs: 1, at: noon)
        return "r1"
    }

    private func row(_ store: CrosstuneStore, _ id: String) async throws -> Recording {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
    }

    @Test func thePrecisionsAreTheAPIsOwn() {
        #expect(RecordingPrecision.allCases.map(\.rawValue) == Vocabulary.recordingPrecisions)
    }

    @Test func writesAPartialDateAndQueuesItKeepingWhenItWasAdded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)
        let year = try #require(Timestamp(iso: "1937-01-01T00:00:00.000Z"))

        try await Commands(store: store).updateRecordingDate(id, recordedAt: year, precision: .year)

        let saved = try await row(store, id)
        #expect(saved.addedAt == noon)
        #expect(saved.recordedAt == year)
        #expect(saved.recordedPrecision == "year")
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(queued.data?["recorded_at"] == .string(year.iso))
        #expect(queued.data?["recorded_precision"] == .string("year"))
        #expect(queued.data?["added_at"] == .string(noon.iso))
    }

    @Test func clearsTheRecordedDateAndKeepsWhenItWasAdded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)

        try await Commands(store: store).updateRecordingDate(id, recordedAt: nil, precision: nil)

        let saved = try await row(store, id)
        #expect(saved.addedAt == noon)
        #expect(saved.recordedAt == nil)
        #expect(saved.recordedPrecision == nil)
    }

    @Test func refusesADateWithoutItsPrecisionOrTheReverse() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)
        let before = try await row(store, id)
        let commands = Commands(store: store)

        await #expect(throws: CommandError.recordedDateMismatch) {
            try await commands.updateRecordingDate(id, recordedAt: noon, precision: nil)
        }
        await #expect(throws: CommandError.recordedDateMismatch) {
            try await commands.updateRecordingDate(id, recordedAt: nil, precision: .year)
        }
        #expect(try await row(store, id) == before)
        #expect(CommandError.recordedDateMismatch.errorDescription == CommandError.recordedDateMismatchMessage)
    }

    @Test func refusesAPartialDateOffTheStartOfItsPeriod() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)
        let commands = Commands(store: store)

        for (iso, precision) in [
            ("1937-05-01T00:00:00.000Z", RecordingPrecision.year),
            ("1998-05-02T00:00:00.000Z", .month),
            ("1998-10-03T04:00:00.000Z", .day),
            ("1998-10-03T00:00:00.001Z", .day),
        ] {
            let at = try #require(Timestamp(iso: iso))
            await #expect(throws: CommandError.recordedDateOffPeriod) {
                try await commands.updateRecordingDate(id, recordedAt: at, precision: precision)
            }
        }
        #expect(try await row(store, id).recordedAt == noon)

        for (iso, precision) in [
            ("1937-01-01T00:00:00.000Z", RecordingPrecision.year),
            ("1998-05-01T00:00:00.000Z", .month),
            ("1998-10-03T00:00:00.000Z", .day),
            ("1998-10-03T04:12:30.500Z", .time),
        ] {
            let at = try #require(Timestamp(iso: iso))
            try await commands.updateRecordingDate(id, recordedAt: at, precision: precision)
            #expect(try await row(store, id).recordedAt == at)
        }
    }

    @Test func acceptsADateExactlyADayAhead() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)
        let commands = Commands(store: store)
        let now = Timestamp(iso: "2026-10-04T12:00:00.000Z")!
        let edge = Timestamp(iso: "2026-10-05T00:00:00.000Z")!

        try await commands.updateRecordingDate(id, recordedAt: edge, precision: .day, at: now)
        #expect(try await row(store, id).recordedAt == edge)
        await #expect(throws: CommandError.recordedDateFuture) {
            try await commands.updateRecordingDate(
                id, recordedAt: Timestamp(iso: "2026-10-06T00:00:00.000Z")!, precision: .day, at: now)
        }
    }

    @Test func refusesAPartialDateMoreThanADayAheadButNotATime() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await take(store)
        let commands = Commands(store: store)
        let now = Timestamp.now
        let ahead = Timestamp(milliseconds: now.milliseconds + 48 * 60 * 60_000)

        await #expect(throws: CommandError.recordedDateFuture) {
            try await commands.updateRecordingDate(
                id, recordedAt: Timestamp(iso: "2999-06-01T00:00:00.000Z")!, precision: .month, at: now)
        }
        await #expect(throws: CommandError.recordedDateFuture) {
            try await commands.updateRecordingDate(
                id, recordedAt: Timestamp(iso: "2999-01-01T00:00:00.000Z")!, precision: .year, at: now)
        }
        #expect(try await row(store, id).recordedAt == noon)

        // A captured time saves whatever the device clock says.
        try await commands.updateRecordingDate(id, recordedAt: ahead, precision: .time, at: now)
        #expect(try await row(store, id).recordedAt == ahead)
    }

    @Test func refusesAMissingRecording() async throws {
        let root = TemporaryRoot()
        let store = try root.open()

        await #expect(throws: CommandError.recordingNotFound) {
            try await Commands(store: store).updateRecordingDate("missing", recordedAt: nil, precision: nil)
        }
    }
}

@Suite struct DeletingAudioTests {
    /// A finished recording under `tuneID` with a file of audio in the user's folder.
    private func recordingWithAudio(_ store: CrosstuneStore, tuneID: String?) async throws -> URL {
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: tuneID, recordedAt: noon)
        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 3, durationMs: 1)
        let audio = store.audioFolder.appending(path: "r1.m4a")
        try Data([1, 2, 3]).write(to: audio)
        return audio
    }

    @Test func deletingARecordingDeletesItsPeaksFileToo() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.beginCapture("r1", fileName: "r1.aac", tuneID: nil, recordedAt: noon)
        try await commands.finishCapture("r1", fileName: "r1.m4a", bytes: 3, durationMs: 1, peaksFileName: "r1.peaks")
        let peaks = store.audioFolder.appending(path: "r1.peaks")
        try Data([1, 0, 50]).write(to: peaks)

        try await commands.deleteRecording("r1")

        #expect(!FileManager.default.fileExists(atPath: peaks.path()))
    }

    @Test func deletingARecordingDeletesItsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let audio = try await recordingWithAudio(store, tuneID: nil)

        try await Commands(store: store).deleteRecording("r1")

        #expect(!FileManager.default.fileExists(atPath: audio.path()))
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func deletingATuneDeletesItsRecordingsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let audio = try await recordingWithAudio(store, tuneID: tuneID)

        try await commands.deleteTune(tuneID)

        #expect(!FileManager.default.fileExists(atPath: audio.path()))
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 0)
    }

    @Test func deletingTunesTogetherDeletesTheirRecordingsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, userTuneID) = try await commands.createTune(
            TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let audio = try await recordingWithAudio(store, tuneID: tuneID)

        try await commands.deleteTunes([userTuneID])

        #expect(!FileManager.default.fileExists(atPath: audio.path()))
    }

    @Test func aFailedDeleteKeepsTheAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let audio = try await recordingWithAudio(store, tuneID: nil)

        await #expect(throws: (any Error).self) {
            try await store.writeDroppingFiles { writer in
                try writer.deleteRecording("r1")
                throw CommandError.recordingNotFound
            }
        }

        #expect(FileManager.default.fileExists(atPath: audio.path()))
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) } == 1)
    }
}

@Suite struct DownloadedAudioTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore

    init() throws {
        store = try root.open()
    }

    /// A recording in `state` on the server whose file on this device is in `local`, with
    /// `bytes` of audio on disk.
    @discardableResult
    func recording(_ id: String, state: String, local: LocalFileState, bytes: Int = 3) async throws -> URL {
        let url = store.audioFolder.appending(path: "\(id).m4a")
        try Data(repeating: 1, count: bytes).write(to: url)
        try await store.write { writer in
            try Recording(id: id, createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon, state: state)
                .insert(writer.db)
            try RecordingFile(id: id, localState: local, fileName: "\(id).m4a", bytes: Int64(bytes)).insert(writer.db)
        }
        return url
    }

    func file(_ id: String) async throws -> RecordingFile? {
        try await store.read { db in try RecordingFile.fetchOne(db, key: id) }
    }

    func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    @Test func removesOnlyAudioTheServerCanServeBack() async throws {
        let downloaded = try await recording("d1", state: "ready", local: .downloaded)
        let uploaded = try await recording("u1", state: "ready", local: .uploaded)
        let processing = try await recording("p1", state: "processing", local: .uploaded)
        let waiting = try await recording("w1", state: "pending_upload", local: .captured)

        try await Commands(store: store).clearDownloadedAudio()

        #expect(!exists(downloaded))
        #expect(!exists(uploaded))
        #expect(exists(processing))
        #expect(exists(waiting))
        let cleared = try #require(try await file("d1"))
        #expect(cleared.fileName == nil)
        #expect(cleared.bytes == 0)
        #expect(cleared.localState == .downloaded)
        #expect(try await file("p1")?.fileName == "p1.m4a")
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func countsTheAudioThisDeviceHolds() async throws {
        try await recording("d1", state: "ready", local: .downloaded, bytes: 100)
        try await recording("w1", state: "pending_upload", local: .captured, bytes: 20)
        try await store.write { writer in
            try RecordingFile(id: "gone", localState: .downloaded, bytes: 0).insert(writer.db)
        }

        #expect(try await store.read(RecordingFile.localAudioBytes) == 120)

        try await Commands(store: store).clearDownloadedAudio()

        #expect(try await store.read(RecordingFile.localAudioBytes) == 20)
    }

    @Test func retryingAnUploadPutsItBackAtTheFrontOfTheQueue() async throws {
        try await recording("f1", state: "pending_upload", local: .failedUpload)
        try await store.write { writer in
            var file = try #require(try RecordingFile.fetchOne(writer.db, key: "f1"))
            file.error = "The file is too large."
            file.uploadAttempts = 4
            file.nextAttemptAt = later(60_000)
            try file.update(writer.db)
        }

        try await Commands(store: store).retryUpload("f1")

        let file = try #require(try await file("f1"))
        #expect(file.localState == .captured)
        #expect(file.error == nil)
        #expect(file.uploadAttempts == 0)
        #expect(file.nextAttemptAt == nil)
    }

    @Test func retryingLeavesAnUploadedFileAlone() async throws {
        try await recording("u1", state: "ready", local: .uploaded)

        try await Commands(store: store).retryUpload("u1")

        #expect(try await file("u1")?.localState == .uploaded)
    }
}
