import CrosstuneStore
@_spi(Testing) import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

@MainActor
@Suite(.timeLimit(.minutes(1))) struct HandoffCompletionTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let transport = FakeUploadTransport()
    let sleeper = ManualSleeper()
    let handoff = liveHandoff("rec-1")

    init() async throws {
        store = try root.open()
        try await insertHandedOffFile(store, "rec-1", handoff: handoff, uploadAttempts: 2)
    }

    /// Offline unless asked, so the pass a hand-back starts sends nothing and leaves the row as
    /// the completion wrote it.
    func engine(isOffline: Bool = true) -> SyncEngine {
        SyncEngine(store: store, api: api, uploads: transport, isOffline: { isOffline }, sleep: sleeper.sleep)
    }

    func tag(_ step: UploadStep, url: URL? = nil) -> UploadTaskTag {
        UploadTaskTag(recordingID: "rec-1", userID: store.userID, step: step, url: url ?? handoff.url)
    }

    func file() async throws -> RecordingFile {
        try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: "rec-1") })
    }

    @Test func aLandedPutConfirmsWithTheToken() async throws {
        let engine = engine()

        await transport.finish(tag(.put), .status(200))

        #expect(api.transfers == ["token-confirm rec-1 token-rec-1"])
        let file = try await file()
        #expect(file.localState == .uploaded)
        #expect(file.handoff == nil)
        #expect(file.uploadAttempts == 0)
        engine.stop()
    }

    @Test(arguments: [404, 409, 413])
    func aRefusedConfirmMarksTheHandoffRefused(status: Int) async throws {
        api.transferFailures["token-confirm rec-1 token-rec-1"] = APIStatusError(
            status: status, detail: "Refused with \(status).")
        let engine = engine()

        await transport.finish(tag(.put), .status(200))

        let file = try await file()
        #expect(file.handoff?.refused == true)
        #expect(file.handoff?.refusedStatus == status)
        #expect(file.error == "Refused with \(status).")
        #expect(file.localState == .uploading)
        engine.stop()
    }

    @Test func aHandedBackFileIsSettledWithoutWaitingForASync() async throws {
        api.transferFailures["token-confirm rec-1 token-rec-1"] = APIStatusError(status: 409)
        let engine = engine(isOffline: false)

        await transport.finish(tag(.put), .status(200))

        try await eventually { try await file().handoff == nil }
        let file = try await file()
        #expect(file.localState == .captured)
        #expect(file.uploadAttempts == 3)
        #expect(file.nextAttemptAt != nil)
        engine.stop()
    }

    @Test func aPassWhileACompletionIsHandledStartsNoSecondTask() async throws {
        let confirming = Gate()
        api.onTransfer = { entry in
            if entry.hasPrefix("token-confirm") { await confirming.wait() }
        }
        let engine = engine(isOffline: false)
        let completion = Task { await transport.finish(tag(.put), .status(200)) }
        try await eventually { confirming.isWaiting }

        await engine.transfer()

        #expect(transport.startedPuts.isEmpty)
        #expect(transport.startedConfirms.isEmpty)
        #expect(api.transfers.isEmpty)
        confirming.open()
        await completion.value
        #expect(try await file().localState == .uploaded)
        engine.stop()
    }

    @Test func aConfirmNetworkErrorQueuesABackgroundConfirm() async throws {
        api.transferFailures["token-confirm rec-1 token-rec-1"] = URLError(.notConnectedToInternet)
        let engine = engine()

        await transport.finish(tag(.put), .status(200))

        let file = try await file()
        #expect(file.handoff?.putLanded == true)
        // The queued confirm's answer counts the try.
        #expect(file.handoff?.attempts == 0)
        #expect(file.nextAttemptAt != nil)
        #expect(transport.startedConfirms == ["rec-1"])
        #expect(transport.confirms.first?.tag == tag(.confirm))
        #expect(transport.confirms.first?.token == "token-rec-1")
        engine.stop()
    }

    @Test func aFailedPutCountsARetry() async throws {
        let engine = engine()

        await transport.finish(tag(.put), .status(403))

        let file = try await file()
        #expect(file.handoff?.attempts == 1)
        #expect(file.handoff?.putLanded == false)
        #expect(file.nextAttemptAt != nil)
        #expect(file.error == TransferError(status: 403).message)
        #expect(api.transfers.isEmpty)
        #expect(transport.startedConfirms.isEmpty)
        engine.stop()
    }

    @Test func aFailedPutIsRetriedAfterItsBackoff() async throws {
        let engine = engine(isOffline: false)

        await transport.finish(tag(.put), .status(500))
        try await eventually { sleeper.pendingCount == 1 }
        #expect(transport.startedPuts.isEmpty)
        try await store.write { writer in
            try writer.updateFile("rec-1") {
                $0.nextAttemptAt = Timestamp(milliseconds: Timestamp.now.milliseconds - 1)
            }
        }
        sleeper.fire()

        try await eventually { transport.startedPuts == ["rec-1"] }
        engine.stop()
    }

    @Test func aFailedBackgroundConfirmWaitsForItsBackoff() async throws {
        let engine = engine()

        await transport.finish(tag(.confirm), .status(503))

        let file = try await file()
        #expect(file.handoff?.attempts == 1)
        #expect(file.nextAttemptAt != nil)
        #expect(transport.startedConfirms.isEmpty)
        engine.stop()
    }

    @Test func aCompletionForAReplacedHandoffChangesNothing() async throws {
        let before = try await file()
        let engine = engine()

        await transport.finish(tag(.put, url: URL(string: "https://bucket.test/put/older")!), .status(200))

        #expect(try await file() == before)
        #expect(api.transfers.isEmpty)
        engine.stop()
    }

    @Test func aBackgroundConfirmSettlesTheFile() async throws {
        let engine = engine()

        await transport.finish(tag(.confirm), .status(204))

        let file = try await file()
        #expect(file.localState == .uploaded)
        #expect(file.handoff == nil)
        #expect(api.transfers.isEmpty)
        engine.stop()
    }

    @Test func aConfirmAnswerAfterAStopWritesNothing() async throws {
        let engine = engine()
        api.onTransfer = { entry in
            if entry.hasPrefix("token-confirm") { engine.stop() }
        }

        await transport.finish(tag(.put), .status(200))

        #expect(api.transfers == ["token-confirm rec-1 token-rec-1"])
        let file = try await file()
        #expect(file.localState == .uploading)
        #expect(file.handoff?.attempts == 0)
        #expect(file.handoff?.refused == false)
    }

    @Test func aStoppedEngineHandlesACompletionOnlyOnceItResumes() async throws {
        let engine = engine()
        engine.stop()

        await transport.finish(tag(.confirm), .status(204))
        #expect(try await file().localState == .uploading)

        engine.resume()
        await transport.waitForHandledEvents()
        #expect(try await file().localState == .uploaded)
        engine.stop()
    }
}
