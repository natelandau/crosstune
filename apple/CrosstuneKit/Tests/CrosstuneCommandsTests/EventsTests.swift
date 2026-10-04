import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

@Suite struct EventsTests {
    private let root = TemporaryRoot()

    @Test func recordEventWritesTheRowAndOneUpsert() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let session = PracticeSession(
            createdAt: noon, recordingID: "r1", startedAt: later(-60_000), durationMs: 60_000, speedPercent: 80,
            pitchCents: 0, loopIDs: ["loop-1"])

        try await commands.recordEvent(session)

        let (stored, entries) = try await store.read { db in
            (try PracticeSession.fetchOne(db, key: session.id), try OutboxEntry.fetchAll(db))
        }
        #expect(stored == session)
        #expect(entries.queuedOps == [QueuedOp(table: .practiceSessions, op: .upsert)])
        #expect(entries.first?.rowID == session.id)
        #expect(entries.first?.updatedAt == noon)
        #expect(
            entries.first?.data == [
                "created_at": .string(noon.iso), "recording_id": .string("r1"), "tune_id": .null,
                "started_at": .string(later(-60_000).iso), "duration_ms": .integer(60_000),
                "speed_percent": .integer(80), "pitch_cents": .integer(0), "loop_ids": .array([.string("loop-1")]),
            ])
    }

    @Test func recordEventQueuesAScanViewWithEveryField() async throws {
        let store = try root.open()
        let view = ScanView(createdAt: noon, tuneID: "t1", context: "tune", startedAt: later(-5_000), viewedMs: 5_000)

        try await Commands(store: store).recordEvent(view)

        let (stored, entries) = try await store.read { db in
            (try ScanView.fetchOne(db, key: view.id), try OutboxEntry.fetchAll(db))
        }
        #expect(stored == view)
        #expect(entries.queuedOps == [QueuedOp(table: .scanViews, op: .upsert)])
        #expect(
            entries.first?.data == [
                "created_at": .string(noon.iso), "tune_id": .string("t1"), "context": .string("tune"),
                "list_id": .null, "started_at": .string(later(-5_000).iso), "viewed_ms": .integer(5_000),
            ])
    }
}
