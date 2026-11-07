import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// Each row of a recording's page edits its own field: an editor saves on every dismissal but
/// Escape, and each save is one write that reports the change once it lands.
@MainActor
@Suite struct RecordingEditorsTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func recording(_ id: String = "r1", tuneID: String? = nil, label: String? = nil) -> Recording {
        Recording(id: id, tuneID: tuneID, source: "microphone", addedAt: noon, label: label, state: "ready")
    }

    private func put(_ recording: Recording, in store: CrosstuneStore) async throws {
        try await store.write { writer in try writer.put(recording, at: noon) }
    }

    private func stored(_ id: String = "r1", in store: CrosstuneStore) async throws -> Recording? {
        try await store.read { db in try Recording.fetchOne(db, key: id) }
    }

    private func tune(_ title: String, in store: CrosstuneStore) async throws -> String {
        try await Commands(store: store).createTune(
            TuneInput(title: title), userTune: UserTuneInput(status: "known"), at: noon
        ).tuneID
    }

    private func rows(_ recording: Recording, tuneTitle: String? = nil) -> ScreenRows {
        ScreenRows(
            recording: recording, file: nil, tuneID: recording.tuneID, tuneTitle: tuneTitle, partStructure: nil,
            shownPlace: nil)
    }

    @Test func renameSavesOnDismissal() async throws {
        let store = try root.open()
        let opened = recording(label: "Take 1")
        try await put(opened, in: store)
        let model = RecordingAttributeModel(store: store, recordingID: "r1", analytics: sink.client)

        var session = RecordingEdit.name(opened)
        session.draft = "  Take 2  "
        var committed: [String] = []
        session.end(.dismissed) { committed.append($0) }
        #expect(committed == ["Take 2"])
        for name in committed { await model.rename(name) }

        #expect(try await stored(in: store)?.label == "Take 2")
        #expect(
            sink.captures == [
                .init(
                    name: "recording_renamed",
                    properties: ["origin": .string("recorded"), "recording_id": .string("r1")])
            ])
    }

    @Test func escapeWritesNothing() async throws {
        let store = try root.open()
        let opened = recording(label: "Take 1")
        try await put(opened, in: store)
        let model = RecordingAttributeModel(store: store, recordingID: "r1", analytics: sink.client)

        var session = RecordingEdit.name(opened)
        session.draft = "Take 2"
        var committed: [String] = []
        session.end(.escaped) { committed.append($0) }
        session.end(.leaving(stillPresented: false, asSheet: true)) { committed.append($0) }
        #expect(committed.isEmpty)

        // A save of the name it already has writes nothing and reports nothing.
        await model.rename("Take 1")
        #expect(try await stored(in: store)?.label == "Take 1")
        #expect(sink.calls.isEmpty)
    }

    @Test func filesAndUnfilesFromTheTuneRow() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        let opened = recording()
        try await put(opened, in: store)
        let model = RecordingAttributeModel(store: store, recordingID: "r1", analytics: sink.client)

        var filing = RecordingEdit.tune(rows(opened))
        var picked: [String?] = []
        filing.end(.picked, picked: tuneID) { picked.append($0) }
        #expect(picked == [tuneID])
        await model.file(tuneID)
        #expect(try await stored(in: store)?.tuneID == tuneID)

        await model.file(nil)
        #expect(try await stored(in: store)?.tuneID == nil)

        #expect(
            sink.captures == [
                .init(
                    name: "recording_filed",
                    properties: [
                        "from": .string("unfiled"), "origin": .string("recorded"), "recording_id": .string("r1"),
                        "tune_id": .string(tuneID),
                    ]),
                .init(
                    name: "recording_unfiled",
                    properties: ["origin": .string("recorded"), "recording_id": .string("r1")]),
            ])
    }

    @Test func aPartialDateKeepsItsPrecision() async throws {
        let store = try root.open()
        let opened = recording()
        try await put(opened, in: store)
        let model = RecordingAttributeModel(store: store, recordingID: "r1", analytics: sink.client)

        var session = RecordingEdit.recorded(opened)
        session.draft.setYear("1998")
        session.draft.setMonth(6)
        var committed: [RecordingDateDraft] = []
        session.end(.done) { committed.append($0) }
        let draft = try #require(committed.first)
        await model.setRecorded(year: draft.year, month: draft.month, day: draft.day)

        let saved = try #require(try await stored(in: store))
        #expect(saved.recordedPrecision == RecordingPrecision.month.rawValue)
        #expect(saved.recordedAt == Timestamp(iso: "1998-06-01T00:00:00.000Z"))
        #expect(model.failure == nil)
        #expect(sink.calls.isEmpty)
    }

    @Test func anEditAfterTheRecordingIsDeletedWritesNothing() async throws {
        let store = try root.open()
        let opened = recording(label: "Take 1")
        try await put(opened, in: store)
        let model = RecordingAttributeModel(store: store, recordingID: "r1", analytics: sink.client)
        let edit = RecordingLocationEdit(store: store, recording: opened, analytics: sink.client)
        let searches = FakePlaceSearches()
        let editor = LocationEditorModel(
            edit: edit, search: { searches.make(near: $0) }, analytics: sink.client, openMaps: { _, _ in })
        let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.66, lon: -80.92))
        #expect(editor.pickRecent(galax))

        try await store.write { writer in try writer.deleteRecording("r1", at: noon) }

        await model.rename("Take 2")
        await model.setPlayers("Ada")
        #expect(model.failure == nil)
        #expect(await editor.leave() == nil)
        #expect(edit.failure == nil)

        let gone = try #require(try await stored(in: store))
        #expect(gone.label == "Take 1")
        #expect(gone.players == nil)
        #expect(gone.placeName == nil)
        #expect(gone.placeLat == nil)
        #expect(sink.calls.isEmpty)
    }

    @Test func addedIsReadOnly() {
        let shown = RecordingPageRows.rows(rows(recording(label: "Take 1")))
        #expect(shown.filter(\.isReadOnly).map(\.id) == [.added])
        #expect(shown.map(\.id) == [.name, .players, .recorded, .added, .tune, .location, .notes])
    }

    @Test func anEmptyRowReadsNotSet() throws {
        let shown = RecordingPageRows.rows(rows(recording()))
        let players = try #require(shown.first { $0.id == .players })
        #expect(players.text == nil)
        #expect(players.value(emptyText: RecordingPageCopy.notSet) == "Not set")
    }
}
