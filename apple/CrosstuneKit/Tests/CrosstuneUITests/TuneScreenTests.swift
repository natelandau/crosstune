import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

private func file(_ state: LocalFileState) -> RecordingFile {
    RecordingFile(id: UUID().uuidString, localState: state, updatedAt: noon)
}

@Suite struct DeleteTuneMessageTests {
    @Test func namesOnlyLinksAndListEntriesWhenThereAreNoRecordings() {
        #expect(
            DeleteTuneMessage.one(title: "Cluck Old Hen", files: [])
                == "Delete \"Cluck Old Hen\"? This removes its links and list entries.")
    }

    @Test func countsASingleRecordingInTheSingular() {
        #expect(
            DeleteTuneMessage.one(title: "Cluck Old Hen", files: [file(.uploaded)])
                == "Delete \"Cluck Old Hen\"? This removes its links, list entries, and 1 recording.")
    }

    @Test func countsSeveralRecordingsInThePlural() {
        #expect(
            DeleteTuneMessage.one(title: "Cluck Old Hen", files: [file(.uploaded), nil])
                == "Delete \"Cluck Old Hen\"? This removes its links, list entries, and 2 recordings.")
    }

    @Test func warnsWhenAnyRecordingHasNotUploaded() {
        #expect(
            DeleteTuneMessage.one(title: "Cluck Old Hen", files: [file(.downloaded), file(.failedUpload)])
                == "Delete \"Cluck Old Hen\"? This removes its links, list entries, and 2 recordings. "
                + "Some recordings have not uploaded, so they cannot be recovered.")
    }

    @Test func speaksOfASelectionRatherThanOneTune() {
        #expect(
            DeleteTuneMessage.many(subject: "12 tunes", files: [])
                == "Delete 12 tunes? This removes their links and list entries.")
        #expect(
            DeleteTuneMessage.many(subject: "2 tunes", files: [file(.uploaded), file(.captured)])
                == "Delete 2 tunes? This removes their links, list entries, and 2 recordings. "
                + "Some recordings have not uploaded, so they cannot be recovered.")
    }
}

@Suite struct TuneDetailTests {
    private func detail(
        _ tune: Tune, status: String = "known", learnedFrom: String? = nil, learnedOn: String? = nil,
        notes: String? = nil, archived: Bool = false, instruments: Set<String> = []
    ) -> TuneDetail {
        TuneDetail(
            tune: tune,
            userTune: UserTune(
                createdAt: noon, tuneID: tune.id, status: status, learnedFrom: learnedFrom, learnedOn: learnedOn,
                notes: notes, archivedAt: archived ? noon : nil),
            instruments: instruments)
    }

    private func tunings(_ entries: [String: (String?, Int64?)]) -> JSONObject {
        entries.mapValues { tuning, capo in
            var entry: JSONObject = [:]
            if let tuning { entry["tuning"] = .string(tuning) }
            if let capo { entry["capo"] = .integer(capo) }
            return .object(entry)
        }
    }

    @Test func putsTheKeyFirstThenEveryFacetTheTuneHoldsInTheWebsOrder() {
        let tune = Tune(
            createdAt: noon, title: "Kitchen Girl", genre: "Old-time", tuneType: "Reel", key: " A ",
            modes: ["mixolydian", "dorian"], timeSignature: "2/4", partStructure: "AABB", isCrooked: true,
            tunings: tunings(["violin": ("Cross A (AEAE)", nil)]))
        #expect(
            detail(tune, archived: true).facets == [
                .key("A"), .text("mixolydian"), .text("dorian"), .text("Violin: Cross A (AEAE)"), .text("2/4"),
                .text(TuneDetail.crooked), .text("Reel"), .text("Old-time"), .text("AABB"), .archived,
            ])
    }

    @Test func leavesOutEveryUnsetFacet() {
        let tune = Tune(createdAt: noon, title: "A tune with no key yet", genre: "", key: "  ")
        #expect(detail(tune).facets == [])
    }

    @Test func showsEveryTuningStandardIncludedAndAlwaysNamesTheInstrument() {
        let tune = Tune(
            createdAt: noon, title: "Cluck Old Hen",
            tunings: tunings([
                "violin": ("Standard (GDAE)", nil), "five_string_banjo": ("Sawmill (gDGCD)", 2), "guitar": (nil, 3),
            ]))
        // Guitar is not played, but a value it holds always shows so it never becomes unreachable.
        #expect(
            detail(tune, instruments: ["violin"]).tunings == [
                "Violin: Standard (GDAE)", "5-string banjo: Sawmill (gDGCD), capo 2", "Guitar: Capo 3",
            ])
    }

    @Test func showsNoTuningForAPlayedInstrumentTheTuneHoldsNothingFor() {
        let tune = Tune(createdAt: noon, title: "Tam Lin")
        #expect(detail(tune, instruments: ["violin", "mandolin"]).tunings == [])
    }

    @Test func saysWhereAndWhenTheTuneWasLearned() {
        let tune = Tune(createdAt: noon, title: "Soldier's Joy")
        let locale = Locale(identifier: "en_US")
        #expect(
            detail(tune, learnedFrom: "Tommy Jarrell", learnedOn: "2024-03-04").learned(locale: locale)
                == "Learned from Tommy Jarrell on Mar 4, 2024")
        #expect(detail(tune, learnedFrom: "Tommy Jarrell").learned(locale: locale) == "Learned from Tommy Jarrell")
        #expect(detail(tune, learnedOn: "2024-12-31").learned(locale: locale) == "Learned on Dec 31, 2024")
        #expect(detail(tune).learned(locale: locale) == nil)
    }

    @Test func treatsAnEmptyLearnedFieldOrNoteAsUnset() {
        let tune = Tune(createdAt: noon, title: "Soldier's Joy")
        let locale = Locale(identifier: "en_US")
        #expect(detail(tune, learnedFrom: "", learnedOn: " ").learned(locale: locale) == nil)
        #expect(
            detail(tune, learnedFrom: "", learnedOn: "2024-03-04").learned(locale: locale) == "Learned on Mar 4, 2024")
        #expect(
            detail(tune, learnedFrom: "Tommy Jarrell", learnedOn: "").learned(locale: locale)
                == "Learned from Tommy Jarrell")
        #expect(detail(tune, notes: " \n ").notes == nil)
        #expect(detail(tune, notes: "Drive the B part").notes == "Drive the B part")
    }

    @Test func showsALearnedOnValueItCannotReadAsStored() {
        let locale = Locale(identifier: "en_US")
        for value in ["2024-3-4", "sometime in 2024", "2024-02-30"] {
            #expect(TuneDetail.learnedOn(value, locale: locale) == value)
        }
    }

    @Test func offersLyricsOnlyWhenTheyHoldWords() {
        #expect(!detail(Tune(createdAt: noon, title: "a")).hasLyrics)
        #expect(!detail(Tune(createdAt: noon, title: "a", lyrics: " \n\t ")).hasLyrics)
        #expect(detail(Tune(createdAt: noon, title: "a", lyrics: "\nGrasshopper sitting")).hasLyrics)
    }

    @Test func joinsTheAlternateTitles() {
        #expect(detail(Tune(createdAt: noon, title: "a")).alternateTitles == nil)
        #expect(
            detail(Tune(createdAt: noon, title: "a", alternateTitles: ["Love Somebody", "Soldier's Joy Reel"]))
                .alternateTitles == "Love Somebody, Soldier's Joy Reel")
    }
}

@MainActor
@Suite struct TuneModelTests {
    /// Waits for the model's live query to catch up with the store.
    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    private let soldiersJoy = SampleCatalog.entries[0]

    @Test func readsTheTuneWithItsMediaListsAndInstruments() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        #expect(model.phase == .loading)
        try await eventually { model.shown != nil }
        let detail = try #require(model.shown)
        #expect(detail.tune.title == "Soldier's Joy")
        #expect(detail.links.map(\.id) == ["sample_link_youtube", "sample_link_spotify"])
        #expect(detail.recordings.map(\.id) == ["sample_recording_ready_here"])
        #expect(detail.recordings.first?.file?.localState == .downloaded)
        #expect(detail.lists.map(\.list.name) == ["Tuesday session"])
        #expect(detail.lists.first?.itemID == "sample_item_session_0")
        #expect(detail.instruments == SampleCatalog.instruments)
        #expect(detail.tunings == ["Violin: Standard (GDAE)"])
        #expect(
            detail.deleteMessage == "Delete \"Soldier's Joy\"? This removes its links, list entries, and 1 recording.")
    }

    @Test func showsAnUnknownTuneAsGone() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: "no_such_tune")
        try await eventually { model.phase == .gone }
    }

    @Test func writesTheStatusAndArchive() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.setStatus("learning")
        try await eventually { model.shown?.userTune.status == "learning" }
        await model.setArchived(true)
        try await eventually { model.shown?.isArchived == true }
        #expect(model.shown?.facets.last == .archived)
        await model.setArchived(false)
        try await eventually { model.shown?.isArchived == false }
        #expect(model.failure == nil)
    }

    @Test func writesNothingWhenTheChosenStatusIsPressedAgain() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await store.write { writer in _ = try OutboxEntry.deleteAll(writer.db) }
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.setStatus("known")
        #expect(try await store.read { db in try OutboxEntry.fetchCount(db) } == 0)
        await model.setStatus("learning")
        #expect(try await store.read { db in try OutboxEntry.fetchCount(db) } == 1)
    }

    @Test func removesALinkAndAListEntry() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.removeLink("sample_link_youtube")
        try await eventually { model.shown?.links.map(\.id) == ["sample_link_spotify"] }
        await model.removeFromList(itemID: "sample_item_session_0")
        try await eventually { model.shown?.lists.isEmpty == true }
    }

    @Test func reportsAFailedWriteBesideTheControlThatMadeIt() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await store.write { writer in
            try writer.db.execute(
                sql: "CREATE TRIGGER refuse BEFORE UPDATE ON list_items BEGIN SELECT RAISE(ABORT, 'refused'); END")
        }
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.removeFromList(itemID: "sample_item_session_0")
        let failure = try #require(model.failure(at: .lists))
        #expect(!failure.isEmpty)
        #expect(model.failure(at: .screen) == nil && model.failure(at: .media) == nil)
        #expect(model.shown?.lists.count == 1)
        // Pressing the status already held writes nothing but still clears it.
        await model.setStatus("known")
        #expect(model.failure == nil)
    }

    @Test func deletesTheTuneAndHoldsItsTitleWhileLeaving() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        #expect(await model.delete())
        // The tune is gone from the store, but the screen keeps its title on the way out.
        try await eventually { model.phase == .deleting(title: "Soldier's Joy") }
        let tune = try await store.read { db in try Tune.fetchOne(db, key: soldiersJoy.tune.id) }
        #expect(tune?.deletedAt != nil)
        #expect(await model.delete() == false)
    }
}

@Suite struct PlayerItemTests {
    private let tuneID = "t1"

    private func recording(label: String?) -> Recording {
        Recording(id: "r1", createdAt: noon, tuneID: tuneID, source: "microphone", recordedAt: noon, label: label)
    }

    @Test func namesAnUnlabeledRecordingForItsTuneEvenUnderTheTunesOwnHeading() {
        let item = PlayerItem.recording(recording(label: nil), tuneTitle: "Soldier's Joy")
        #expect(item == PlayerItem(kind: .recording, id: "r1", title: "Soldier's Joy", tuneTitle: "Soldier's Joy"))
    }

    @Test func prefersTheLabelThenFallsBackToTheDate() {
        #expect(
            PlayerItem.recording(recording(label: "Jam at Mike's"), tuneTitle: "Soldier's Joy").title == "Jam at Mike's"
        )
        let locale = Locale(identifier: "en_US")
        let untitled = PlayerItem.recording(recording(label: nil), tuneTitle: nil, locale: locale, timeZone: .gmt)
        #expect(untitled.title == "Recording, \(RecordingText.recordedAt(noon, locale: locale, timeZone: .gmt))")
    }
}
