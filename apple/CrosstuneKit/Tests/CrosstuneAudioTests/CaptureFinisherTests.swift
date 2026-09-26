import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneAudio

private func recording(_ store: CrosstuneStore, _ id: String) async throws -> Recording? {
    try await store.read { db in try Recording.fetchOne(db, key: id) }
}

private func file(_ store: CrosstuneStore, _ id: String) async throws -> RecordingFile? {
    try await store.read { db in try RecordingFile.fetchOne(db, key: id) }
}

/// A capture as the recorder leaves it mid-take: its row, and a file of tone.
private func beginTone(
    _ store: CrosstuneStore, seconds: Double = 1, tuneID: String? = nil, recordedAt: Timestamp = noon
) async throws -> String {
    let id = newID()
    try await Commands(store: store).beginCapture(
        id, fileName: CaptureFiles.captureName(id), tuneID: tuneID, recordedAt: recordedAt)
    try writeTone(to: CaptureFinisher(store: store).captureURL(id), seconds: seconds)
    return id
}

@Suite struct CaptureFinisherTests {
    @Test func finishingExportsAnM4AAndWritesTheRecordingAndItsFile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Sally Goodin"), userTune: UserTuneInput(status: "known"))
        let id = try await beginTone(store, seconds: 2, tuneID: tuneID)
        let finisher = CaptureFinisher(store: store)

        #expect(try await finisher.finish(id))

        let finished = finisher.finishedURL(id)
        #expect(!fileExists(finisher.captureURL(id)))
        #expect(abs(try await duration(of: finished) - 2) < 0.1)
        let row = try #require(try await recording(store, id))
        #expect(row.tuneID == tuneID)
        #expect(row.source == "microphone")
        #expect(row.state == "pending_upload")
        #expect(row.recordedAt == noon)
        #expect(row.label == defaultRecordingLabel(recordedAt: noon))
        let local = try #require(try await file(store, id))
        #expect(local.localState == .captured)
        #expect(local.fileName == "\(id).m4a")
        #expect(local.contentType == "audio/mp4")
        #expect(local.bytes == (try FileManager.default.attributesOfItem(atPath: finished.path())[.size] as? Int64))
        #expect(abs((local.localDurationMs ?? 0) - 2000) < 100)
        #expect(try await store.pendingChanges(limit: 10).contains { $0.rowID == id })
    }

    @Test func aTuneDeletedDuringTheTakeLeavesTheRecordingUnfiled() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(
            TuneInput(title: "Forked Deer"), userTune: UserTuneInput(status: "known"))
        let id = try await beginTone(store, tuneID: tuneID)
        try await commands.deleteTune(tuneID)

        try await CaptureFinisher(store: store).finish(id)

        #expect(try await recording(store, id)?.tuneID == nil)
    }

    @Test func discardingDeletesTheAudioAndWritesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await beginTone(store)
        let finisher = CaptureFinisher(store: store)

        try await finisher.discard(id)

        #expect(!fileExists(finisher.captureURL(id)))
        #expect(try await file(store, id) == nil)
        #expect(try await recording(store, id) == nil)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func aCaptureWithNoAudioIsDiscardedRatherThanFinished() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = newID()
        let finisher = CaptureFinisher(store: store)
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: nil, recordedAt: noon)
        try Data().write(to: finisher.captureURL(id))

        #expect(try await finisher.finish(id) == false)

        #expect(!fileExists(finisher.captureURL(id)))
        #expect(try await file(store, id) == nil)
        #expect(try await recording(store, id) == nil)
    }
}

@Suite struct CaptureRecoveryTests {
    @Test func aCaptureCutShortIsFinishedUnderItsTuneAndStart() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Bonaparte's Retreat"), userTune: UserTuneInput(status: "known"))
        let id = newID()
        let finisher = CaptureFinisher(store: store)
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: tuneID, recordedAt: noon)
        let live = store.folder.appending(path: "live.aac")
        let writer = try writeTone(to: live, seconds: 2, close: false)
        // The capture as a crash would leave it: whatever reached disk, never finalized.
        try FileManager.default.copyItem(at: live, to: finisher.captureURL(id))
        writer.close()

        await finisher.recoverLeftovers()

        let row = try #require(try await recording(store, id))
        #expect(row.tuneID == tuneID)
        #expect(row.recordedAt == noon)
        #expect(row.label == defaultRecordingLabel(recordedAt: noon))
        #expect(try await file(store, id)?.localState == .captured)
        #expect(try await duration(of: finisher.finishedURL(id)) > 1.5)
        #expect(!fileExists(finisher.captureURL(id)))
    }

    @Test func aCaptureFileWithNoRowBecomesAnUnfiledRecording() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = newID()
        let finisher = CaptureFinisher(store: store)
        try writeTone(to: finisher.captureURL(id), seconds: 1)

        await finisher.recoverLeftovers()

        let row = try #require(try await recording(store, id))
        #expect(row.tuneID == nil)
        #expect(row.label != nil)
        #expect(try await file(store, id)?.localState == .captured)
    }

    @Test func aCaptureStillRecordingIsLeftAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await beginTone(store)
        let finisher = CaptureFinisher(store: store)

        await finisher.recoverLeftovers(skipping: [id])

        #expect(try await file(store, id)?.localState == .capturing)
        #expect(fileExists(finisher.captureURL(id)))
        #expect(try await recording(store, id) == nil)
    }

    @Test func anExportThatFinishedBeforeACrashIsRecordedAsItIs() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await beginTone(store)
        let finisher = CaptureFinisher(store: store)
        // As though the export and the capture's deletion ran, but not the write.
        try await finisher.finish(id)
        try await store.write { writer in
            try writer.db.execute(sql: "DELETE FROM recordings")
            try writer.db.execute(sql: "UPDATE recording_files SET local_state = 'capturing'")
        }

        await finisher.recoverLeftovers()

        #expect(try await recording(store, id) != nil)
        #expect(try await file(store, id)?.localState == .captured)
    }

    @Test func aTakeKilledAfterItsExportIsRecordedWhenTheStoreOpensAgain() async throws {
        let root = TemporaryRoot()
        let first = try root.open()
        let id = try await beginTone(first)
        try await CaptureFinisher(store: first).finish(id)
        // As the kill leaves it: only the finished file, and the row still capturing its capture.
        try await first.write { writer in
            try writer.db.execute(sql: "DELETE FROM recordings")
            try writer.db.execute(
                sql: "UPDATE recording_files SET local_state = 'capturing', file_name = ?",
                arguments: [CaptureFiles.captureName(id)])
        }
        try first.close()

        let store = try root.open()
        await Recorder.recoverLeftoverCaptures(in: store)

        #expect(try await recording(store, id) != nil)
        #expect(try await file(store, id)?.localState == .captured)
        #expect(fileExists(CaptureFinisher(store: store).finishedURL(id)))
    }

    @Test func aCaptureWithNoFileLeftIsForgotten() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = newID()
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: nil, recordedAt: noon)

        await CaptureFinisher(store: store).recoverLeftovers()

        #expect(try await file(store, id) == nil)
        #expect(try await recording(store, id) == nil)
    }

    @Test func aLeftoverCaptureOfAFinishedRecordingIsDeleted() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await beginTone(store)
        let finisher = CaptureFinisher(store: store)
        try await finisher.finish(id)
        try writeTone(to: finisher.captureURL(id), seconds: 0.5)

        await finisher.recoverLeftovers()

        #expect(!fileExists(finisher.captureURL(id)))
        #expect(try await store.read { db in try Recording.fetchCount(db) } == 1)
    }

    @Test func anAACFileItsRowNamesSurvivesRecoveryAndTheSweep() async throws {
        let root = TemporaryRoot()
        let first = try root.open()
        let id = newID()
        let name = CaptureFiles.captureName(id)
        try await Commands(store: first).addUploadedFile(
            id, fileName: name, contentType: "audio/aac", bytes: 1, tuneID: nil, label: "Jam", recordedAt: noon,
            at: noon)
        try writeTone(to: first.audioFolder.appending(path: name), seconds: 0.5)
        try first.close()

        let store = try root.open()
        await Recorder.recoverLeftoverCaptures(in: store)

        #expect(fileExists(store.audioFolder.appending(path: name)))
        #expect(try await file(store, id)?.localState == .captured)
        #expect(try await file(store, id)?.fileName == name)
    }
}

@Suite struct CaptureRecoveryCutoffTests {
    @Test func aCaptureBegunAfterRecoveryStartedIsLeftAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = try await beginTone(store, recordedAt: later(1000))

        await CaptureFinisher(store: store).recoverLeftovers(startedBefore: noon)

        #expect(try await file(store, id)?.localState == .capturing)
        #expect(fileExists(CaptureFinisher(store: store).captureURL(id)))
    }
}

@Suite struct CaptureRecoveryFailureTests {
    @Test func anUnreadableCaptureStaysAndDoesNotBlockTheOthers() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let finisher = CaptureFinisher(store: store)
        let bad = newID()
        try await Commands(store: store).beginCapture(
            bad, fileName: CaptureFiles.captureName(bad), tuneID: nil, recordedAt: noon)
        try Data((0..<5000).map { UInt8(truncatingIfNeeded: $0 &* 7919) }).write(to: finisher.captureURL(bad))
        let good = try await beginTone(store)

        let failed = await finisher.recoverLeftovers()

        #expect(failed == [bad])
        #expect(fileExists(finisher.captureURL(bad)))
        #expect(try await file(store, bad)?.localState == .capturing)
        #expect(try await recording(store, good) != nil)
    }

    @Test func finishingAnUnreadableCaptureThrowsAndKeepsIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let finisher = CaptureFinisher(store: store)
        let id = newID()
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: nil, recordedAt: noon)
        try Data(repeating: 0x41, count: 5000).write(to: finisher.captureURL(id))

        await #expect(throws: (any Error).self) { try await finisher.finish(id) }

        #expect(fileExists(finisher.captureURL(id)))
        #expect(try await file(store, id)?.localState == .capturing)
    }
}
