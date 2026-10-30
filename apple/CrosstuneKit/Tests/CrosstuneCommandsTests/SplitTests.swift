import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

@Suite struct SplitTests {
    private let root = TemporaryRoot()

    private func seeded(_ parent: Recording? = nil) async throws -> (CrosstuneStore, Commands) {
        let store = try root.open()
        let row =
            parent ?? Recording(id: "rec-1", tuneID: nil, source: "microphone", label: "Session", trimEndMs: 180_000)
        try await store.write { writer in try writer.put(row) }
        return (store, Commands(store: store))
    }

    private func recording(_ store: CrosstuneStore, _ id: String) async throws -> Recording {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
    }

    private func loops(_ store: CrosstuneStore) async throws -> [RecordingLoop] {
        try await store.read { db in try RecordingLoop.fetchAll(db) }
    }

    @Test func narrowsTheParentAndCreatesOneRowPerLaterPiece() async throws {
        let (store, commands) = try await seeded()
        let ids = try await commands.splitRecording("rec-1", cutsMs: [120_000, 60_000])
        let parent = try await recording(store, "rec-1")
        #expect(ids.count == 2)
        #expect(parent.trimStartMs == 0)
        #expect(parent.trimEndMs == 60_000)
        #expect(parent.splitSize == 3)
        #expect(parent.splitID != nil)
        let first = try await recording(store, ids[0])
        let second = try await recording(store, ids[1])
        #expect(first.trimStartMs == 60_000 && first.trimEndMs == 120_000)
        #expect(second.trimStartMs == 120_000 && second.trimEndMs == 180_000)
        for piece in [first, second] {
            #expect(piece.splitFromID == "rec-1")
            #expect(piece.createdBySplitID == parent.splitID)
            #expect(piece.splitID == nil && piece.splitSize == nil && piece.splitCompletedID == nil)
            #expect(piece.state == "processing")
        }
    }

    @Test func copiesDatePlacePlayersNotesSpeedPitchOriginAndSourceAndLeavesTheTuneUnset() async throws {
        let recordedAt = Timestamp.now
        let (store, commands) = try await seeded(
            Recording(
                id: "rec-1", tuneID: "tune-1", source: "upload", origin: "other", originURL: "https://x.test",
                recordedAt: recordedAt, recordedPrecision: "time", label: "Session", trimEndMs: 180_000,
                speedPercent: 80, pitchCents: 50, notes: "n", players: "Ann", placeName: "Hall", placeLat: 1,
                placeLon: 2, placeOrigin: "device"))
        let id = try await commands.splitRecording("rec-1", cutsMs: [60_000])[0]
        let piece = try await recording(store, id)
        #expect(piece.tuneID == nil)
        #expect(piece.recordedAt == recordedAt)
        #expect(piece.recordedPrecision == "time")
        #expect(piece.players == "Ann" && piece.notes == "n")
        #expect(piece.placeName == "Hall" && piece.placeLat == 1 && piece.placeLon == 2)
        #expect(piece.placeOrigin == "device")
        #expect(piece.speedPercent == 80 && piece.pitchCents == 50)
        #expect(piece.origin == "other" && piece.originURL == "https://x.test" && piece.source == "upload")
    }

    @Test func labelsPiecesFromTheParentLabel() async throws {
        let (store, commands) = try await seeded()
        let a = try await commands.splitRecording("rec-1", cutsMs: [60_000])[0]
        #expect(try await recording(store, a).label == "Session, part 2")
        try await store.write {
            try $0.put(Recording(id: "rec-2", tuneID: nil, source: "microphone", trimEndMs: 90_000))
        }
        let b = try await commands.splitRecording("rec-2", cutsMs: [30_000])[0]
        #expect(try await recording(store, b).label == "Part 2")
    }

    @Test func movesALoopInsideALaterPieceAndRemovesOneCrossingACut() async throws {
        let (store, commands) = try await seeded()
        try await store.write { writer in
            try writer.put(RecordingLoop(id: "in1", recordingID: "rec-1", startMs: 1000, endMs: 3000, color: 1))
            try writer.put(
                RecordingLoop(id: "in2", recordingID: "rec-1", label: "B", startMs: 70_000, endMs: 80_000, color: 2))
            try writer.put(RecordingLoop(id: "cross", recordingID: "rec-1", startMs: 50_000, endMs: 70_000, color: 3))
        }
        let piece = try await commands.splitRecording("rec-1", cutsMs: [60_000, 120_000])[0]
        let all = try await loops(store)
        let live = all.filter { $0.deletedAt == nil }
        #expect(live.contains { $0.id == "in1" && $0.recordingID == "rec-1" })
        let moved = live.filter { $0.recordingID == piece }
        try #require(moved.count == 1)
        #expect(moved[0].startMs == 70_000 && moved[0].endMs == 80_000)
        #expect(moved[0].label == "B" && moved[0].color == 2)
        #expect(moved[0].id != "in2")
        #expect(all.first { $0.id == "in2" }?.deletedAt != nil)
        #expect(all.first { $0.id == "cross" }?.deletedAt != nil)
        let queued = try await store.pendingChanges(limit: 50)
        #expect(queued.contains { $0.rowID == "in2" && $0.op == .delete })
        #expect(queued.contains { $0.rowID == moved[0].id && $0.op == .upsert })
    }

    @Test func keepsLoopsInTheFirstPieceAndMovesOneStartingAtACut() async throws {
        let (store, commands) = try await seeded()
        try await store.write { writer in
            try writer.put(RecordingLoop(id: "first", recordingID: "rec-1", startMs: 1000, endMs: 59_000, color: 1))
            try writer.put(RecordingLoop(id: "edge", recordingID: "rec-1", startMs: 60_000, endMs: 70_000, color: 2))
        }
        let piece = try await commands.splitRecording("rec-1", cutsMs: [60_000])[0]
        let live = try await loops(store).filter { $0.deletedAt == nil }
        #expect(live.first { $0.id == "first" }?.recordingID == "rec-1")
        #expect(live.filter { $0.recordingID == piece }.map(\.startMs) == [60_000])
    }

    @Test func queuesEveryRowInTheOutbox() async throws {
        let (store, commands) = try await seeded()
        let ids = try await commands.splitRecording("rec-1", cutsMs: [60_000, 120_000])
        let queued = try await store.pendingChanges(limit: 50)
        for id in ["rec-1"] + ids {
            #expect(queued.contains { $0.rowID == id && $0.op == .upsert })
        }
    }

    @Test func splitsAFreshlyCapturedRowUsingTheFileLength() async throws {
        let (store, commands) = try await seeded(Recording(id: "rec-4", tuneID: nil, source: "microphone"))
        try await store.write { writer in
            try RecordingFile(id: "rec-4", localState: .captured, localDurationMs: 90_000).insert(writer.db)
        }
        let id = try await commands.splitRecording("rec-4", cutsMs: [30_000])[0]
        #expect(try await recording(store, "rec-4").trimEndMs == 30_000)
        let piece = try await recording(store, id)
        #expect(piece.trimStartMs == 30_000 && piece.trimEndMs == 90_000)
    }

    @Test func putsPiecesAtTheEndOfTheUnfiledRecordings() async throws {
        let (store, commands) = try await seeded()
        try await store.write { try $0.put(Recording(id: "u", tuneID: nil, source: "microphone", position: 4)) }
        let ids = try await commands.splitRecording("rec-1", cutsMs: [60_000, 120_000])
        #expect(try await recording(store, ids[0]).position == 5)
        #expect(try await recording(store, ids[1]).position == 6)
    }

    @Test func refusesABadSplitWithACodeAndWritesNothing() async throws {
        let (store, commands) = try await seeded()
        func code(_ cuts: [Int64]) async -> SplitError? {
            do {
                try await commands.splitRecording("rec-1", cutsMs: cuts)
                return nil
            } catch { return error as? SplitError }
        }
        #expect(await code([180_000]) == .cutOutside)
        #expect(await code([0]) == .cutOutside)
        #expect(await code([]) == .cutOutside)
        #expect(await code([500]) == .pieceTooShort)
        #expect(await code([60_000, 60_500]) == .pieceTooShort)
        #expect(await code((1...50).map { Int64($0) * 3000 }) == .tooManyPieces)
        #expect(try await recording(store, "rec-1").splitID == nil)
        #expect(try await store.read { try Recording.fetchCount($0) } == 1)
    }

    @Test func refusesAPieceOverThreeHours() async throws {
        let (_, commands) = try await seeded(
            Recording(id: "rec-long", tuneID: nil, source: "microphone", trimEndMs: 4 * 3_600_000))
        await #expect(throws: SplitError.pieceTooLong) {
            try await commands.splitRecording("rec-long", cutsMs: [1_800_000])
        }
    }

    @Test func refusesARecordingWhoseSplitIsStillOpen() async throws {
        let (_, commands) = try await seeded(
            Recording(id: "rec-3", tuneID: nil, source: "microphone", trimEndMs: 90_000, splitID: "s", splitSize: 2))
        await #expect(throws: SplitError.openSplit) {
            try await commands.splitRecording("rec-3", cutsMs: [30_000])
        }
    }

    private func filedParent(_ store: CrosstuneStore, commands: Commands) async throws -> (String, String) {
        let tuneID = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "learning"))
            .tuneID
        try await store.write { writer in
            try writer.put(
                Recording(id: "rec-5", tuneID: tuneID, source: "microphone", label: "Session", trimEndMs: 180_000))
            try RecordingFile(id: "rec-5", localState: .captured, localDurationMs: 180_000).insert(writer.db)
        }
        let piece = try await commands.splitRecording("rec-5", cutsMs: [60_000])[0]
        return (tuneID, piece)
    }

    @Test func deletingATuneKeepsASplitParentWhosePieceWaitsUnfiled() async throws {
        let (store, commands) = try await seeded()
        let (tuneID, pieceID) = try await filedParent(store, commands: commands)
        try await commands.deleteTune(tuneID)
        let parent = try await recording(store, "rec-5")
        #expect(parent.deletedAt == nil)
        #expect(parent.tuneID == nil)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "rec-5") } != nil)
        #expect(try await recording(store, pieceID).deletedAt == nil)
    }

    private func filePiece(_ store: CrosstuneStore, _ pieceID: String, tuneID: String) async throws {
        try await store.write { writer in
            var piece = try #require(try Recording.fetchOne(writer.db, key: pieceID))
            piece.tuneID = tuneID
            try writer.put(piece)
        }
    }

    @Test func deletingATuneDeletesASplitParentWhoseWaitingPieceIsFiledUnderIt() async throws {
        let (store, commands) = try await seeded()
        let (tuneID, pieceID) = try await filedParent(store, commands: commands)
        try await filePiece(store, pieceID, tuneID: tuneID)
        try await commands.deleteTune(tuneID)
        #expect(try await recording(store, "rec-5").deletedAt != nil)
        #expect(try await recording(store, pieceID).deletedAt != nil)
    }

    @Test func deletingTunesTogetherDeletesAParentWhoseWaitingPieceIsInAnotherOfThem() async throws {
        for parentFirst in [true, false] {
            let (store, commands) = try await seeded()
            let (tuneID, pieceID) = try await filedParent(store, commands: commands)
            let other = try await commands.createTune(
                TuneInput(title: "Y"), userTune: UserTuneInput(status: "learning"))
            try await filePiece(store, pieceID, tuneID: other.tuneID)
            let parentUserTune = try #require(
                try await store.read { db in
                    try UserTune.filter(Column("tune_id") == tuneID).fetchOne(db)
                })
            let ids = [parentUserTune.id, other.userTuneID]
            try await commands.deleteTunes(parentFirst ? ids : ids.reversed())
            #expect(try await recording(store, "rec-5").deletedAt != nil)
            #expect(try await recording(store, pieceID).deletedAt != nil)
            try await store.write { writer in try writer.db.execute(sql: "DELETE FROM recordings") }
        }
    }

    @Test func deletingATuneUnfilesAHeldParentAndLeavesItsLoopsAlone() async throws {
        let (store, commands) = try await seeded()
        let (tuneID, _) = try await filedParent(store, commands: commands)
        try await store.write { writer in
            try writer.put(RecordingLoop(id: "live", recordingID: "rec-5", startMs: 1000, endMs: 3000, color: 1))
            try writer.db.execute(sql: "DELETE FROM outbox WHERE table_name = 'recording_loops'")
        }
        let before = try #require(try await loops(store).first { $0.id == "live" })
        try await commands.deleteTune(tuneID)
        #expect(try await loops(store).first { $0.id == "live" } == before)
        let entries = try await store.read { db in try OutboxEntry.order(Column("seq")).fetchAll(db) }
        #expect(!entries.contains { $0.tableName == .recordingLoops })
        let parentEntry = try #require(entries.last { $0.tableName == .recordings && $0.rowID == "rec-5" })
        #expect(parentEntry.op == .upsert)
    }

    @Test func deletingATuneDeletesASplitParentWhosePiecesAreCutOrWhichFailed() async throws {
        for parentState in ["ready", "failed"] {
            let (store, commands) = try await seeded()
            let (tuneID, pieceID) = try await filedParent(store, commands: commands)
            try await store.write { writer in
                if parentState == "failed" {
                    var parent = try #require(try Recording.fetchOne(writer.db, key: "rec-5"))
                    parent.state = "failed"
                    try writer.put(parent)
                } else {
                    var piece = try #require(try Recording.fetchOne(writer.db, key: pieceID))
                    piece.state = "ready"
                    try writer.put(piece)
                }
            }
            try await commands.deleteTune(tuneID)
            #expect(try await recording(store, "rec-5").deletedAt != nil)
            #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "rec-5") } == nil)
            try await store.write { writer in try writer.db.execute(sql: "DELETE FROM recordings") }
        }
    }

    @Test func refusesToDeleteASplitParentWhilePieceWaits() async throws {
        let (store, commands) = try await seeded()
        let (_, _) = try await filedParent(store, commands: commands)
        await #expect(throws: SplitError.openSplit) {
            try await commands.deleteRecording("rec-5")
        }
        #expect(try await recording(store, "rec-5").deletedAt == nil)
    }

    @Test func refusesAMissingOrRemovedRecording() async throws {
        let (_, commands) = try await seeded()
        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.splitRecording("nope", cutsMs: [30_000])
        }
    }
}
