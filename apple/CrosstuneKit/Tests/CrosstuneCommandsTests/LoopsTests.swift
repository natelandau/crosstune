import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

private let noon = Timestamp.now

@Suite struct LoopsTests {
    private let root = TemporaryRoot()

    private func seeded() async throws -> (CrosstuneStore, Commands, String) {
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "microphone", recordedAt: .now))
        }
        return (store, commands, "r1")
    }

    private func loop(_ store: CrosstuneStore, _ id: String) async throws -> RecordingLoop? {
        try await store.read { db in try RecordingLoop.fetchOne(db, key: id) }
    }

    @Test func writesARowAndOneUpsert() async throws {
        let (store, commands, recordingID) = try await seeded()

        let created = try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 4000, label: nil)

        let row = try #require(try await loop(store, created.id))
        #expect(row.recordingID == recordingID)
        #expect(row.startMs == 1000)
        #expect(row.endMs == 4000)
        #expect(row.color == 0)
        let queued = try await store.pendingChanges(limit: 10).filter { $0.rowID == created.id }
        #expect(queued.count == 1)
        #expect(queued.first?.op == .upsert)
        #expect(queued.first?.data?["start_ms"] == .integer(1000))
    }

    @Test func storesABlankLabelAsNil() async throws {
        let (store, commands, recordingID) = try await seeded()
        let blank = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 900, label: "  ")
        let named = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 900, label: " A part ")
        #expect(try await loop(store, blank.id)?.label == nil)
        #expect(try await loop(store, named.id)?.label == "A part")
    }

    @Test func picksAColorAwayFromOverlappingLoops() async throws {
        let (store, commands, recordingID) = try await seeded()
        let first = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 2000, label: nil)
        let second = try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 3000, label: nil)
        #expect(try await loop(store, first.id)?.color == 0)
        #expect(try await loop(store, second.id)?.color == 1)
    }

    @Test func refusesAnUnknownOrDeletedRecording() async throws {
        let (_, commands, recordingID) = try await seeded()
        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.addLoop(recordingID: "missing", startMs: 0, endMs: 1000, label: nil)
        }
        try await commands.deleteRecording(recordingID)
        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        }
    }

    @Test func refusesThe101stLiveLoopAndIgnoresRemovedOnes() async throws {
        let (store, commands, recordingID) = try await seeded()
        var ids: [String] = []
        for index in 0..<100 {
            let created = try await commands.addLoop(
                recordingID: recordingID, startMs: Int64(index) * 1000, endMs: Int64(index) * 1000 + 600, label: nil)
            ids.append(created.id)
        }
        await #expect(throws: CommandError.loopLimit) {
            try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        }
        #expect(CommandError.loopLimit.errorDescription == "This recording has 100 loops.")
        let before = try await store.pendingChanges(limit: 1000).count

        try await commands.removeLoop(ids[0])
        _ = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        #expect(try await store.pendingChanges(limit: 1000).count == before + 1)
    }

    @Test func updatesALiveLoopAndLeavesAnOmittedFieldAlone() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 4000, label: "A")

        try await commands.updateLoop(created.id, endMs: .value(5000), label: .value(nil))

        let row = try #require(try await loop(store, created.id))
        #expect(row.startMs == 1000)
        #expect(row.endMs == 5000)
        #expect(row.label == nil)
        #expect(row.updatedAt > created.updatedAt)
    }

    @Test func enqueuesADeleteOnRemove() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)

        try await commands.removeLoop(created.id)

        #expect(try await loop(store, created.id)?.deletedAt != nil)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == created.id })
        #expect(queued.op == .delete)
    }

    @Test func restoresARemovedLoopAsAnUpsertOfItsSpan() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 2000, endMs: 3000, label: "B")
        try await commands.removeLoop(created.id)

        try await commands.restoreLoop(created.id)

        let row = try #require(try await loop(store, created.id))
        #expect(row.deletedAt == nil)
        #expect(row.startMs == 2000)
        #expect(row.label == "B")
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == created.id })
        #expect(queued.op == .upsert)
    }

    @Test func refusesToRestoreALoopPastTheCap() async throws {
        let (store, commands, recordingID) = try await seeded()
        let removed = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        try await commands.removeLoop(removed.id)
        for index in 0..<100 {
            try await commands.addLoop(
                recordingID: recordingID, startMs: Int64(index) * 1000, endMs: Int64(index) * 1000 + 600, label: nil)
        }

        await #expect(throws: CommandError.loopLimit) { try await commands.restoreLoop(removed.id) }
        #expect(try await loop(store, removed.id)?.deletedAt != nil)
    }

    @Test func refusesToRestoreALoopWhoseRecordingIsGone() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        try await commands.removeLoop(created.id)
        try await commands.deleteRecording(recordingID)

        await #expect(throws: CommandError.recordingNotFound) { try await commands.restoreLoop(created.id) }
        #expect(try await loop(store, created.id)?.deletedAt != nil)
    }

    @Test func leavesAStoredLabelAloneWhenTheLabelIsNotPatched() async throws {
        let (store, commands, recordingID) = try await seeded()
        try await store.write { writer in
            try writer.put(
                RecordingLoop(
                    id: "l1", createdAt: noon, updatedAt: noon, recordingID: recordingID,
                    label: " A part ", startMs: 0, endMs: 1000, color: 0))
        }

        try await commands.updateLoop("l1", endMs: .value(2000))

        #expect(try await loop(store, "l1")?.label == " A part ")
    }

    @Test func deletingARecordingTombstonesItsLoopsWithoutQueuingThem() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)

        try await commands.deleteRecording(recordingID)

        #expect(try await loop(store, created.id)?.deletedAt != nil)
        #expect(try await store.pendingChanges(limit: 10).contains { $0.rowID == created.id } == false)
    }

    @Test func deletingATuneTombstonesItsRecordingsLoops() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: tuneID, source: "microphone", recordedAt: .now))
        }
        let created = try await commands.addLoop(recordingID: "r1", startMs: 0, endMs: 1000, label: nil)

        try await commands.deleteTune(tuneID)

        #expect(try await loop(store, created.id)?.deletedAt != nil)
        #expect(try await store.pendingChanges(limit: 10).contains { $0.rowID == created.id } == false)
    }
}
