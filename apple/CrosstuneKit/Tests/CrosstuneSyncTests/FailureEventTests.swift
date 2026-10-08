import CrosstuneAPI
import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

/// A sync that fails, a recording that hits the storage limit, and an upload that is refused each
/// report once as they enter that state, by a reason that is never the error's text.
@MainActor
@Suite struct SyncFailureEventTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()
    let sink = RecordingAnalyticsSink()

    init() throws {
        store = try root.open()
    }

    private func engine(isOffline: Bool = false) -> SyncEngine {
        SyncEngine(
            store: store, api: api, isOffline: { isOffline }, batchSize: SyncEngine.pushBatchSize,
            sleep: sleeper.sleep, transferPass: {}, analytics: sink.client)
    }

    private func failed(_ reason: String) -> RecordingAnalyticsSink.Capture {
        .init(name: "sync_failed", properties: ["failure_reason": .string(reason)])
    }

    @Test func aSyncFailureReportsItsReasonOncePerFailure() async throws {
        let engine = engine()

        api.failure = APIStatusError(status: 503, detail: "Down for maintenance at db-7.internal")
        await engine.sync()
        await engine.sync()
        #expect(engine.status == .error)
        #expect(sink.captures == [failed("server_error")])

        api.failure = APIStatusError(status: 401)
        await engine.sync()
        #expect(sink.captures == [failed("server_error"), failed("auth_expired")])

        api.failure = nil
        await engine.sync()
        #expect(engine.status == .idle)

        api.failure = APIStatusError(status: 500)
        await engine.sync()
        #expect(sink.captures == [failed("server_error"), failed("auth_expired"), failed("server_error")])
        engine.stop()
    }

    @Test func aRetryOfTheSameFailureReportsNothingMore() async throws {
        let engine = engine()
        api.failure = APIStatusError(status: 500)

        await engine.sync()
        #expect(try await poll { sleeper.pendingCount == 1 })
        sleeper.fire()
        #expect(try await poll { sleeper.requested.count == 2 })

        #expect(sink.captures == [failed("server_error")])
        engine.stop()
    }

    /// An unreachable server reads as offline, so a network failure is never reported.
    @Test func anUnreachableServerIsNotAFailure() async throws {
        let engine = engine()
        api.failure = URLError(.cannotConnectToHost)

        await engine.sync()

        #expect(engine.status == .offline)
        #expect(sink.calls.isEmpty)
        engine.stop()
    }

    @Test func goingOfflineIsNotAFailure() async throws {
        let engine = engine(isOffline: true)

        await engine.sync()

        #expect(engine.status == .offline)
        #expect(sink.calls.isEmpty)
    }
}

@MainActor
extension TransfersTests {
    private func storageLimit(_ used: Int64) -> RecordingAnalyticsSink.Capture {
        .init(name: "storage_limit_reached", properties: ["storage_used": .string(Bucket.bytes(used))])
    }

    @Test func aFullStorageReportsTheLimitOnce() async throws {
        let sink = RecordingAnalyticsSink()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 95_000_000, quotaBytes: 100, maxFileBytes: 50))
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")
        let engine = engine(analytics: sink.client)

        await engine.transfer()
        #expect(try await file("r1")?.localState == .blockedQuota)
        #expect(sink.captures == [storageLimit(95_000_000)])

        // The figures show room, so the pass tries the file again and is refused again.
        try await store.setMeta(
            .storage, to: StorageFigures(usedBytes: 40_000_000, quotaBytes: 10_000_000_000, maxFileBytes: 50))
        await engine.transfer()
        await engine.transfer()
        #expect(api.transfers.filter { $0 == "slot r1" }.count == 3)
        #expect(sink.captures == [storageLimit(95_000_000)])

        try await captured("r2")
        api.transferFailures["slot r2"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")
        await engine.transfer()
        #expect(sink.captures == [storageLimit(95_000_000), storageLimit(40_000_000)])
    }

    /// Without the storage figures there is no use to report, and a guess would skew the chart.
    @Test func aFullStorageWithItsFiguresUnknownReportsNothing() async throws {
        let sink = RecordingAnalyticsSink()
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")

        await engine(analytics: sink.client).transfer()

        #expect(try await file("r1")?.localState == .blockedQuota)
        #expect(sink.calls.isEmpty)
    }

    @Test func aRefusedUploadReportsItsReasonAndOrigin() async throws {
        let sink = RecordingAnalyticsSink()
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(status: 422, detail: "Not an audio file at /tmp/take.m4a")

        await engine(analytics: sink.client).transfer()

        #expect(
            sink.captures == [
                .init(
                    name: "upload_failed",
                    properties: ["failure_reason": .string("other"), "origin": .string("recorded")])
            ])
    }

    @Test func aTransientUploadErrorReportsNothing() async throws {
        let sink = RecordingAnalyticsSink()
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(status: 503)

        await engine(analytics: sink.client).transfer()

        #expect(sink.calls.isEmpty)
    }
}
