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

    func engine(
        isOffline: @escaping @MainActor () -> Bool = { false }, batchSize: Int = SyncEngine.pushBatchSize,
        now: @escaping @MainActor () -> Date = Date.init
    ) -> SyncEngine {
        // The transfer loop has its own suite; a real pass here would add its own backoff sleeps.
        SyncEngine(
            store: store, api: api, isOffline: isOffline, batchSize: batchSize, sleep: sleeper.sleep, transferPass: {},
            now: now)
    }

    func tuneCount() async throws -> Int {
        try await store.read { db in try Tune.fetchCount(db) }
    }

    @Test func copiesForExportLandOnlyWhereAsked() async throws {
        let engine = engine()
        let folder = root.url.appending(path: "export-copies-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        try await engine.fetchRecordingCopy("r1", to: folder.appending(path: "r1.m4a"))
        try await engine.fetchScanCopy("s1", to: folder.appending(path: "s1.jpg"))

        #expect(api.transfers == ["url r1", "get r1", "scan-url s1", "get s1"])
        #expect(try Data(contentsOf: folder.appending(path: "r1.m4a")) == api.objectData)
        #expect(try Data(contentsOf: folder.appending(path: "s1.jpg")) == api.objectData)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false)).isEmpty)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: store.scansFolder.path(percentEncoded: false)).isEmpty)
        #expect(try await store.read { db in try RecordingFile.fetchCount(db) + ScanFile.fetchCount(db) } == 0)
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
        engine.onSynced = { _ in synced.count += 1 }

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

    @Test func refreshesBillingOnceAndThrowsTheAPIsError() async throws {
        let engine = engine()

        try await engine.refreshBilling()
        #expect(api.billingRefreshes == 1)

        api.failure = APIStatusError(status: 502)
        await #expect(throws: APIStatusError(status: 502)) { try await engine.refreshBilling() }
        #expect(api.billingRefreshes == 2)
    }

    @Test func sendsNoOneOffRequestWhileOffline() async throws {
        let engine = engine(isOffline: { true })
        let destination = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)

        await #expect(throws: DeviceOffline.self) { try await engine.refreshBilling() }
        await #expect(throws: DeviceOffline.self) { try await engine.retry("rec") }
        await #expect(throws: DeviceOffline.self) { try await engine.fetchRecordingCopy("rec", to: destination) }
        await #expect(throws: DeviceOffline.self) { try await engine.fetchScanCopy("scan", to: destination) }

        #expect(api.billingRefreshes == 0)
        #expect(api.transfers.isEmpty)
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

    @Test func keepsTheStorageUsage() async throws {
        let engine = engine()

        await engine.sync()

        #expect(try await store.meta(.storage, as: StorageUsage.self) == api.usage)
    }

    @Test func finishesCleanWhenOnlyTheStorageUsageFail() async throws {
        api.storageFailure = APIStatusError(status: 500)
        let engine = engine()

        await engine.sync()

        #expect(engine.status == .idle)
        #expect(engine.lastSyncedAt != nil)
        #expect(try await store.meta(.storage, as: StorageUsage.self) == nil)
    }

    @Test func reportsWhetherTheRunStoredTheStorageUsage() async throws {
        let engine = engine()
        var stored: [Bool] = []
        engine.onSynced = { stored.append($0) }

        api.storageFailure = APIStatusError(status: 500)
        await engine.sync()
        api.storageFailure = nil
        await engine.sync()

        #expect(stored == [false, true])
        engine.stop()
    }

    @Test func failsTheRunWhenTheStorageUsageAreRefused() async throws {
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

    @Test func searchesWhileOnlineWithTheQueryProvidersAndCountry() async throws {
        let group = SearchGroup(provider: "tidal", status: .results, results: [], searchURL: "https://tidal.com/s")
        api.searchGroups = [group]
        let engine = engine()

        #expect(await engine.searchRecordings(q: "Tam Lin", providers: ["tidal"], country: "IE") == .ok([group]))
        #expect(api.searches == [FakeSyncAPI.Search(q: "Tam Lin", providers: ["tidal"], country: "IE")])
    }

    @Test func answersOfflineWithoutAskingTheServer() async throws {
        let engine = engine(isOffline: { true })

        #expect(await engine.searchRecordings(q: "x", providers: ["tidal"], country: "US") == .offline)
        #expect(api.searches.isEmpty)
    }

    @Test func tellsARateLimitFromAnyOtherFailedSearch() async throws {
        let engine = engine()

        api.failure = APIStatusError(status: 429)
        #expect(
            await engine.searchRecordings(q: "x", providers: ["tidal"], country: "US")
                == .rateLimited(retryAfter: SyncEngine.defaultRetryAfterSeconds))
        #expect(SyncEngine.defaultRetryAfterSeconds == 60)

        api.failure = APIStatusError(status: 429, retryAfterSeconds: 7)
        #expect(
            await engine.searchRecordings(q: "x", providers: ["tidal"], country: "US") == .rateLimited(retryAfter: 7))

        api.failure = APIStatusError(status: 500)
        #expect(await engine.searchRecordings(q: "x", providers: ["tidal"], country: "US") == .failed)

        api.failure = URLError(.timedOut)
        #expect(await engine.searchRecordings(q: "x", providers: ["tidal"], country: "US") == .failed)
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

    // MARK: Plan

    func putTake(_ id: String) async throws {
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: id, createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon,
                    state: "pending_upload"), at: noon)
        }
    }

    func localOnlyRows() async throws -> Set<String> {
        try await store.read { db in try StoreWriter.localOnlyRows(in: db) }
    }

    @Test func aFreePlanLeavesALocalOnlyTakeOutButSendsItsDelete() async throws {
        try await storeEntitlement(store, source: nil)
        let tune = try await createTune(store, title: "X")
        try await putTake("r1")
        try await store.write { writer in try writer.keepLocalUntilSubscribed(["r1"]) }
        let engine = engine()

        await engine.sync()

        #expect(api.pushes.count == 1)
        #expect(api.pushes[0].contains { $0.id == tune.id })
        #expect(!api.pushes[0].contains { $0.id == "r1" })
        #expect(try await store.pendingChanges(limit: 10).map(\.rowID) == ["r1"])

        try await store.write { writer in try writer.tombstone(Recording.self, id: "r1", at: later(1_000)) }
        await engine.sync()

        #expect(api.pushes.count == 2)
        #expect(api.pushes[1].map(\.id) == ["r1"])
        #expect(api.pushes[1].first?.op == .delete)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    @Test func aPremiumPlanJudgedByTheEnginesClockSendsALocalOnlyTake() async throws {
        // Ended by the real clock, but not by the engine's.
        try await storeEntitlement(store, source: "trial", expiresAt: later(3_600_000))
        try await putTake("r1")
        try await store.write { writer in try writer.keepLocalUntilSubscribed(["r1"]) }
        api.respondToPush = { changes in changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) } }
        let engine = engine(now: { noon.date })

        await engine.sync()

        #expect(api.pushes.first?.map(\.id) == ["r1"])
        #expect(engine.status == .idle)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    @Test func aLocalOnlyTakesDeleteTheServerNeverStoredStillReleasesIt() async throws {
        try await storeEntitlement(store, source: nil)
        try await putTake("r1")
        try await store.write { writer in
            try writer.keepLocalUntilSubscribed(["r1"])
            try writer.tombstone(Recording.self, id: "r1", at: later(1_000))
        }
        api.respondToPush = { changes in
            changes.map { PushResult(table: $0.table, id: $0.id, status: .invalid, reason: "not found") }
        }

        await engine().sync()

        #expect(api.pushes.first?.map(\.op) == [.delete])
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    @Test func localOnlyTakesFillingWholeBatchesDoNotStarveTheEditsBehindThem() async throws {
        for id in ["r1", "r2", "r3"] { try await putTake(id) }
        let tune = try await createTune(store, title: "X")
        api.respondToPush = { changes in
            changes.map { change in
                change.table == .recordings
                    ? PushResult(table: change.table, id: change.id, status: .invalid, reason: premiumRequiredReason)
                    : PushResult(table: change.table, id: change.id, status: .applied)
            }
        }
        let engine = engine(batchSize: 2)

        await engine.sync()

        let sent = api.pushes.flatMap { $0.map(\.id) }
        #expect(sent.contains(tune.id))
        #expect(sent.filter { ["r1", "r2", "r3"].contains($0) } == ["r1", "r2", "r3"])
        #expect(engine.status == .idle)
        #expect(Set(try await store.pendingChanges(limit: 10).map(\.rowID)) == ["r1", "r2", "r3"])
        #expect(try await localOnlyRows() == ["r1", "r2", "r3"])
    }

    func putLoop(_ id: String, on recordingID: String) async throws {
        try await store.write { writer in
            try writer.put(
                RecordingLoop(id: id, createdAt: noon, recordingID: recordingID, startMs: 0, endMs: 1_000, color: 0),
                at: noon)
        }
    }

    @Test func aLocalOnlyTakesLoopStaysQueuedWithItAndGoesOutOnceReleased() async throws {
        try await putTake("r1")
        try await putLoop("l1", on: "r1")
        api.respondToPush = { changes in
            changes.map { change in
                PushResult(
                    table: change.table, id: change.id, status: .invalid,
                    reason: change.table == .recordings ? premiumRequiredReason : missingRecordingReason)
            }
        }
        let engine = engine()

        await engine.sync()

        #expect(api.pushes.map { $0.map(\.id) } == [["r1", "l1"]])
        #expect(Set(try await store.pendingChanges(limit: 10).map(\.rowID)) == ["r1", "l1"])
        #expect(try await store.meta(.invalidChanges, as: Int.self) == nil)
        #expect(try await store.read { db in try RecordingLoop.fetchCount(db) } == 1)

        api.respondToPush = { changes in changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) } }
        await engine.sync()

        #expect(api.pushes.last.map { Set($0.map(\.id)) } == ["r1", "l1"])
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    @Test func aFreePlanLeavesALocalOnlyTakesLoopOut() async throws {
        try await storeEntitlement(store, source: nil)
        let tune = try await createTune(store, title: "X")
        try await putTake("r1")
        try await putLoop("l1", on: "r1")
        try await store.write { writer in try writer.keepLocalUntilSubscribed(["r1"]) }

        await engine().sync()

        let sent = api.pushes.flatMap { $0.map(\.id) }
        #expect(sent.contains(tune.id))
        #expect(!sent.contains("r1") && !sent.contains("l1"))
        #expect(Set(try await store.pendingChanges(limit: 10).map(\.rowID)) == ["r1", "l1"])
    }

    func recordPractice(_ id: String, on recordingID: String) async throws {
        try await store.write { writer in
            try writer.record(
                PracticeSession(
                    id: id, createdAt: noon, recordingID: recordingID, startedAt: noon, durationMs: 60_000,
                    speedPercent: 100, pitchCents: 0))
        }
    }

    /// Refuses every recording as Premium only and every row that names one as missing it.
    func refuseTakesAndTheirRows() {
        api.respondToPush = { changes in
            changes.map { change in
                PushResult(
                    table: change.table, id: change.id, status: .invalid,
                    reason: change.table == .recordings ? premiumRequiredReason : missingRecordingReason)
            }
        }
    }

    @Test func aLocalOnlyTakesPlayAndPracticeStayQueuedWithItAndGoOutOnceReleased() async throws {
        try await putTake("r1")
        try await recordPlay(store, id: "e1")
        try await recordPractice("s1", on: "r1")
        refuseTakesAndTheirRows()
        let engine = engine()

        await engine.sync()

        #expect(Set(try await store.pendingChanges(limit: 10).map(\.rowID)) == ["r1", "e1", "s1"])
        #expect(try await store.read { db in try PlayEvent.fetchCount(db) + PracticeSession.fetchCount(db) } == 2)

        api.respondToPush = { changes in changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) } }
        await engine.sync()

        #expect(api.pushes.last.map { Set($0.map(\.id)) } == ["r1", "e1", "s1"])
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    @Test func aRowMissingARecordingThatIsNotLocalOnlySettles() async throws {
        try await recordPlay(store, id: "e1")
        try await putLoop("l1", on: "r1")
        refuseTakesAndTheirRows()

        await engine().sync()

        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await store.read { db in try PlayEvent.fetchCount(db) } == 0)
        #expect(try await store.meta(.invalidChanges, as: Int.self) == 1)
    }

    @Test func aLocalOnlyTakesDeleteReleasesItsRowsInTheSameBatch() async throws {
        try await putTake("r1")
        try await recordPlay(store, id: "e1")
        try await store.write { writer in
            try writer.keepLocalUntilSubscribed(["r1"])
            try writer.tombstone(Recording.self, id: "r1", at: later(1_000))
        }
        api.respondToPush = { changes in
            changes.map { change in
                change.table == .recordings
                    ? PushResult(table: change.table, id: change.id, status: .applied)
                    : PushResult(table: change.table, id: change.id, status: .invalid, reason: missingRecordingReason)
            }
        }

        await engine().sync()

        #expect(api.pushes.map { Set($0.map(\.id)) } == [["r1", "e1"]])
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await localOnlyRows().isEmpty)
    }

    /// A tune's delete drops its recordings' queued changes rather than queuing their deletes,
    /// as the server's cascade covers them.
    @Test(arguments: [nil, "comp"])
    func aLocalOnlyTakeDroppedByACascadeLetsItsRowsSettle(source: String?) async throws {
        try await storeEntitlement(store, source: source)
        try await putTake("r1")
        try await recordPlay(store, id: "e1")
        try await store.write { writer in
            try writer.keepLocalUntilSubscribed(["r1"])
            try writer.tombstone(Recording.self, id: "r1", at: later(1_000), enqueueDelete: false)
        }
        refuseTakesAndTheirRows()

        await engine().sync()

        #expect(try await localOnlyRows().isEmpty)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await store.read { db in try PlayEvent.fetchCount(db) } == 0)
    }

    @Test func aPushWhoseResultsAreAllKeptLocalEnds() async throws {
        try await putTake("r1")
        api.respondToPush = { changes in
            changes.map {
                PushResult(table: $0.table, id: $0.id, status: .invalid, reason: premiumRequiredReason)
            }
        }
        let engine = engine(batchSize: 1)

        await engine.sync()

        #expect(api.pushes.count == 1)
        #expect(engine.status == .idle)
        #expect(try await store.pendingChanges(limit: 10).map(\.rowID) == ["r1"])
        #expect(try await localOnlyRows() == ["r1"])
    }

    // MARK: Seen notices

    @Test func postsASeenNoticeOnceAndDropsItOnceThePulledRowCarriesIt() async throws {
        try await storeEntitlement(store, source: "trial", expiresAt: later(86_400_000))
        try await store.write { writer in try writer.markNoticeSeen(.firstRecording) }
        api.pullQueue = [
            PullPage(
                rows: [
                    PulledRow(table: .entitlements, row: serverEntitlement(serverSeq: 5, recordingNoticeSeen: true))
                ],
                nextSince: 5, hasMore: false)
        ]
        let engine = engine()

        await engine.sync()
        #expect(api.noticeRequests == [.firstRecording])

        await engine.sync()
        #expect(api.noticeRequests == [.firstRecording])
        #expect(try await store.seenNotices().isEmpty)
        #expect(engine.status == .idle)
    }

    @Test func anAuthFailureFromANoticePostEndsTheRun() async throws {
        try await storeEntitlement(store, source: "trial", expiresAt: later(86_400_000))
        try await store.write { writer in try writer.markNoticeSeen(.trialReminder) }
        api.noticeFailure = APIStatusError(status: 401)
        let engine = engine()

        await engine.sync()

        #expect(api.noticeRequests == [.trialReminder])
        #expect(engine.status == .unauthorized)
        #expect(api.pulls.isEmpty)
        #expect(engine.lastSyncedAt == nil)
        engine.stop()
    }

    @Test func aNoticePostRefusedForGoodStaysSeenAndIsNeverSentAgain() async throws {
        try await storeEntitlement(store, source: "trial", expiresAt: later(86_400_000))
        try await store.write { writer in try writer.markNoticeSeen(.trialReminder) }
        api.noticeFailure = APIStatusError(status: 422)
        let engine = engine()

        await engine.sync()
        #expect(engine.status == .idle)
        await engine.sync()

        #expect(api.noticeRequests == [.trialReminder])
        #expect(try await store.seenNotices() == [.trialReminder])
    }

    @Test func aFailedNoticePostLeavesTheSyncCleanAndRetriesOnTheNext() async throws {
        try await storeEntitlement(store, source: "trial", expiresAt: later(86_400_000))
        try await store.write { writer in try writer.markNoticeSeen(.trialReminder) }
        api.noticeFailure = APIStatusError(status: 500)
        let engine = engine()

        await engine.sync()
        #expect(api.noticeRequests == [.trialReminder])
        #expect(engine.status == .idle)
        #expect(engine.lastSyncedAt != nil)
        #expect(api.pulls == [0])
        #expect(try await store.seenNotices() == [.trialReminder])

        api.noticeFailure = nil
        await engine.sync()
        #expect(api.noticeRequests == [.trialReminder, .trialReminder])
    }
}

@Suite struct ClassifyFailureTests {
    @Test func aPlanRefusalIsNotAnAuthFailure() {
        let premium = APIStatusError(status: 403, problemType: premiumRequiredProblem)
        #expect(isPlanRefusal(premium))
        #expect(!isPlanRefusal(APIStatusError(status: 403)))
        #expect(!isPlanRefusal(APIStatusError(status: 413, problemType: quotaProblem)))
        #expect(!isAuthFailure(premium))
        #expect(isAuthFailure(APIStatusError(status: 403)))
        #expect(classifyFailure(premium, isOffline: false) == .error)
        #expect(syncFailureReason(premium) == .other)
    }

    @Test func namesThePlanRefusalsAsTheServerDoes() {
        #expect(premiumRequiredProblem == "urn:crosstune:premium-required")
        #expect(premiumRequiredReason == "premium required")
        #expect(missingRecordingReason == "recording_id does not reference one of your recordings")
    }

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
