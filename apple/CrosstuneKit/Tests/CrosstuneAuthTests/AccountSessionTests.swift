import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneAuth

@Test func waitsForClerkDuringTheGracePeriod() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: false)
    #expect(phase == .loading)
}

@Test func opensOnTheRememberedUserWhenClerkDoesNotLoad() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(phase == .signedIn(userID: "user_a", confirmed: false))
}

@Test func asksForSignInWhenClerkDoesNotLoadAndNoOneIsRemembered() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: nil, graceElapsed: true)
    #expect(phase == .signedOut)
}

@Test func trustsClerkOnceItLoads() {
    let signedIn = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_b", rememberedUserID: "user_a", graceElapsed: false)
    #expect(signedIn == .signedIn(userID: "user_b", confirmed: true))

    let signedOut = AccountSession.phase(
        clerkLoaded: true, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(signedOut == .signedOut)
}

@Test func isOfflineWithoutANetworkEvenWhenClerkRestoredTheUser() {
    let restored = AccountSession.Phase.signedIn(userID: "user_a", confirmed: true)
    #expect(AccountSession.isOffline(phase: restored, hasNetwork: false))
    #expect(!AccountSession.isOffline(phase: restored, hasNetwork: true))
}

@Test func isOfflineUntilClerkLoads() {
    let remembered = AccountSession.Phase.signedIn(userID: "user_a", confirmed: false)
    #expect(AccountSession.isOffline(phase: remembered, hasNetwork: true))
}

@Test func remembersAndForgetsTheUser() throws {
    let suite = "crosstune.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let remembered = RememberedUser(defaults: defaults)

    remembered.userID = "user_a"
    #expect(RememberedUser(defaults: defaults).userID == "user_a")

    remembered.userID = nil
    #expect(RememberedUser(defaults: defaults).userID == nil)
}

/// Records each step of leaving, sync controls and session end alike, in order.
@MainActor
final class LeaveLog: LeavingSync {
    var steps: [String] = []
    /// Runs as the sync, as the engine would push the outbox.
    var onSync: () async throws -> Void = {}

    func sync() async {
        steps.append("sync")
        try? await onSync()
    }

    func stop() async {
        steps.append("stop")
        await Task.yield()
        steps.append("stopped")
    }

    func resume() { steps.append("resume") }
}

struct ClerkFailed: Error {}

@MainActor
@Suite struct LeaveTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let log = LeaveLog()

    init() throws {
        store = try root.open()
    }

    var folderExists: Bool { FileManager.default.fileExists(atPath: store.folder.path()) }

    func leave(keepingUnsynced: Bool, endSession: () async throws -> Void = {}) async throws {
        let log = log
        try await AccountSession.leave(
            userID: "user_a", store: store, root: root.url, sync: log, keepingUnsynced: keepingUnsynced
        ) {
            log.steps.append("end session")
            try await endSession()
        }
    }

    func queueChange() async throws {
        try await store.write { writer in try writer.put(Tune(title: "Leather Britches")) }
    }

    func putRecordingFile(_ state: LocalFileState) async throws {
        try await store.write { writer in try RecordingFile(id: "r1", localState: state).insert(writer.db) }
    }

    @Test func signOutSyncsThenStopsThenEndsTheSessionThenDeletesTheFolder() async throws {
        try await leave(keepingUnsynced: false)

        #expect(log.steps == ["sync", "stop", "stopped", "end session"])
        #expect(!folderExists)
    }

    @Test func signOutChecksTheOutboxAfterTheSync() async throws {
        try await queueChange()
        let store = store
        log.onSync = { try await store.write { writer in try OutboxEntry.deleteAll(writer.db) } }

        try await leave(keepingUnsynced: false)

        #expect(!folderExists)
    }

    @Test func signOutRefusesWhileChangesAreUnsent() async throws {
        try await queueChange()

        await #expect(throws: AccountSession.LeaveError.unsyncedChanges) {
            try await leave(keepingUnsynced: false)
        }

        #expect(log.steps == ["sync"])
        #expect(folderExists)
    }

    @Test func signOutRefusesWhileARecordingIsNotUploaded() async throws {
        for state in LocalFileState.notUploaded {
            try await putRecordingFile(state)

            await #expect(throws: AccountSession.LeaveError.unuploadedRecordings) {
                try await leave(keepingUnsynced: false)
            }

            try await store.write { writer in try RecordingFile.deleteAll(writer.db) }
        }
        #expect(log.steps == Array(repeating: "sync", count: LocalFileState.notUploaded.count))
        #expect(folderExists)
    }

    @Test func signOutChecksRecordingsAfterTheSync() async throws {
        try await putRecordingFile(.captured)
        let store = store
        log.onSync = {
            try await store.write { writer in
                try RecordingFile(id: "r1", localState: .uploaded).update(writer.db)
            }
        }

        try await leave(keepingUnsynced: false)

        #expect(!folderExists)
    }

    @Test func signOutLeavesWithRecordingsTheServerHas() async throws {
        try await putRecordingFile(.downloaded)

        try await leave(keepingUnsynced: false)

        #expect(!folderExists)
    }

    @Test func deletingTheAccountDropsUnsentChangesWithoutSyncing() async throws {
        try await queueChange()
        try await putRecordingFile(.captured)

        try await leave(keepingUnsynced: true)

        #expect(log.steps == ["stop", "stopped", "end session"])
        #expect(!folderExists)
    }

    @Test func syncResumesAndTheFolderStaysWhenTheSessionDoesNotEnd() async throws {
        await #expect(throws: ClerkFailed.self) {
            try await leave(keepingUnsynced: false) { throw ClerkFailed() }
        }

        #expect(log.steps == ["sync", "stop", "stopped", "end session", "resume"])
        #expect(folderExists)
        #expect(try await store.pendingChangeCount() == 0)
    }
}

@Test func connectivityFiresOnceWhenGoingOnline() {
    var edge = ConnectivityEdge(wasOffline: true)
    let fired = [true, false, false, true, false].map { edge.update(isOffline: $0) }
    #expect(fired == [false, true, false, false, true])
}

@Test func cleanupKeepsEveryFolderAStoreStillUses() {
    let keep = AccountSession.foldersInUse(
        signedIn: "user_a", open: "user_b", opening: "user_c", closing: ["user_d"])
    #expect(keep == ["user_a", "user_b", "user_c", "user_d"])
    #expect(AccountSession.foldersInUse(signedIn: "user_a", open: nil, opening: nil, closing: []) == ["user_a"])
}

@Test func aStoreOpenedOnlineDoesNotFireAgainForTheSameConnection() {
    // Opening a store resets the edge to the current state, since the launch sync covers it.
    var edge = ConnectivityEdge(wasOffline: false)
    let fired = edge.update(isOffline: false)
    #expect(!fired)
}

/// A server that answers every call with nothing, counting requests. A push can be held until
/// the test releases it.
@MainActor
final class CountingSyncAPI: SyncAPI {
    var pushes = 0
    var pulls = 0
    var holdsPushes = false
    private(set) var heldPush: CheckedContinuation<Void, Never>?

    func push(_ changes: [Change]) async throws -> [PushResult] {
        pushes += 1
        if holdsPushes { await withCheckedContinuation { heldPush = $0 } }
        return changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) }
    }

    func pull(since: Int64) async throws -> PullPage {
        pulls += 1
        // Lets a trigger queued behind this run coalesce into it.
        await Task.yield()
        return PullPage(rows: [], nextSince: since, hasMore: false)
    }

    func storage() async throws -> StorageFigures {
        StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0)
    }

    func resolveLink(url: String) async throws -> ResolvedLink {
        ResolvedLink(provider: "other", url: url)
    }

    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> URL { throw URLError(.badURL) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }

    func releasePush() {
        heldPush?.resume()
        heldPush = nil
    }
}

/// A flag the engine's offline check reads while a test flips it.
@MainActor
final class Offline {
    var isOn: Bool

    init(_ isOn: Bool) {
        self.isOn = isOn
    }
}

@MainActor
@Suite struct SessionSyncTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = CountingSyncAPI()
    let offline = Offline(false)

    init() throws {
        store = try root.open()
    }

    func session(batchSize: Int = SyncEngine.pushBatchSize) -> SessionSync {
        let offline = offline
        // Retries wait for good, so every run a test sees comes from a trigger.
        let engine = SyncEngine(
            store: store, api: api, isOffline: { offline.isOn }, batchSize: batchSize,
            sleep: { _ in try await Task.sleep(for: .seconds(86_400)) })
        return SessionSync(store: store, engine: engine, isActive: true, isOffline: offline.isOn)
    }

    func waitUntil(_ condition: () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    @Test func resumingAfterAFailedSignOutDoesNotSyncByItself() async throws {
        let session = session()
        try await waitUntil { api.pulls > 0 }
        await session.sync()
        let beforeStop = api.pulls

        await session.stop()
        session.resume()
        // A sync queued by resume would coalesce into this run and add one more pull.
        await session.sync()

        #expect(api.pulls == beforeStop + 1)
        session.shutDown()
    }

    @Test func shuttingDownEndsAMultiBatchPushBeforeItsNextBatch() async throws {
        try await store.write { writer in
            try writer.put(Tune(title: "Leather Britches"))
            try writer.put(Tune(title: "Sally Goodin"))
        }
        api.holdsPushes = true
        let session = session(batchSize: 1)
        try await waitUntil { api.heldPush != nil }

        session.shutDown()
        api.releasePush()
        await session.finished()

        #expect(api.pushes == 1)
        #expect(api.pulls == 0)
        #expect(try await store.pendingChangeCount() == 1)
    }

    @Test func aStoreOpenedOnlineSyncsOnceForTheConnectionItOpenedOn() async throws {
        let session = session()
        try await waitUntil { api.pulls > 0 }
        await session.sync()
        let before = api.pulls

        session.connectivityChanged(isOffline: false)
        // A sync the edge fired would coalesce into this run and add one more pull.
        await session.sync()

        #expect(api.pulls == before + 1)
        session.shutDown()
    }

    @Test func aStoreOpenedOfflineSyncsWhenTheConnectionReturns() async throws {
        offline.isOn = true
        let session = session()
        await session.sync()
        #expect(api.pulls == 0)

        offline.isOn = false
        session.connectivityChanged(isOffline: false)

        try await waitUntil { api.pulls == 1 }
        session.shutDown()
    }
}
