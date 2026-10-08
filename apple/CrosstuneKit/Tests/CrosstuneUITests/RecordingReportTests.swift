import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// Filing, unfiling, renaming, and deleting a recording report its origin and ID once the write
/// lands, never its name. A link saved as a recording from the archive is an archive save, not
/// an import.
@MainActor
@Suite struct RecordingReportTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func recording(
        _ id: String, tuneID: String? = nil, source: String = "microphone", origin: String = "own"
    ) -> Recording {
        Recording(id: id, tuneID: tuneID, source: source, origin: origin, addedAt: noon, state: "ready")
    }

    private func put(_ recording: Recording, in store: CrosstuneStore) async throws {
        try await store.write { writer in try writer.put(recording, at: noon) }
    }

    private func tune(_ title: String, in store: CrosstuneStore) async throws -> String {
        try await Commands(store: store).createTune(
            TuneInput(title: title), userTune: UserTuneInput(status: "known"), at: noon
        ).tuneID
    }

    @Test func originReadsSlipperyHillBeforeTheSource() {
        #expect(RecordingOrigin(recording("r", source: "import", origin: "slippery_hill")) == .slipperyHill)
        #expect(RecordingOrigin(recording("r", source: "microphone", origin: "slippery_hill")) == .slipperyHill)
        #expect(RecordingOrigin(recording("r", source: "microphone")) == .recorded)
        #expect(RecordingOrigin(recording("r", source: "upload")) == .imported)
        #expect(RecordingOrigin(recording("r", source: "import")) == .imported)
    }

    @Test func filingAnUnfiledRecordingReportsFromUnfiled() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        try await put(recording("r1"), in: store)
        let model = AddToTuneModel(store: store, recordingID: "r1", analytics: sink.client)
        #expect(try await poll { model.results != nil })
        model.query = "kitchen"
        let entry = try #require(model.results?.rows.first)

        #expect(await model.pick(entry))

        #expect(
            sink.captures == [
                .init(
                    name: "recording_filed",
                    properties: [
                        "from": .string("unfiled"), "origin": .string("recorded"), "recording_id": .string("r1"),
                        "tune_id": .string(tuneID),
                    ])
            ])
    }

    @Test func movingARecordingReportsFromOtherTune() async throws {
        let store = try root.open()
        let first = try await tune("Kitchen Girl", in: store)
        let second = try await tune("Soldier's Joy", in: store)
        try await put(recording("r1", tuneID: first, source: "upload"), in: store)
        let model = AddToTuneModel(store: store, recordingID: "r1", analytics: sink.client)
        #expect(try await poll { model.results != nil })
        model.query = "soldier"
        let entry = try #require(model.results?.rows.first)

        #expect(await model.pick(entry))

        #expect(
            sink.captures == [
                .init(
                    name: "recording_filed",
                    properties: [
                        "from": .string("other_tune"), "origin": .string("imported"),
                        "recording_id": .string("r1"), "tune_id": .string(second),
                    ])
            ])
    }

    @Test func aRefusedFilingReportsNothing() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        let model = AddToTuneModel(store: store, recordingID: "missing", analytics: sink.client)
        #expect(try await poll { model.results != nil })
        model.query = "kitchen"
        let entry = try #require(model.results?.rows.first)
        #expect(entry.tune.id == tuneID)

        #expect(!(await model.pick(entry)))

        #expect(sink.calls.isEmpty)
    }

    @Test func filingFromTheRecordingsScreenReportsWhereItWas() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        try await put(recording("r1"), in: store)
        let model = RecordingsModel(store: store, analytics: sink.client)
        #expect(try await poll { model.view("r1") != nil })

        await model.file("r1", under: tuneID, failure: URLError(.badURL))

        #expect(sink.captures.map(\.name) == ["recording_filed"])
        #expect(sink.captures.first?.properties["from"] == .string("unfiled"))
    }

    @Test func unfilingAndDeletingReportTheRecordingsOrigin() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        try await put(recording("r1", tuneID: tuneID, source: "import", origin: "slippery_hill"), in: store)
        try await put(recording("r2", tuneID: tuneID), in: store)
        let model = RecordingsModel(store: store, analytics: sink.client)
        #expect(try await poll { model.view("r1") != nil && model.view("r2") != nil })

        await model.removeFromTune("r1")
        await model.delete("r2")

        #expect(
            sink.captures == [
                .init(
                    name: "recording_unfiled",
                    properties: ["origin": .string("slippery_hill"), "recording_id": .string("r1")]),
                .init(
                    name: "recording_deleted",
                    properties: ["origin": .string("recorded"), "recording_id": .string("r2")]),
            ])
    }

    @Test func aRefusedDeleteReportsNothing() async throws {
        let store = try root.open()
        try await put(recording("r1"), in: store)
        let model = RecordingsModel(store: store, analytics: sink.client)
        #expect(try await poll { model.view("r1") != nil })
        try store.close()

        await model.delete("r1")

        #expect(model.failure != nil)
        #expect(sink.calls.isEmpty)
    }

    @Test func renamingReportsOnlyAChangedName() async throws {
        let store = try root.open()
        let stored = recording("r1")
        try await put(stored, in: store)
        let rename = EditRecordingModel(store: store, recording: stored, analytics: sink.client)
        rename.setName("  Take 2  ")
        #expect(await rename.save())

        let dateOnly = EditRecordingModel(store: store, recording: stored, analytics: sink.client)
        dateOnly.setYear("1998")
        #expect(await dateOnly.save())

        #expect(
            sink.captures == [
                .init(
                    name: "recording_renamed",
                    properties: ["origin": .string("recorded"), "recording_id": .string("r1")])
            ])
    }

    private func loadedTune(_ id: String, in store: CrosstuneStore) async throws -> TuneModel {
        let model = TuneModel(store: store, tuneID: id, analytics: sink.client)
        #expect(try await poll { model.shown != nil })
        return model
    }

    @Test func theTunePageReportsUnfilingAndDeletingARecording() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        let first = recording("r1", tuneID: tuneID)
        let second = recording("r2", tuneID: tuneID, source: "upload")
        try await put(first, in: store)
        try await put(second, in: store)
        let model = try await loadedTune(tuneID, in: store)

        await model.unfileRecording(first)
        await model.deleteRecording(second)

        #expect(
            sink.captures == [
                .init(
                    name: "recording_unfiled",
                    properties: ["origin": .string("recorded"), "recording_id": .string("r1")]),
                .init(
                    name: "recording_deleted",
                    properties: ["origin": .string("imported"), "recording_id": .string("r2")]),
            ])
    }

    @Test func addToRecordingsReportsAnArchiveSaveNotAnImport() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        let linkID = try await Commands(store: store).addLink(
            tuneID: tuneID,
            link: LinkInput(
                url: "https://www.slippery-hill.com/recording/kitchen-girl", provider: "slippery_hill",
                providerRef: "kitchen-girl"))
        let model = try await loadedTune(tuneID, in: store)

        await model.addRecordingFromLink(linkID)

        let saved = try #require(
            try await store.read { db in try Recording.filter(Recording.CodingKeys.tuneID == tuneID).fetchOne(db) })
        #expect(
            sink.captures == [
                .init(
                    name: "archive_recording_saved",
                    properties: [
                        "source_archive": .string("slippery_hill"), "recording_id": .string(saved.id),
                        "tune_id": .string(tuneID),
                    ])
            ])
    }

    @Test func removingALinkReportsItsService() async throws {
        let store = try root.open()
        let tuneID = try await tune("Kitchen Girl", in: store)
        let linkID = try await Commands(store: store).addLink(
            tuneID: tuneID, link: LinkInput(url: "https://open.spotify.com/track/abc", provider: "spotify"))
        let model = try await loadedTune(tuneID, in: store)

        await model.removeLink(linkID)

        #expect(
            sink.captures == [
                .init(
                    name: "link_removed", properties: ["service": .string("spotify"), "link_id": .string(linkID)])
            ])
    }

    @Test func openingALinkInItsProviderReportsTheService() async throws {
        let link = RecordingLink(
            id: "l1", tuneID: "t1", url: "https://tidal.com/track/1", provider: "tidal")
        let unknown = RecordingLink(id: "l2", tuneID: "t1", url: "https://example.com", provider: "newservice")

        sink.client.linkOpened(link)
        sink.client.linkOpened(unknown)

        #expect(
            sink.captures == [
                .init(
                    name: "link_opened_externally",
                    properties: ["service": .string("tidal"), "link_id": .string("l1")]),
                .init(
                    name: "link_opened_externally",
                    properties: ["service": .string("other"), "link_id": .string("l2")]),
            ])
    }

    @Test(arguments: [
        (AppleMusicAccessState.fullTracks, true), (.noSubscription, true), (.declined, false),
    ])
    func appleMusicReportsTheAnswerToItsPrompt(state: AppleMusicAccessState, granted: Bool) {
        sink.client.appleMusicAnswered(state)

        #expect(sink.captures == [.init(name: "apple_music_authorized", properties: ["granted": .bool(granted)])])
    }

    @Test func appleMusicReportsNothingForAPromptStillUnanswered() {
        sink.client.appleMusicAnswered(.notAsked)

        #expect(sink.calls.isEmpty)
    }

    @Test(arguments: [
        (CocoaError(.fileWriteOutOfSpace) as any Error, FailureReason.storageFull),
        (POSIXError(.ENOSPC) as any Error, .storageFull),
        (URLError(.notConnectedToInternet) as any Error, .network),
        (CocoaError(.fileReadNoSuchFile) as any Error, .other),
    ])
    func anErrorReportsOnlyItsKind(error: any Error, reason: FailureReason) {
        #expect(FailureReason(error) == reason)
    }
}
