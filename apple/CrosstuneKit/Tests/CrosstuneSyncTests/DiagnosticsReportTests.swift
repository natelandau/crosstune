import CrosstuneAPI
import CrosstuneDiagnostics
import CrosstuneStore
@_spi(Testing) import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

/// A sync or transfer streak that lasts is reported to diagnostics by area, unless it only means
/// the session has expired.
@MainActor
@Suite struct SyncDiagnosticsTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()
    let sink = RecordingDiagnosticsSink()
    let clock = TestClock(Date(timeIntervalSince1970: 1_800_000_000))

    init() throws {
        store = try root.open()
    }

    private func engine(transferPass: @escaping @MainActor () async throws -> Void = {}) -> SyncEngine {
        let clock = clock
        return SyncEngine(
            store: store, api: api, isOffline: { false }, batchSize: SyncEngine.pushBatchSize,
            sleep: sleeper.sleep, transferPass: transferPass, diagnostics: sink.client, now: { clock.now })
    }

    /// Fails a run of `loop`, then each retry a minute after the last, until `minutes` have passed.
    private func failForMinutes(
        _ minutes: Int, engine: SyncEngine, loop: (SyncEngine) async -> Void = { await $0.sync() }
    ) async throws {
        await loop(engine)
        for _ in 0..<minutes {
            clock.now += 60
            try await waitUntil { sleeper.pendingCount == 1 }
            let asked = sleeper.requested.count
            sleeper.fire()
            try await waitUntil { sleeper.requested.count == asked + 1 }
        }
    }

    @Test func unauthorizedNeverReportsDiagnostics() async throws {
        let engine = engine()
        api.failure = APIStatusError(status: 401)

        try await failForMinutes(6, engine: engine)

        #expect(engine.status == .unauthorized)
        #expect(sink.reports.isEmpty)
        engine.stop()
    }

    @Test func lastingSyncErrorReportsSyncArea() async throws {
        let engine = engine()
        api.failure = APIStatusError(status: 500)

        try await failForMinutes(10, engine: engine)

        #expect(engine.status == .error)
        #expect(sink.reports.map(\.area) == [.sync])
        #expect((sink.reports.first?.error as? APIStatusError)?.status == 500)
        engine.stop()
    }

    @Test func unauthorizedTransferNeverReportsDiagnostics() async throws {
        let engine = engine(transferPass: { throw APIStatusError(status: 401) })

        try await failForMinutes(6, engine: engine) { await $0.transfer() }

        #expect(engine.transferStatus == .error)
        #expect(sink.reports.isEmpty)
        engine.stop()
    }

    @Test func lastingTransferErrorReportsTransferArea() async throws {
        let engine = engine(transferPass: { throw APIStatusError(status: 500) })

        try await failForMinutes(10, engine: engine) { await $0.transfer() }

        #expect(engine.transferStatus == .error)
        #expect(sink.reports.map(\.area) == [.transfer])
        #expect((sink.reports.first?.error as? APIStatusError)?.status == 500)
        engine.stop()
    }
}

/// An upload that fails for good is reported to diagnostics beside its analytics event; one the
/// storage quota holds back is not.
@MainActor
extension TransfersTests {
    @Test func missingAudioReportsUpload() async throws {
        let sink = RecordingDiagnosticsSink()
        let audio = try await captured("r1")
        try FileManager.default.removeItem(at: audio)

        await engine(diagnostics: sink.client).transfer()

        #expect(sink.reports.map(\.area) == [.upload])
        #expect(sink.reports.first?.error is MissingAudio)
    }

    @Test func refusedRequestReportsUpload() async throws {
        let sink = RecordingDiagnosticsSink()
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(status: 422, detail: "Not an audio file")

        await engine(diagnostics: sink.client).transfer()

        #expect(sink.reports.map(\.area) == [.upload])
        #expect((sink.reports.first?.error as? APIStatusError)?.status == 422)
    }

    @Test func oversizedConfirmationReportsUpload() async throws {
        let sink = RecordingDiagnosticsSink()
        try await captured("r1")
        api.transferFailures["confirm r1"] = APIStatusError(status: 413, detail: "The upload does not match its size.")

        await engine(diagnostics: sink.client).transfer()

        #expect(sink.reports.map(\.area) == [.upload])
        #expect((underlying(try #require(sink.reports.first?.error)) as? APIStatusError)?.status == 413)
    }

    @Test func quotaRefusalReportsNothing() async throws {
        let sink = RecordingDiagnosticsSink()
        try await captured("r1")
        api.transferFailures["slot r1"] = APIStatusError(
            status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")

        await engine(diagnostics: sink.client).transfer()

        #expect(try await file("r1")?.localState == .blockedQuota)
        #expect(sink.reports.isEmpty)
    }
}
