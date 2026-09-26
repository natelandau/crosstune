import CrosstuneAPI
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync

@MainActor
@Suite struct SyncEngineTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()

    init() throws {
        store = try root.open()
    }

    func engine(isOffline: @escaping @MainActor () -> Bool = { false }, batchSize: Int = SyncEngine.pushBatchSize)
        -> SyncEngine
    {
        // The transfer loop has its own suite; a real pass here would add its own backoff sleeps.
        SyncEngine(
            store: store, api: api, isOffline: isOffline, batchSize: batchSize, sleep: sleeper.sleep, transferPass: {})
    }

    func tuneCount() async throws -> Int {
        try await store.read { db in try Tune.fetchCount(db) }
    }

    @Test func pushesTheOutboxThenPullsUntilHasMoreIsFalse() async throws {
        let tune = try await createTune(store, title: "X")
        api.pullQueue = [
            PullPage(
                rows: [PulledRow(table: .tunes, row: serverTune(id: "a", serverSeq: 10))], nextSince: 10, hasMore: true),
            PullPage(
                rows: [PulledRow(table: .tunes, row: serverTune(id: "b", serverSeq: 12))], nextSince: 12, hasMore: false
            ),
        ]
        let engine = engine()
        var seenDuringRun: [SyncStatus] = []
        api.onRequest = { seenDuringRun.append(engine.status) }

        await engine.sync()

        #expect(api.pushes.first?.map(\.id).contains(tune.id) == true)
        #expect(api.pushes.first?.first?.data?["id"] == nil)
        #expect(api.pulls == [0, 10])
        #expect(try await store.meta(.pullCursor, as: Int64.self) == 12)
        #expect(try await tuneCount() == 3)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(Set(seenDuringRun) == [.syncing])
        #expect(engine.status == .idle)
    }

    @Test func keepsAnEntryWrittenWhileItsBatchWasInFlightAndPushesItNext() async throws {
        let tune = try await createTune(store, title: "v1")
        let store = store
        api.respondToPush = { changes in
            var edited = tune
            edited.title = "v2"
            let sent = edited
            try await store.write { writer in try writer.put(sent, at: later(5_000)) }
            return changes.map { PushResult(table: $0.table, id: $0.id, status: .applied, row: FakeSyncAPI.echo($0)) }
        }
        let engine = engine()

        await engine.sync()

        let pending = try await store.pendingChanges(limit: 10)
        #expect(pending.map { $0.data?["title"] } == [.string("v2")])

        api.respondToPush = { changes in changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) } }
        await engine.sync()
        #expect(try await store.pendingChangeCount() == 0)
        #expect(api.pushes.count == 2)
    }

    @Test func overwritesTheLocalRowWithTheServersOnAStaleResult() async throws {
        let tune = try await createTune(store, title: "Mine")
        api.respondToPush = { changes in
            changes.map { change in
                change.id == tune.id
                    ? PushResult(
                        table: .tunes, id: tune.id, status: .stale,
                        row: serverTune(id: tune.id, title: "Theirs", serverSeq: 7))
                    : PushResult(table: change.table, id: change.id, status: .applied)
            }
        }
        let engine = engine()

        await engine.sync()

        let stored = try await store.read { db in try Tune.fetchOne(db, key: tune.id) }
        #expect(stored?.title == "Theirs")
        #expect(stored?.serverSeq == 7)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func endsOfflineWithoutARequestWhileTheDeviceIsOffline() async throws {
        try await createTune(store, title: "X")
        let offline = Toggle(true)
        let engine = engine(isOffline: { offline.isOn })

        await engine.sync()

        #expect(engine.status == .offline)
        #expect(api.pushes.isEmpty)
        #expect(api.pulls.isEmpty)
        #expect(sleeper.requested == [.seconds(1)])

        offline.isOn = false
        sleeper.fire()
        try await waitUntil { engine.status == .idle }
        #expect(api.pushes.count == 1)
        #expect(try await store.pendingChangeCount() == 0)
        engine.stop()
    }

    @Test func goesOfflineOnANetworkFailureAndRetriesWithBackoff() async throws {
        api.failure = URLError(.notConnectedToInternet)
        let engine = engine()

        await engine.sync()
        #expect(engine.status == .offline)

        api.failure = nil
        sleeper.fire()
        try await waitUntil { engine.status == .idle }
        #expect(sleeper.requested == [.seconds(1)])
    }

    @Test func backsOffThroughTheSequenceAndStartsOverAfterASuccess() async throws {
        api.failure = APIStatusError(status: 500)
        let engine = engine()

        await engine.sync()
        for count in 2...9 {
            sleeper.fire()
            try await waitUntil { sleeper.requested.count == count }
        }
        #expect(sleeper.requested == [1, 2, 4, 8, 16, 32, 60, 60, 60].map { .seconds($0) })
        #expect(engine.status == .error)

        api.failure = nil
        sleeper.fire()
        try await waitUntil { engine.status == .idle }

        api.failure = APIStatusError(status: 500)
        await engine.sync()
        #expect(sleeper.requested.last == .seconds(1))
        engine.stop()
    }

    @Test func reportsErrorForAServerFailureAndStopCancelsTheRetry() async throws {
        api.failure = APIStatusError(status: 500)
        let engine = engine()

        await engine.sync()
        #expect(engine.status == .error)
        #expect(sleeper.pendingCount == 1)

        engine.stop()
        api.failure = nil
        try await waitUntil { sleeper.pendingCount == 0 }
        #expect(engine.status == .error)
        #expect(api.pulls.isEmpty)
    }

    @Test func coalescesConcurrentSyncCalls() async throws {
        try await createTune(store, title: "X")
        let engine = engine()

        await withDiscardingTaskGroup { group in
            for _ in 0..<3 {
                group.addTask { await engine.sync() }
            }
        }

        #expect(api.pushes.count == 1)
        // One pull per full run: the coalesced calls drove exactly one more run after the first.
        #expect(api.pulls == [0, 0])
    }

    @Test func stampsLastSyncedAtOnACleanRunAndKeepsItAcrossLaunches() async throws {
        let engine = engine()
        #expect(engine.lastSyncedAt == nil)

        await engine.sync()
        let first = try #require(engine.lastSyncedAt)
        await engine.sync()
        let second = try #require(engine.lastSyncedAt)
        #expect(second >= first)

        api.failure = APIStatusError(status: 500)
        await engine.sync()
        engine.stop()
        #expect(engine.lastSyncedAt == second)

        let relaunched = self.engine()
        try await waitUntil { relaunched.lastSyncedAt != nil }
        #expect(Timestamp(relaunched.lastSyncedAt!) == Timestamp(second))
    }

    @Test func armsNoRetryWhenStopLandsDuringAnInFlightFailure() async throws {
        try await createTune(store, title: "X")
        var release: CheckedContinuation<Void, Never>?
        api.respondToPush = { _ in
            await withCheckedContinuation { release = $0 }
            throw APIStatusError(status: 500)
        }
        let engine = engine()

        let run = Task { await engine.sync() }
        try await waitUntil { release != nil }
        engine.stop()
        release?.resume()
        await run.value

        #expect(engine.status == .error)
        #expect(sleeper.requested.isEmpty)
        #expect(api.pushes.count == 1)
        #expect(api.pulls.isEmpty)

        await engine.sync()
        #expect(api.pushes.count == 1)
    }

    @Test func stopAndWaitReturnsOnlyOnceTheRunInFlightIsDone() async throws {
        try await createTune(store, title: "X")
        var release: CheckedContinuation<Void, Never>?
        let respond = api.respondToPush
        api.respondToPush = { changes in
            await withCheckedContinuation { release = $0 }
            return try await respond(changes)
        }
        let engine = engine()
        let run = Task { await engine.sync() }
        try await waitUntil { release != nil }

        var began = false
        var stopped = false
        let stopping = Task {
            began = true
            await engine.stopAndWait()
            stopped = true
        }
        try await waitUntil { began }
        for _ in 0..<10 { await Task.yield() }
        // The push is still held, so the run cannot have ended.
        #expect(api.pulls.isEmpty)
        #expect(!stopped)

        release?.resume()
        await stopping.value
        #expect(api.pushes.count == 1)
        #expect(api.pulls.isEmpty)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(engine.status == .idle)
        await run.value
    }

    @Test func aStoppedRunLeavesTheStatusItFound() async throws {
        try await createTune(store, title: "X")
        api.failure = APIStatusError(status: 500)
        let engine = engine()
        await engine.sync()
        #expect(engine.status == .error)

        api.failure = nil
        var release: CheckedContinuation<Void, Never>?
        let respond = api.respondToPush
        api.respondToPush = { changes in
            await withCheckedContinuation { release = $0 }
            return try await respond(changes)
        }
        let run = Task { await engine.sync() }
        try await waitUntil { release != nil }
        #expect(engine.status == .syncing)

        engine.stop()
        release?.resume()
        await run.value

        #expect(engine.status == .error)
    }

    @Test func aStopEndsAMultiBatchPushBeforeItsNextBatch() async throws {
        try await createTune(store, title: "X")
        var release: CheckedContinuation<Void, Never>?
        let respond = api.respondToPush
        api.respondToPush = { changes in
            await withCheckedContinuation { release = $0 }
            return try await respond(changes)
        }
        let engine = engine(batchSize: 1)
        let run = Task { await engine.sync() }
        try await waitUntil { release != nil }

        engine.stop()
        release?.resume()
        await run.value

        #expect(api.pushes.count == 1)
        #expect(api.pulls.isEmpty)
        #expect(api.storageCalls == 0)
        #expect(try await store.pendingChangeCount() == 1)
        #expect(engine.lastSyncedAt == nil)
        #expect(sleeper.requested.isEmpty)
    }

    @Test func resumeReenablesSyncAfterAStop() async throws {
        let engine = engine()
        engine.stop()
        await engine.sync()
        #expect(api.pulls.isEmpty)

        engine.resume()
        await engine.sync()
        #expect(api.pulls.count == 1)
    }

    @Test func dropsARejectedChangeAndCountsItOnce() async throws {
        let tune = try await createTune(store, title: "X")
        api.respondToPush = { changes in
            changes.map { change in
                change.id == tune.id
                    ? PushResult(table: change.table, id: change.id, status: .invalid, reason: "title too long")
                    : PushResult(table: change.table, id: change.id, status: .applied)
            }
        }
        let engine = engine()

        await engine.sync()

        #expect(try await store.meta(.invalidChanges, as: Int.self) == 1)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(engine.status == .idle)
    }

    @Test func doesNotCountADeleteTheServerNeverStoredAsALostChange() async throws {
        let tune = try await createTune(store, title: "X")
        try await store.write { writer in
            let userTunes = try UserTune.filter(Column("tune_id") == tune.id).fetchAll(writer.db)
            for userTune in userTunes {
                try writer.tombstone(UserTune.self, id: userTune.id, at: later(1))
            }
            try writer.tombstone(Tune.self, id: tune.id, at: later(1))
        }
        api.respondToPush = { changes in
            changes.map { PushResult(table: $0.table, id: $0.id, status: .invalid, reason: "not found") }
        }
        let engine = engine()

        await engine.sync()

        #expect(try await store.meta(.invalidChanges, as: Int.self) == nil)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test(arguments: [401, 403])
    func reportsUnauthorizedWhenTheServerRejectsTheSession(status: Int) async throws {
        api.failure = APIStatusError(status: status)
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .unauthorized)
        engine.stop()
    }

    @Test func reportsOnlyACleanRunAsSynced() async throws {
        let engine = engine()
        let synced = Counter()
        engine.onSynced = { synced.count += 1 }

        api.failure = APIStatusError(status: 401)
        await engine.sync()
        #expect(synced.count == 0)

        api.failure = nil
        await engine.sync()
        #expect(synced.count == 1)
        engine.stop()
    }

    @Test func goesOfflineWithoutASessionToken() async throws {
        api.failure = NotSignedIn()
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .offline)
        engine.stop()
    }

    @Test func stopsPushingWhenAFullBatchSettlesNothing() async throws {
        try await createTune(store, title: "X")
        api.respondToPush = { _ in [] }
        let engine = engine(batchSize: 1)

        await engine.sync()

        #expect(api.pushes.count == 1)
        #expect(try await store.pendingChangeCount() == 2)
    }

    @Test func pushesTheOutboxInBatchesInQueueOrderUntilItIsEmpty() async throws {
        let first = try await createTune(store, title: "X")
        let second = try await createTune(store, title: "Y", at: later(1))
        let engine = engine(batchSize: 2)

        await engine.sync()

        #expect(api.pushes.map(\.count) == [2, 2])
        #expect(api.pushes.map { $0[0].id } == [first.id, second.id])
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func keepsTheStorageFigures() async throws {
        let engine = engine()

        await engine.sync()

        #expect(try await store.meta(.storage, as: StorageFigures.self) == api.figures)
    }

    @Test func finishesCleanWhenOnlyTheStorageFiguresFail() async throws {
        api.storageFailure = APIStatusError(status: 500)
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .idle)
        #expect(engine.lastSyncedAt != nil)
        #expect(try await store.meta(.storage, as: StorageFigures.self) == nil)
    }

    @Test func failsTheRunWhenTheStorageFiguresAreRefused() async throws {
        api.storageFailure = APIStatusError(status: 401)
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .unauthorized)
        #expect(engine.lastSyncedAt == nil)
        engine.stop()
    }

    @Test func resolvesLinksOnlyWhileOnlineAndNeverThrows() async throws {
        let engine = engine()
        #expect(await engine.resolveLink("https://x")?.title == "Resolved")

        api.failure = URLError(.timedOut)
        #expect(await engine.resolveLink("https://x") == nil)

        api.failure = nil
        let offline = self.engine(isOffline: { true })
        #expect(await offline.resolveLink("https://x") == nil)
    }

    @Test func runsTheTransferLoopOnceAfterEachSync() async throws {
        let transfers = Counter()
        let engine = SyncEngine(
            store: store, api: api, isOffline: { false }, batchSize: SyncEngine.pushBatchSize, sleep: sleeper.sleep,
            transferPass: { transfers.count += 1 })

        await engine.sync()
        try await waitUntil { transfers.count == 1 }
        await engine.sync()
        try await waitUntil { transfers.count == 2 }

        #expect(transfers.count == 2)
        #expect(engine.transferStatus == .idle)
    }

    @Test func keepsARunCleanWhenTheLastSyncTimeCannotBeSaved() async throws {
        try await store.write { writer in
            try writer.db.execute(
                sql: """
                    CREATE TRIGGER refuse_last_synced BEFORE INSERT ON meta WHEN NEW.key = 'last_synced_at'
                    BEGIN SELECT RAISE(ABORT, 'refused'); END
                    """)
        }
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .idle)
        #expect(engine.lastSyncedAt != nil)
    }
}

@Suite struct ClassifyFailureTests {
    @Test func mapsFailuresToStatuses() {
        #expect(classifyFailure(APIStatusError(status: 500), isOffline: true) == .offline)
        #expect(classifyFailure(NotSignedIn(), isOffline: false) == .offline)
        #expect(classifyFailure(URLError(.cannotFindHost), isOffline: false) == .offline)
        #expect(classifyFailure(CocoaError(.featureUnsupported), isOffline: false) == .error)
        #expect(classifyFailure(APIStatusError(status: 401), isOffline: false) == .unauthorized)
        #expect(classifyFailure(APIStatusError(status: 403), isOffline: false) == .unauthorized)
        #expect(classifyFailure(APIStatusError(status: 500), isOffline: false) == .error)
    }

    @Test func mapsTransferFailuresToStatuses() {
        #expect(classifyTransferFailure(APIStatusError(status: 500), isOffline: true) == .offline)
        #expect(classifyTransferFailure(NotSignedIn(), isOffline: false) == .offline)
        #expect(classifyTransferFailure(URLError(.cannotFindHost), isOffline: false) == .error)
        #expect(classifyTransferFailure(APIStatusError(status: 500), isOffline: false) == .error)
    }
}

@Suite struct StatusLabelTests {
    @Test(arguments: [
        (SyncStatus.idle, "Synced"),
        (.syncing, "Syncing"),
        (.offline, "Offline"),
        (.unauthorized, "Sign in again"),
        (.error, "Sync failed"),
    ])
    func labelsEachSyncStatusAsTheWebDoes(status: SyncStatus, label: String) {
        #expect(status.label == label)
    }

    @Test(arguments: [
        (TransferStatus.idle, "Up to date"),
        (.transferring, "Transferring"),
        (.offline, "Offline"),
        (.error, "Transfer failed"),
    ])
    func labelsEachTransferStatusAsTheWebDoes(status: TransferStatus, label: String) {
        #expect(status.label == label)
    }
}
