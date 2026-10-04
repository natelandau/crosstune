import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync

@MainActor
@Suite struct EventsPullTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = FakeSyncAPI()
    let sleeper = ManualSleeper()

    init() throws {
        store = try root.open()
    }

    func engine(isOffline: @escaping @MainActor () -> Bool = { false }) -> SyncEngine {
        SyncEngine(
            store: store, api: api, isOffline: isOffline, batchSize: SyncEngine.pushBatchSize, sleep: sleeper.sleep,
            transferPass: {})
    }

    func eventsCursor() async throws -> Int64? {
        try await store.meta(.eventsCursor, as: Int64.self)
    }

    func storedIDs() async throws -> [String] {
        try await store.read { db in
            try String.fetchAll(
                db,
                sql: """
                    SELECT id FROM play_events UNION ALL SELECT id FROM practice_sessions
                    UNION ALL SELECT id FROM scan_views UNION ALL SELECT id FROM status_changes
                    """)
        }
    }

    @Test func pullEventsPagesAndStoresCursor() async throws {
        let session: JSONObject = [
            "id": .string("s1"), "server_seq": .integer(11), "created_at": .string(noon.iso),
            "recording_id": .string("r1"), "tune_id": .null, "started_at": .string(noon.iso),
            "duration_ms": .integer(90_000), "speed_percent": .integer(75), "pitch_cents": .integer(-100),
            "loop_ids": .array([.string("loop-1")]), "user_id": .string("server-user"),
        ]
        let change: JSONObject = [
            "id": .string("c1"), "server_seq": .integer(12), "user_tune_id": .string("ut1"),
            "from_status": .null, "to_status": .string("learning"), "changed_at": .string(noon.iso),
        ]
        api.eventsQueue = [
            .success(
                EventsPage(
                    rows: [
                        PulledEvent(table: "play_events", row: serverPlay(id: "p1", serverSeq: 10)),
                        PulledEvent(table: "practice_sessions", row: session),
                    ], nextSince: 11, hasMore: true)),
            .success(
                EventsPage(rows: [PulledEvent(table: "status_changes", row: change)], nextSince: 12, hasMore: false)),
        ]
        let engine = engine()

        await engine.pullEvents()

        #expect(api.eventPulls == [0, 11])
        #expect(try await eventsCursor() == 12)
        #expect(try await store.pendingChangeCount() == 0)
        let (play, practice, status) = try await store.read { db in
            (
                try PlayEvent.fetchOne(db, key: "p1"), try PracticeSession.fetchOne(db, key: "s1"),
                try StatusChange.fetchOne(db, key: "c1")
            )
        }
        #expect(play?.serverSeq == 10)
        #expect(play?.context == "list")
        #expect(play?.linkID == "link-1")
        #expect(play?.listenedMs == 30_000)
        #expect(practice?.loopIDs == ["loop-1"])
        #expect(practice?.pitchCents == -100)
        #expect(status?.toStatus == "learning")
        #expect(status?.fromStatus == nil)
        #expect(status?.changedAt == noon)

        await engine.pullEvents()
        #expect(api.eventPulls == [0, 11, 12])
    }

    @Test func pullEventsStoresScanViews() async throws {
        let view: JSONObject = [
            "id": .string("v1"), "server_seq": .integer(7), "created_at": .string(noon.iso),
            "tune_id": .string("t1"), "context": .string("list"), "list_id": .string("list-1"),
            "started_at": .string(noon.iso), "viewed_ms": .integer(4_500), "user_id": .string("server-user"),
        ]
        api.eventsQueue = [
            .success(EventsPage(rows: [PulledEvent(table: "scan_views", row: view)], nextSince: 7, hasMore: false))
        ]

        await engine().pullEvents()

        #expect(try await eventsCursor() == 7)
        #expect(try await store.pendingChangeCount() == 0)
        let stored = try await store.read { db in try ScanView.fetchOne(db, key: "v1") }
        #expect(
            stored
                == ScanView(
                    id: "v1", createdAt: noon, serverSeq: 7, tuneID: "t1", context: "list", listID: "list-1",
                    startedAt: noon, viewedMs: 4_500))
    }

    @Test func eventsPullKeepsAppliedPagesWhenALaterPageFails() async throws {
        api.eventsQueue = [
            .success(
                EventsPage(
                    rows: [PulledEvent(table: "play_events", row: serverPlay(id: "p1", serverSeq: 5))], nextSince: 5,
                    hasMore: true)),
            .failure(URLError(.networkConnectionLost)),
        ]
        let engine = engine()

        await engine.pullEvents()

        #expect(api.eventPulls == [0, 5])
        #expect(try await eventsCursor() == 5)
        #expect(try await storedIDs() == ["p1"])

        await engine.pullEvents()
        #expect(api.eventPulls == [0, 5, 5])
    }

    @Test func pullEventsDoesNothingOffline() async throws {
        let engine = engine(isOffline: { true })

        await engine.pullEvents()

        #expect(api.eventPulls.isEmpty)
        #expect(try await eventsCursor() == nil)
    }

    @Test func anEventsPageSkipsATableThisBuildDoesNotKnow() async throws {
        api.eventsQueue = [
            .success(
                EventsPage(
                    rows: [
                        PulledEvent(table: "tempo_marks", row: ["id": .string("x1"), "server_seq": .integer(3)]),
                        PulledEvent(table: "play_events", row: serverPlay(id: "p1", serverSeq: 4)),
                    ], nextSince: 4, hasMore: false))
        ]

        await engine().pullEvents()

        #expect(try await eventsCursor() == 4)
        #expect(try await storedIDs() == ["p1"])
    }

    @Test func aPushedPlayKeepsTheServersSeq() async throws {
        let play = try await recordPlay(store, id: "p1")

        await engine().sync()

        let sent = try #require(api.pushes.first?.first)
        #expect(sent.table == .playEvents)
        #expect(sent.op == .upsert)
        #expect(sent.updatedAt == play.createdAt)
        #expect(
            sent.data == [
                "created_at": .string(noon.iso), "context": .string("row"), "started_at": .string(noon.iso),
                "listened_ms": .integer(12_000), "recording_id": .string("r1"), "link_id": .null,
                "list_id": .null, "tune_id": .null,
            ])
        let stored = try await store.read { db in try PlayEvent.fetchOne(db, key: "p1") }
        #expect(stored?.serverSeq == 1)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func aPushedScanViewKeepsTheServersSeq() async throws {
        let view = try await recordScanView(store, id: "v1")

        await engine().sync()

        let sent = try #require(api.pushes.first?.first)
        #expect(sent.table == .scanViews)
        #expect(sent.op == .upsert)
        #expect(sent.updatedAt == view.createdAt)
        #expect(
            sent.data == [
                "created_at": .string(noon.iso), "tune_id": .string("t1"), "context": .string("list"),
                "list_id": .string("list-1"), "started_at": .string(noon.iso), "viewed_ms": .integer(4_000),
            ])
        let stored = try await store.read { db in try ScanView.fetchOne(db, key: "v1") }
        #expect(stored?.serverSeq == 1)
        #expect(try await store.pendingChangeCount() == 0)
    }

    /// Starts an events pull whose request is held, then a sync, and returns once the sync waits
    /// behind it.
    func syncQueuedBehindAHeldEventsPull(
        _ engine: SyncEngine
    ) async throws -> (
        release: CheckedContinuation<Void, Never>, pulling: Task<Void, Never>, syncing: Task<Void, Never>
    ) {
        var held: CheckedContinuation<Void, Never>?
        api.onEvents = { await withCheckedContinuation { held = $0 } }
        let pulling = Task { await engine.pullEvents() }
        try await waitUntil { held != nil }
        let syncing = Task { await engine.sync() }
        try await waitUntil { engine.queuedTurns == 2 }
        return (try #require(held), pulling, syncing)
    }

    @Test func aSyncWaitsForAnEventsPullInFlight() async throws {
        try await createTune(store, title: "X")
        let engine = engine()
        let (release, pulling, syncing) = try await syncQueuedBehindAHeldEventsPull(engine)

        release.resume()
        await pulling.value
        await syncing.value

        #expect(api.log == ["events-start", "events-end", "push"])
        #expect(api.pulls == [0])
    }

    @Test func aSyncWaitingBehindAnEventsPullStopsWithTheEngine() async throws {
        try await createTune(store, title: "X")
        let engine = engine()
        let (release, pulling, syncing) = try await syncQueuedBehindAHeldEventsPull(engine)

        engine.stop()
        release.resume()
        await pulling.value
        await syncing.value

        #expect(api.log == ["events-start", "events-end"])
        #expect(api.pulls.isEmpty)
        #expect(engine.status == .idle)
    }
}
