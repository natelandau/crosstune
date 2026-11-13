import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneCommands

@Suite(.timeLimit(.minutes(1))) struct RecordingsBulkTests {
    private let root = TemporaryRoot()

    private func tune(_ commands: Commands, _ title: String) async throws -> String {
        try await commands.createTune(TuneInput(title: title), userTune: UserTuneInput(status: "known")).tuneID
    }

    private func recording(_ store: CrosstuneStore, _ id: String, sourceLocation: SourceLocation = #_sourceLocation)
        async throws -> Recording
    {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) }, sourceLocation: sourceLocation)
    }

    @Test func linksFiledAndUnfiledRecordingsAndReturnsEachEarlierTune() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await tune(commands, "A")
        let b = try await tune(commands, "B")
        try await store.write { writer in
            try writer.put(Recording(id: "on-a", tuneID: a, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "unfiled", tuneID: nil, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "on-b", tuneID: b, source: "microphone", addedAt: .now))
        }

        let earlier = try await commands.linkRecordings(["on-a", "unfiled", "on-b"], to: b)

        let expected: [String: String?] = ["on-a": a, "unfiled": nil]
        #expect(earlier == expected, "only the recordings that moved, for undo")
        for id in ["on-a", "unfiled", "on-b"] {
            #expect(try await recording(store, id).tuneID == b)
        }
    }

    @Test func restoringPutsEachRecordingBackOnItsEarlierTuneOrUnfiled() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await tune(commands, "A")
        let b = try await tune(commands, "B")
        try await store.write { writer in
            try writer.put(Recording(id: "on-a", tuneID: a, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "unfiled", tuneID: nil, source: "microphone", addedAt: .now))
        }
        let earlier = try await commands.linkRecordings(["on-a", "unfiled"], to: b)

        try await commands.restoreRecordingTunes(earlier)

        #expect(try await recording(store, "on-a").tuneID == a)
        #expect(try await recording(store, "unfiled").tuneID == nil)
    }

    @Test func restoringSendsARecordingWhoseEarlierTuneIsGoneToUnfiled() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await tune(commands, "A")
        let c = try await tune(commands, "C")
        let b = try await tune(commands, "B")
        try await store.write { writer in
            try writer.put(Recording(id: "on-a", tuneID: a, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "on-c", tuneID: c, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "on-missing", tuneID: nil, source: "microphone", addedAt: .now))
        }
        var earlier = try await commands.linkRecordings(["on-a", "on-c", "on-missing"], to: b)
        try await commands.deleteTune(a)
        // A tune with no row at all is gone too.
        earlier["on-missing"] = "missing"

        try await commands.restoreRecordingTunes(earlier)

        #expect(try await recording(store, "on-a").tuneID == nil)
        #expect(try await recording(store, "on-missing").tuneID == nil)
        #expect(try await recording(store, "on-c").tuneID == c)
    }

    @Test func refusesATuneThatIsGoneAndWritesNothing() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "unfiled", tuneID: nil, source: "microphone", addedAt: .now))
        }

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.linkRecordings(["unfiled"], to: "missing")
        }
        #expect(try await recording(store, "unfiled").tuneID == nil)
    }

    @Test func deletesEveryRecordingButASplitParentWhosePieceWaits() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await tune(commands, "A")
        try await store.write { writer in
            try writer.put(Recording(id: "parent", tuneID: a, source: "microphone", trimEndMs: 180_000))
            try RecordingFile(id: "parent", localState: .captured, localDurationMs: 180_000).insert(writer.db)
            try writer.put(Recording(id: "filed", tuneID: a, source: "microphone", addedAt: .now))
            try writer.put(Recording(id: "unfiled", tuneID: nil, source: "microphone", addedAt: .now))
            try RecordingFile(id: "unfiled", localState: .captured).insert(writer.db)
        }
        _ = try await commands.splitRecording("parent", cutsMs: [60_000])

        let deleted = try await commands.deleteRecordings(["parent", "filed", "unfiled"])

        #expect(deleted == ["filed", "unfiled"])
        #expect(try await recording(store, "parent").deletedAt == nil)
        #expect(try await recording(store, "filed").deletedAt != nil)
        #expect(try await recording(store, "unfiled").deletedAt != nil)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "unfiled") } == nil)
    }

    /// A piece deleted in the same delete no longer holds its parent, as a tune delete reads it.
    @Test func deletesASplitParentWithItsWaitingPiece() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "parent", tuneID: nil, source: "microphone", trimEndMs: 180_000))
            try RecordingFile(id: "parent", localState: .captured, localDurationMs: 180_000).insert(writer.db)
        }
        let piece = try await commands.splitRecording("parent", cutsMs: [60_000])[0]

        #expect(try await commands.recordingsHeldByDelete(["parent", piece]).isEmpty)
        #expect(try await commands.recordingsHeldByDelete(["parent"]) == ["parent"])
        let deleted = try await commands.deleteRecordings(["parent", piece])

        #expect(Set(deleted) == ["parent", piece])
        #expect(try await recording(store, "parent").deletedAt != nil)
    }
}
