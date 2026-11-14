import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

struct RecordingBulkTextTests {
    @Test(arguments: [
        (1, "Linked 1 recording to Kitchen Girl", "Delete 1 recording?", "1 is still splitting and will stay."),
        (3, "Linked 3 recordings to Kitchen Girl", "Delete 3 recordings?", "3 are still splitting and will stay."),
    ])
    func countsInTheSingularAtOne(count: Int, linked: String, title: String, held: String) {
        #expect(RecordingsListText.linked(count, to: "Kitchen Girl") == linked)
        #expect(RecordingsListText.deleteTitle(count) == title)
        #expect(RecordingsListText.held(count) == held)
    }

    @Test(arguments: [
        (1, false, 0, "It is removed from every device."),
        (1, true, 0, "It has not been uploaded, so this cannot be undone."),
        (3, false, 0, "They are removed from every device."),
        (3, true, 0, "Some have not been uploaded, so this cannot be undone."),
        (1, false, 2, "It is removed from every device. 2 are still splitting and will stay."),
        (3, true, 1, "Some have not been uploaded, so this cannot be undone. 1 is still splitting and will stay."),
        (0, false, 2, "2 are still splitting and will stay."),
    ])
    func saysWhatTheDeleteCosts(deleting: Int, notUploaded: Bool, held: Int, message: String) {
        #expect(RecordingsListText.deleteMessage(deleting: deleting, notUploaded: notUploaded, held: held) == message)
    }
}

private func selected(_ id: String, notUploaded: Bool = false, holdsSplitAudio: Bool = false) -> RecordingView {
    RecordingView(
        recording: Recording(
            id: id, tuneID: nil, source: "microphone", state: notUploaded ? "pending_upload" : "ready"),
        file: notUploaded ? RecordingFile(id: id, localState: .captured) : nil, tuneID: nil, tuneTitle: nil,
        holdsSplitAudio: holdsSplitAudio)
}

@MainActor
struct RecordingBulkDeleteRuleTests {
    /// One recording is asked about in the single delete's words; several in the bulk words.
    @Test(
        arguments: [
            ([selected("a")], Set<String>(), RecordingsModel.deleteMessage(selected("a"))),
            (
                [selected("a", notUploaded: true)], Set<String>(),
                RecordingsModel.deleteMessage(selected("a", notUploaded: true))
            ),
            (
                [selected("a"), selected("b", notUploaded: true)], Set<String>(),
                RecordingsListText.deleteMessage(deleting: 2, notUploaded: true, held: 0)
            ),
            (
                [selected("a"), selected("b", holdsSplitAudio: true)], Set(["b"]),
                RecordingsListText.deleteMessage(deleting: 1, notUploaded: false, held: 1)
            ),
        ] as [([RecordingView], Set<String>, String)])
    func asksInTheSingleDeletesWordsForOneRecording(views: [RecordingView], held: Set<String>, message: String) {
        #expect(RecordingsListText.deleteMessage(views, held: held) == message)
    }

    /// Delete is disabled only when every selected recording is still splitting.
    @Test(
        arguments: [
            ([], nil),
            ([selected("a", holdsSplitAudio: true)], RecordingScreenText.deleteWhileSplitting),
            (
                [selected("a", holdsSplitAudio: true), selected("b", holdsSplitAudio: true)],
                RecordingScreenText.deleteWhileSplitting
            ),
            ([selected("a", holdsSplitAudio: true), selected("b")], nil),
        ] as [([RecordingView], String?)])
    func deleteIsDisabledWhileEverySelectedRecordingIsSplitting(views: [RecordingView], reason: String?) {
        #expect(RecordingBulkActions.deleteDisabledReason(views) == reason)
    }
}

/// A selection that spans the Unfiled section and a tune's section acts on every row in it.
@MainActor
@Suite struct RecordingBulkActionsTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func tune(_ title: String, in store: CrosstuneStore) async throws -> String {
        try await Commands(store: store).createTune(
            TuneInput(title: title), userTune: UserTuneInput(status: "known"), at: noon
        ).tuneID
    }

    private func view(
        _ id: String, tuneID: String? = nil, state: String = "ready", file: LocalFileState? = nil,
        holdsSplitAudio: Bool = false, in store: CrosstuneStore
    ) async throws -> RecordingView {
        let row = Recording(id: id, tuneID: tuneID, source: "microphone", addedAt: noon, state: state)
        let stored = file.map { RecordingFile(id: id, localState: $0) }
        try await store.write { writer in
            try writer.put(row, at: noon)
            try stored?.insert(writer.db)
        }
        return RecordingView(
            recording: row, file: stored, tuneID: tuneID, tuneTitle: nil, holdsSplitAudio: holdsSplitAudio)
    }

    private func tuneID(of id: String, in store: CrosstuneStore) async throws -> String? {
        try await store.read { db in try Recording.fetchOne(db, key: id) }?.tuneID
    }

    @Test func linksEverySelectedRecordingAndUndoesFromTheBanner() async throws {
        let store = try root.open()
        let a = try await tune("A", in: store)
        let b = try await tune("Kitchen Girl", in: store)
        let views = [try await view("unfiled", in: store), try await view("on-a", tuneID: a, in: store)]
        let bulk = RecordingBulkActions(store: store, analytics: sink.client)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager

        #expect(await bulk.link(views, to: b, tuneTitle: "Kitchen Girl"))

        #expect(try await tuneID(of: "unfiled", in: store) == b)
        #expect(try await tuneID(of: "on-a", in: store) == b)
        let offer = try #require(bulk.undoBannerItem)
        #expect(offer.message == RecordingsListText.linked(2, to: "Kitchen Girl"))
        #expect(undoManager.undoActionName == RecordingsListText.linkToTune)
        #expect(
            sink.captures.map { $0.properties["from"] } == [.string("unfiled"), .string("other_tune")],
            "one recording_filed per recording")

        offer.undo?()
        try await eventually { try await tuneID(of: "on-a", in: store) == a }
        #expect(try await tuneID(of: "unfiled", in: store) == nil)
        #expect(undoManager.canUndo == false, "the banner's undo withdraws the menu's")
    }

    @Test func undoesALinkThroughTheUndoManager() async throws {
        let store = try root.open()
        let a = try await tune("A", in: store)
        let b = try await tune("B", in: store)
        let views = [try await view("unfiled", in: store), try await view("on-a", tuneID: a, in: store)]
        let bulk = RecordingBulkActions(store: store)
        let undoManager = UndoManager()
        bulk.undoManager = undoManager
        #expect(await bulk.link(views, to: b, tuneTitle: "B"))

        undoManager.undo()

        try await eventually { try await tuneID(of: "on-a", in: store) == a }
        #expect(try await tuneID(of: "unfiled", in: store) == nil)
        #expect(bulk.undoBannerItem == nil)
    }

    @Test func asksBeforeDeletingAndKeepsARecordingStillSplitting() async throws {
        let store = try root.open()
        let a = try await tune("A", in: store)
        try await store.write { writer in
            try writer.put(
                Recording(id: "parent", tuneID: a, source: "microphone", state: "ready", trimEndMs: 180_000), at: noon)
            try RecordingFile(id: "parent", localState: .uploaded, localDurationMs: 180_000).insert(writer.db)
        }
        _ = try await Commands(store: store).splitRecording("parent", cutsMs: [60_000])
        let parent = try #require(try await store.read { db in try Recording.fetchOne(db, key: "parent") })
        let views = [
            try await view("unfiled", state: "pending_upload", file: .captured, in: store),
            try await view("on-a", tuneID: a, in: store),
            RecordingView(recording: parent, file: nil, tuneID: a, tuneTitle: nil, holdsSplitAudio: true),
        ]
        let bulk = RecordingBulkActions(store: store, analytics: sink.client)

        let question = try #require(await bulk.deleteQuestion(views))
        #expect(question.title == RecordingsListText.deleteTitle(3))
        #expect(question.message == RecordingsListText.deleteMessage(deleting: 2, notUploaded: true, held: 1))
        #expect(question.held == ["parent"])

        #expect(await bulk.delete(question))

        let live = try await store.read { db in
            try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchAll(db).map(\.id)
        }
        #expect(live.contains("parent"))
        #expect(live.contains("unfiled") == false && live.contains("on-a") == false)
        #expect(sink.captures.map(\.name) == ["recording_deleted", "recording_deleted"])
        #expect(bulk.undoBannerItem == nil, "a delete has nothing to undo")
    }
}
