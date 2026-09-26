import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync

@MainActor
@Suite struct TransfersTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()

    init() throws {
        store = try root.open()
    }

    func engine(isOffline: @escaping @MainActor () -> Bool = { false }) -> SyncEngine {
        SyncEngine(store: store, api: api, isOffline: isOffline, sleep: sleeper.sleep)
    }

    /// A finished capture whose recording row the server already has: a file in the audio
    /// folder, its `captured` file row, and a `pending_upload` recording with nothing queued.
    @discardableResult
    func captured(
        _ id: String, audio: String = "captured audio", state: LocalFileState = .captured,
        recordingState: String =
            "pending_upload", attempts: Int = 0, nextAttemptAt: Timestamp? = nil, queued: Bool = false
    ) async throws -> URL {
        let name = "\(id).m4a"
        let url = store.audioFolder.appending(path: name)
        try Data(audio.utf8).write(to: url)
        try await store.write { writer in
            try RecordingFile(
                id: id, localState: state, fileName: name, contentType: "audio/mp4; codecs=mp4a.40.2",
                bytes: Int64(audio.utf8.count), localDurationMs: 4_000, uploadAttempts: attempts,
                nextAttemptAt: nextAttemptAt
            ).insert(writer.db)
            try writer.put(
                Recording(
                    id: id, createdAt: noon, tuneID: nil, source: "microphone", recordedAt: noon,
                    state: recordingState))
            if !queued { try OutboxEntry.deleteAll(writer.db) }
        }
        return url
    }

    /// A recording the server has transcoded, with no audio on this device unless `file` says.
    func ready(_ id: String, file: RecordingFile? = nil) async throws {
        try await store.write { writer in
            try Recording(
                id: id, createdAt: noon, tuneID: nil, source: "microphone", recordedAt: noon, state: "ready",
                playbackMime: "audio/mp4"
            ).insert(writer.db)
            try file?.insert(writer.db)
        }
    }

    func file(_ id: String) async throws -> RecordingFile? {
        try await store.read { db in try RecordingFile.fetchOne(db, key: id) }
    }

    func recording(_ id: String) async throws -> Recording? {
        try await store.read { db in try Recording.fetchOne(db, key: id) }
    }

    func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    // MARK: Upload

    @Test func requestsASlotPutsTheFileAndConfirms() async throws {
        try await captured("r1", audio: "twelve bytes")
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers == ["slot r1", "put r1", "confirm r1"])
        #expect(api.slotRequests["r1"]?.bytes == 12)
        #expect(api.slotRequests["r1"]?.contentType == "audio/mp4")
        #expect(api.putBodies["r1"]?.data == Data("twelve bytes".utf8))
        #expect(api.putBodies["r1"]?.contentType == "audio/mp4")
        let file = try #require(try await file("r1"))
        #expect(file.localState == .uploaded)
        #expect(file.fileName == "r1.m4a")
        #expect(engine.transferStatus == .idle)
    }

    @Test func waitsUntilTheRecordingRowHasBeenPushed() async throws {
        try await captured("r1", queued: true)

        await engine().transfer()

        #expect(api.transfers.isEmpty)
        #expect(try await file("r1")?.localState == .captured)
    }

    @Test func marksAFileWhoseRecordingIsPastPendingAsUploaded() async throws {
        try await captured("r1", recordingState: "processing")

        await engine().transfer()

        #expect(api.transfers.isEmpty)
        #expect(try await file("r1")?.localState == .uploaded)
    }

    @Test func blocksAQuotaRefusalAndKeepsTheFile() async throws {
        let audio = try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .blockedQuota)
        #expect(file.error == "This recording would pass your storage quota.")
        #expect(exists(audio))
        #expect(engine.transferStatus == .idle)
    }

    @Test(arguments: [413, 422])
    func failsARefusalOfTheRequestItselfForGood(status: Int) async throws {
        try await captured("r1")
        try await captured("r2")
        api.transferFailures["slot r1"] = APIStatusError(status: status, detail: "The file is too large.")
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .failedUpload)
        #expect(file.error == "The file is too large.")
        #expect(file.uploadAttempts == 0)
        #expect(try await self.file("r2")?.localState == .uploaded)
        #expect(engine.transferStatus == .idle)
    }

    @Test func queuesTheRecordingAgainWhenTheSlotRequestFindsNoRow() async throws {
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(status: 404)

        await engine().transfer()

        #expect(try await file("r1")?.localState == .captured)
        let queued = try await store.pendingChanges(limit: 10)
        #expect(queued.map(\.rowID) == ["r1"])
        #expect(queued.first?.tableName == .recordings)
    }

    @Test func takesASlotConflictAsAlreadyUploaded() async throws {
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(status: 409)

        await engine().transfer()

        #expect(api.transfers == ["slot r1"])
        #expect(try await file("r1")?.localState == .uploaded)
    }

    @Test func backsOffATransientFailureAndKeepsItsReason() async throws {
        try await captured("r1", attempts: 2)
        api.transferFailures["slot r1"] = APIStatusError(status: 500)
        let engine = engine()
        let before = Timestamp.now

        await engine.transfer()

        let after = Timestamp.now
        let file = try #require(try await file("r1"))
        #expect(file.localState == .captured)
        #expect(file.uploadAttempts == 3)
        #expect(file.error == "API request failed with status 500")
        let next = try #require(file.nextAttemptAt).milliseconds
        // Two failures before this one: 30 seconds doubled twice.
        #expect(next >= before.milliseconds + 120_000 && next <= after.milliseconds + 120_000)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }

    @Test func doublesTheBackoffUpToHalfAnHour() {
        #expect(uploadBackoff(attempts: 0) == .seconds(30))
        #expect(uploadBackoff(attempts: 1) == .seconds(60))
        #expect(uploadBackoff(attempts: 5) == .seconds(960))
        #expect(uploadBackoff(attempts: 6) == .seconds(1_800))
        #expect(uploadBackoff(attempts: 200) == .seconds(1_800))
    }

    @Test func skipsAFileStillInItsBackoff() async throws {
        try await captured(
            "r1", attempts: 1, nextAttemptAt: Timestamp(milliseconds: Timestamp.now.milliseconds + 60_000))

        await engine().transfer()

        #expect(api.transfers.isEmpty)
    }

    @Test func clearsTheBackoffOnceARetriedUploadLands() async throws {
        try await captured("r1", attempts: 3, nextAttemptAt: Timestamp(milliseconds: 0))

        await engine().transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .uploaded)
        #expect(file.uploadAttempts == 0)
        #expect(file.nextAttemptAt == nil)
        #expect(file.error == nil)
    }

    @Test func asksForAFreshSlotWhenConfirmationFindsNoFile() async throws {
        try await captured("r1")
        api.transferFailures["confirm r1"] = APIStatusError(status: 409)
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .captured)
        #expect(file.uploadAttempts == 1)
        #expect(engine.transferStatus == .idle)
    }

    @Test func failsAConfirmationTheServerRefusesForItsSize() async throws {
        try await captured("r1")
        api.transferFailures["confirm r1"] = APIStatusError(status: 413, detail: "The upload does not match its size.")

        await engine().transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .failedUpload)
        #expect(file.error == "The upload does not match its size.")
    }

    @Test func reportsAFailedPutAsATransferError() async throws {
        try await captured("r1")
        api.transferFailures["put r1"] = TransferError(status: 403)
        let engine = engine()

        await engine.transfer()

        let file = try #require(try await file("r1"))
        #expect(file.localState == .captured)
        #expect(file.error == TransferError(status: 403).message)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }

    @Test func retriesAFileLeftUploading() async throws {
        try await captured("r1", state: .uploading)

        await engine().transfer()

        #expect(api.transfers == ["slot r1", "put r1", "confirm r1"])
    }

    @Test func holdsTheFirstTransientErrorAndStillSendsTheRest() async throws {
        try await captured("r1")
        try await captured("r2")
        api.transferFailures["slot r1"] = APIStatusError(status: 503)
        let engine = engine()

        await engine.transfer()

        #expect(try await file("r2")?.localState == .uploaded)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }

    @Test func anAuthFailureEndsThePass() async throws {
        try await captured("r1")
        try await captured("r2")
        api.transferFailures["slot r1"] = APIStatusError(status: 401)
        api.transferFailures["slot r2"] = APIStatusError(status: 401)
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers.count == 1)
        engine.stop()
    }

    @Test func skipsABlockedFileUntilTheFiguresShowRoom() async throws {
        try await captured("r1", audio: "0123456789", state: .blockedQuota)
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 95, quotaBytes: 100, maxFileBytes: 50))
        let engine = engine()

        await engine.transfer()
        #expect(api.transfers.isEmpty)

        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 50, quotaBytes: 100, maxFileBytes: 50))
        await engine.transfer()
        #expect(api.transfers == ["slot r1", "put r1", "confirm r1"])
    }

    @Test func aStopMidPassSendsNoFurtherRequest() async throws {
        try await captured("r1")
        try await captured("r2")
        let engine = engine()
        api.onTransfer = { entry in
            if entry.hasPrefix("slot") { engine.stop() }
        }

        await engine.transfer()

        #expect(api.transfers.count == 1)
        #expect(api.transfers.first?.hasPrefix("slot") == true)
        // Left for the next pass, which retries a file left uploading.
        let states = try await store.read { db in try RecordingFile.fetchAll(db).map(\.localState) }
        #expect(!states.contains(.uploaded))
    }

    @Test func aStopDuringThePutSendsNoConfirm() async throws {
        try await captured("r1")
        let engine = engine()
        api.onTransfer = { entry in
            if entry == "put r1" { engine.stop() }
        }

        await engine.transfer()

        #expect(api.transfers == ["slot r1", "put r1"])
    }

    @Test func aStoppedPassSendsNoSlotOrDownloadRequest() async throws {
        try await captured("r1")
        try await ready("d1")
        try await store.setMeta(.keepOffline, to: true)
        let stopped = Transfers(store: store, api: api, checkStopped: { throw RunStopped() })

        await #expect(throws: RunStopped.self) { _ = try await stopped.uploadPass() }
        await #expect(throws: RunStopped.self) {
            try await stopped.downloadPass { id in try await stopped.downloadOne(id) }
        }

        #expect(api.transfers.isEmpty)
    }

    @Test func failsAFileMissingFromDiskInsteadOfRetryingIt() async throws {
        let audio = try await captured("r1")
        try FileManager.default.removeItem(at: audio)
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers.isEmpty)
        let file = try #require(try await file("r1"))
        #expect(file.localState == .failedUpload)
        #expect(file.error == missingAudio)
        #expect(file.uploadAttempts == 0)
        #expect(engine.transferStatus == .idle)
    }

    @Test func sendsNothingWhileOffline() async throws {
        try await captured("r1")
        let engine = engine(isOffline: { true })

        await engine.transfer()

        #expect(api.transfers.isEmpty)
        #expect(engine.transferStatus == .offline)
        engine.stop()
    }

    // MARK: Tombstones

    @Test func dropsTheFileOfAnUploadedRecordingDeletedElsewhere() async throws {
        let audio = try await captured("r1", state: .uploaded, recordingState: "ready")
        try await store.write { writer in
            try writer.applyPullPage(rows: [(.recordings, Self.tombstone("r1"))], nextSince: 5)
        }

        await engine().transfer()

        #expect(try await file("r1") == nil)
        #expect(!exists(audio))
    }

    @Test func restoresARecordingDeletedElsewhereBeforeItsAudioUploaded() async throws {
        let audio = try await captured("r1", state: .failedUpload)
        try await store.write { writer in
            try writer.applyPullPage(rows: [(.recordings, Self.tombstone("r1"))], nextSince: 5)
        }
        api.transferFailures["slot r1"] = APIStatusError(status: 500)
        let engine = engine()

        await engine.transfer()

        let row = try #require(try await recording("r1"))
        #expect(row.deletedAt == nil)
        #expect(row.tuneID == nil)
        #expect(try await file("r1")?.localState == .captured)
        #expect(exists(audio))
        #expect(try await store.pendingChanges(limit: 10).map(\.rowID) == ["r1"])
        engine.stop()
    }

    @Test func letsADeleteFromElsewhereStandWhenTheAudioIsMissing() async throws {
        let audio = try await captured("r1", state: .failedUpload)
        try FileManager.default.removeItem(at: audio)
        try await store.write { writer in
            try writer.applyPullPage(rows: [(.recordings, Self.tombstone("r1"))], nextSince: 5)
        }

        await engine().transfer()

        #expect(try await recording("r1")?.deletedAt != nil)
        #expect(try await file("r1") == nil)
        #expect(try await store.pendingChanges(limit: 10).isEmpty)
    }

    @Test func dropsAFileWithNoRecordingRow() async throws {
        let url = store.audioFolder.appending(path: "orphan.m4a")
        try Data("x".utf8).write(to: url)
        try await store.write { writer in
            try RecordingFile(id: "orphan", localState: .downloaded, fileName: "orphan.m4a").insert(writer.db)
        }

        await engine().transfer()

        #expect(try await file("orphan") == nil)
        #expect(!exists(url))
    }

    @Test func leavesACaptureInProgressAlone() async throws {
        try await store.write { writer in
            try RecordingFile(id: "c1", localState: .capturing, fileName: "c1.aac").insert(writer.db)
        }

        await engine().transfer()

        #expect(try await file("c1")?.localState == .capturing)
    }

    nonisolated static func tombstone(_ id: String) -> JSONObject {
        [
            "id": .string(id), "created_at": .string(noon.iso), "updated_at": .string(later(60_000).iso),
            "deleted_at": .string(later(60_000).iso), "server_seq": .integer(5), "source": .string("microphone"),
            "recorded_at": .string(noon.iso), "position": .integer(0), "state": .string("ready"),
        ]
    }

    // MARK: Download

    @Test func keepOfflineDownloadsEveryReadyRecordingWithoutAFile() async throws {
        try await store.setMeta(.keepOffline, to: true)
        try await ready("d1")
        try await captured("mine", state: .uploaded, recordingState: "ready")

        await engine().transfer()

        #expect(api.transfers == ["url d1", "get d1"])
        let file = try #require(try await file("d1"))
        #expect(file.localState == .downloaded)
        #expect(file.contentType == "audio/mp4")
        #expect(file.bytes == Int64(api.objectData.count))
        let url = store.audioFolder.appending(path: try #require(file.fileName))
        #expect(try Data(contentsOf: url) == api.objectData)
        #expect(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }

    @Test func leavesCapturedAudioInTheBackup() async throws {
        let audio = try await captured("r1")

        await engine().transfer()

        #expect(try audio.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == false)
    }

    @Test func downloadsNothingAheadWhileKeepOfflineIsOff() async throws {
        try await ready("d1")

        await engine().transfer()

        #expect(api.transfers.isEmpty)
    }

    @Test func oneRecordingsFailedDownloadDoesNotStopTheRest() async throws {
        try await store.setMeta(.keepOffline, to: true)
        try await ready("d1", file: RecordingFile(id: "d1", localState: .uploaded))
        try await ready("d2")
        api.transferFailures["get d1"] = TransferError(status: 403)

        await engine().transfer()

        let failed = try #require(try await file("d1"))
        #expect(failed.localState == .uploaded)
        #expect(failed.error == TransferError(status: 403).message)
        #expect(failed.fileName == nil)
        #expect(try await file("d2")?.localState == .downloaded)
    }

    @Test func aFailedDownloadWaitsOutItsBackoffBeforeTheNextPassRetries() async throws {
        try await store.setMeta(.keepOffline, to: true)
        try await ready("d1")
        api.transferFailures["url d1"] = TransferError(status: 500)
        var now = ContinuousClock.now
        let engine = engine()
        engine.downloadRetries.now = { now }

        await engine.transfer()
        api.transferFailures = [:]
        await engine.transfer()
        #expect(api.transfers.filter { $0 == "url d1" }.count == 1)

        now = now.advanced(by: uploadBackoff(attempts: 0))
        await engine.transfer()
        #expect(api.transfers.filter { $0 == "url d1" }.count == 2)
        #expect(try await file("d1")?.localState == .downloaded)
    }

    @Test func noConnectionEndsTheDownloadPass() async throws {
        try await store.setMeta(.keepOffline, to: true)
        try await ready("d1")
        try await ready("d2")
        api.transferFailures["url d1"] = URLError(.notConnectedToInternet)
        api.transferFailures["url d2"] = URLError(.notConnectedToInternet)
        let engine = engine()

        await engine.transfer()

        #expect(api.transfers.count == 1)
        #expect(engine.transferStatus == .error)
        engine.stop()
    }

    @Test func recoversARowStuckDownloading() async throws {
        try await store.setMeta(.keepOffline, to: true)
        try await ready("d1", file: RecordingFile(id: "d1", localState: .downloading))

        await engine().transfer()

        #expect(try await file("d1")?.localState == .downloaded)
    }

    @Test func downloadReturnsTheLocalFileWithoutARequest() async throws {
        let audio = try await captured("r1", state: .uploaded, recordingState: "ready")

        let url = await engine().download("r1")

        #expect(url == audio)
        #expect(api.transfers.isEmpty)
    }

    @Test func downloadFetchesAReadyRecording() async throws {
        try await ready("d1")

        let url = try #require(await engine().download("d1"))

        #expect(try Data(contentsOf: url) == api.objectData)
        #expect(api.transfers == ["url d1", "get d1"])
    }

    @Test func downloadReturnsNilForARecordingNotReady() async throws {
        try await captured("r1", state: .uploaded, recordingState: "processing")
        try FileManager.default.removeItem(at: store.audioFolder.appending(path: "r1.m4a"))

        #expect(await engine().download("r1") == nil)
        #expect(api.transfers.isEmpty)
    }

    @Test func downloadWhileOfflineReturnsOnlyALocalFile() async throws {
        try await ready("d1")

        #expect(await engine(isOffline: { true }).download("d1") == nil)
        #expect(api.transfers.isEmpty)
    }

    @Test func aFailedDownloadOfANeverFetchedRecordingLeavesNoFileRow() async throws {
        try await ready("d1")
        api.transferFailures["get d1"] = TransferError(status: 500)

        #expect(await engine().download("d1") == nil)
        #expect(try await file("d1") == nil)
        let leftovers = try FileManager.default.contentsOfDirectory(
            atPath: store.audioFolder.path(percentEncoded: false))
        #expect(leftovers.isEmpty)
    }

    @Test func runsOneFetchForTwoDownloadsOfTheSameRecording() async throws {
        try await ready("d1")
        let engine = engine()
        let gate = Gate()
        api.onTransfer = { entry in
            if entry == "get d1" { await gate.wait() }
        }

        async let first = engine.download("d1")
        try await waitUntil { gate.isWaiting }
        #expect(engine.downloading == ["d1"])
        async let second = engine.download("d1")
        await Task.yield()
        gate.open()
        let urls = await [first, second]

        #expect(urls[0] != nil && urls[0] == urls[1])
        #expect(api.transfers == ["url d1", "get d1"])
        #expect(engine.downloading.isEmpty)
    }

    @Test func aStopMidDownloadSendsNoFurtherRequest() async throws {
        try await ready("d1")
        let engine = engine()
        api.onTransfer = { entry in
            if entry == "url d1" { engine.stop() }
        }

        #expect(await engine.download("d1") == nil)
        #expect(api.transfers == ["url d1"])
    }

    @Test func aDownloadAfterAStopSendsNothing() async throws {
        let stamp = later(1)
        try await ready("d1", file: RecordingFile(id: "d1", localState: .uploaded, updatedAt: stamp))
        let engine = engine()
        engine.stop()

        #expect(await engine.download("d1") == nil)

        #expect(api.transfers.isEmpty)
        #expect(try await file("d1")?.updatedAt == stamp)
    }

    @Test func aStoppedDownloadWritesNothing() async throws {
        let stamp = later(1)
        try await ready("d1", file: RecordingFile(id: "d1", localState: .uploaded, updatedAt: stamp))
        let stopped = Transfers(store: store, api: api, checkStopped: { throw RunStopped() })

        await #expect(throws: RunStopped.self) { _ = try await stopped.downloadOne("d1") }

        let file = try #require(try await file("d1"))
        #expect(file.localState == .uploaded)
        #expect(file.updatedAt == stamp)
    }

    @Test func aStopWhileMarkingADownloadSendsNoRequest() async throws {
        try await ready("d1")
        let checks = Counter()
        // Lets the check before the first write pass, as a stop that lands during that write.
        let transfers = Transfers(
            store: store, api: api,
            checkStopped: {
                checks.count += 1
                if checks.count > 1 { throw RunStopped() }
            })

        await #expect(throws: RunStopped.self) { _ = try await transfers.downloadOne("d1") }

        #expect(api.transfers.isEmpty)
    }

    @Test func stopAndWaitWaitsForADownloadInFlight() async throws {
        try await ready("d1")
        let engine = engine()
        let gate = Gate()
        api.onTransfer = { entry in
            if entry == "get d1" { await gate.wait() }
        }
        let download = Task { await engine.download("d1") }
        try await waitUntil { gate.isWaiting }

        let finished = Toggle(false)
        let stopping = Task {
            await engine.stopAndWait()
            finished.isOn = true
        }
        for _ in 0..<20 { await Task.yield() }
        #expect(!finished.isOn)

        gate.open()
        await stopping.value
        #expect(finished.isOn)
        _ = await download.value
    }

    // MARK: Retry

    @Test func retryAsksTheServerThenSyncs() async throws {
        let engine = engine()

        try await engine.retry("r1")

        #expect(api.transfers == ["retry r1"])
        try await waitUntil { api.pulls.count == 1 }
    }

    @Test func retryAfterAStopSendsNothing() async throws {
        let engine = engine()
        engine.stop()

        await #expect(throws: RunStopped.self) { try await engine.retry("r1") }

        #expect(api.transfers.isEmpty)
    }

    @Test func aRefusedRetryThrows() async throws {
        api.transferFailures["retry r1"] = APIStatusError(status: 409)

        await #expect(throws: APIStatusError(status: 409)) {
            try await engine().retry("r1")
        }
    }
}

/// Holds a request until the test opens it.
@MainActor
final class Gate {
    private var held: CheckedContinuation<Void, Never>?

    var isWaiting: Bool { held != nil }

    func wait() async {
        await withCheckedContinuation { held = $0 }
    }

    func open() {
        held?.resume()
        held = nil
    }
}
