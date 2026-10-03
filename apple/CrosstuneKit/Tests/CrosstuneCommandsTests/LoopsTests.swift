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
        let named = try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 1900, label: " A part ")
        #expect(try await loop(store, blank.id)?.label == nil)
        #expect(try await loop(store, named.id)?.label == "A part")
    }

    @Test func picksAColorAwayFromBothNeighbors() async throws {
        let (store, commands, recordingID) = try await seeded()
        let first = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        let third = try await commands.addLoop(recordingID: recordingID, startMs: 4000, endMs: 5000, label: nil)
        let middle = try await commands.addLoop(recordingID: recordingID, startMs: 2000, endMs: 3000, label: nil)
        #expect(try await loop(store, first.id)?.color == 0)
        #expect(try await loop(store, third.id)?.color == 1)
        #expect(try await loop(store, middle.id)?.color == 2)
    }

    private func seededWithTrim(start: Int64, end: Int64?, duration: Int64?) async throws -> (CrosstuneStore, Commands)
    {
        let store = try root.open()
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: "r1", tuneID: nil, source: "microphone", recordedAt: .now, sourceDurationMs: duration,
                    trimStartMs: start, trimEndMs: end))
        }
        return (store, Commands(store: store))
    }

    @Test func clampsANewLoopIntoItsGap() async throws {
        let (store, commands, recordingID) = try await seeded()
        try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 2000, label: nil)
        try await commands.addLoop(recordingID: recordingID, startMs: 6000, endMs: 8000, label: nil)

        let created = try await commands.addLoop(recordingID: recordingID, startMs: 2500, endMs: 9000, label: nil)

        let row = try #require(try await loop(store, created.id))
        #expect(row.startMs == 2500)
        #expect(row.endMs == 6000)
    }

    @Test func refusesANewLoopStartingInsideAnother() async throws {
        let (_, commands, recordingID) = try await seeded()
        try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 5000, label: nil)
        await #expect(throws: CommandError.noRoom) {
            try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 3000, label: nil)
        }
        await #expect(throws: CommandError.noRoom) {
            try await commands.addLoop(recordingID: recordingID, startMs: 4000, endMs: 6000, label: nil)
        }
    }

    @Test func allowsFlushLoopsAndRefusesAGapUnderTheMinimum() async throws {
        let (_, commands, recordingID) = try await seeded()
        try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        try await commands.addLoop(recordingID: recordingID, startMs: 1000, endMs: 2000, label: nil)
        try await commands.addLoop(recordingID: recordingID, startMs: 2499, endMs: 4000, label: nil)
        await #expect(throws: CommandError.noRoom) {
            try await commands.addLoop(recordingID: recordingID, startMs: 2000, endMs: 3000, label: nil)
        }
        #expect(CommandError.noRoom.errorDescription == "No room for a loop here.")
    }

    @Test func holdsANewLoopInsideTheTrimAndIgnoresRemovedLoops() async throws {
        let (store, commands) = try await seededWithTrim(start: 1000, end: 5000, duration: 9000)
        let blocker = try await commands.addLoop(recordingID: "r1", startMs: 1000, endMs: 3000, label: nil)
        try await commands.removeLoop(blocker.id)

        let created = try await commands.addLoop(recordingID: "r1", startMs: 500, endMs: 9000, label: nil)
        let row = try #require(try await loop(store, created.id))
        #expect(row.startMs == 1000)
        #expect(row.endMs == 5000)
    }

    @Test func boundsAnUntrimmedLoopByTheSourceDuration() async throws {
        let (store, commands) = try await seededWithTrim(start: 0, end: nil, duration: 4000)
        let created = try await commands.addLoop(recordingID: "r1", startMs: 1000, endMs: 9000, label: nil)
        #expect(try await loop(store, created.id)?.endMs == 4000)
    }

    @Test func clampsAnUpdatedSpanAtItsNeighbors() async throws {
        let (store, commands, recordingID) = try await seeded()
        try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 2000, label: nil)
        let middle = try await commands.addLoop(recordingID: recordingID, startMs: 3000, endMs: 4000, label: nil)
        try await commands.addLoop(recordingID: recordingID, startMs: 6000, endMs: 8000, label: nil)

        try await commands.updateLoop(middle.id, startMs: .value(1000), endMs: .value(9000))

        let row = try #require(try await loop(store, middle.id))
        #expect(row.startMs == 2000)
        #expect(row.endMs == 6000)
    }

    @Test func refusesAnUpdatedSpanUnderTheMinimum() async throws {
        let (store, commands, recordingID) = try await seeded()
        let first = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 2000, label: nil)
        try await commands.addLoop(recordingID: recordingID, startMs: 2000, endMs: 3000, label: nil)

        await #expect(throws: CommandError.noRoom) {
            try await commands.updateLoop(first.id, startMs: .value(1900), endMs: .value(2100))
        }
        #expect(try await loop(store, first.id)?.endMs == 2000)
    }

    @Test func leavesALabelOnlyUpdateUnclamped() async throws {
        let (store, commands, recordingID) = try await seeded()
        try await store.write { writer in
            try writer.put(
                RecordingLoop(
                    id: "a", createdAt: noon, updatedAt: noon, recordingID: recordingID,
                    label: nil, startMs: 0, endMs: 3000, color: 0))
            try writer.put(
                RecordingLoop(
                    id: "b", createdAt: noon, updatedAt: noon, recordingID: recordingID,
                    label: nil, startMs: 2000, endMs: 4000, color: 1))
        }

        try await commands.updateLoop("a", label: .value("A"))

        let row = try #require(try await loop(store, "a"))
        #expect(row.label == "A")
        #expect(row.endMs == 3000)
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

    @Test func refusesToMoveALoopOfADeletedRecording() async throws {
        let (store, commands, recordingID) = try await seeded()
        let created = try await commands.addLoop(recordingID: recordingID, startMs: 0, endMs: 1000, label: nil)
        // As a sync pull leaves it: the recording deleted before its loops' tombstones land.
        try await store.write { writer in
            var recording = try #require(try Recording.fetchOne(writer.db, key: recordingID))
            recording.deletedAt = .now
            try recording.update(writer.db)
        }
        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.updateLoop(created.id, startMs: .value(200))
        }
        #expect(try await loop(store, created.id)?.startMs == 0)
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
