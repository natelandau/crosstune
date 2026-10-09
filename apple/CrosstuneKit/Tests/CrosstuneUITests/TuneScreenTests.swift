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
        for value in ["2024-3-4", "sometime in 2024", "2024-02-30", "2024-13-05", "2024-00-10"] {
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
        #expect(detail.searchProviders == SampleCatalog.searchProviders)
        #expect(detail.tunings == ["Violin: Standard (GDAE)"])
        #expect(
            detail.deleteMessage == "Delete \"Soldier's Joy\"? This removes its links, list entries, and 1 recording.")
    }

    @Test func showsAnUnknownTuneAsGone() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: "no_such_tune")
        try await eventually { model.phase == .gone }
    }

    @Test func reportsAReadThatFailed() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await store.write { writer in
            try writer.db.execute(sql: "ALTER TABLE tunes RENAME TO tunes_unreadable")
        }
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.readFailed }
        #expect(model.phase == .loading)
    }

    @Test func theNextTuneArrivesOnceReadOrFailed() {
        #expect(!TuneScreen.arrivalSettled(phase: .loading, readFailed: false))
        #expect(TuneScreen.arrivalSettled(phase: .loading, readFailed: true))
        #expect(TuneScreen.arrivalSettled(phase: .gone, readFailed: false))
    }

    @Test func writesTheArchive() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.setArchived(true)
        try await eventually { model.shown?.isArchived == true }
        await model.setArchived(false)
        try await eventually { model.shown?.isArchived == false }
        #expect(model.failure == nil)
    }

    @Test func removesALinkAndAListEntry() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.removeLink("sample_link_youtube")
        try await eventually { model.shown?.links.map(\.id) == ["sample_link_spotify"] }
        await model.removeFromList(itemID: "sample_item_session_0", listID: SampleCatalog.lists[0].id)
        try await eventually { model.shown?.lists.isEmpty == true }
    }

    @Test func pinsALinkAndAnotherRowTakesThePinOverThenClearsIt() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.makeStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.setPlaySource(.link(id: "sample_link_spotify"), pinned: false)
        try await eventually { model.shown?.userTune.playLinkID == "sample_link_spotify" }
        let recordingID = try #require(model.shown?.recordings.first?.id)
        await model.setPlaySource(.recording(id: recordingID), pinned: false)
        try await eventually { model.shown?.userTune.playRecordingID == recordingID }
        #expect(model.shown?.userTune.playLinkID == nil)
        await model.setPlaySource(.recording(id: recordingID), pinned: true)
        try await eventually { model.shown?.userTune.playRecordingID == nil }
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
        await model.removeFromList(itemID: "sample_item_session_0", listID: SampleCatalog.lists[0].id)
        let failure = try #require(model.failure(at: .lists))
        #expect(!failure.isEmpty)
        #expect(model.failure(at: .screen) == nil && model.failure(at: .media) == nil)
        #expect(model.shown?.lists.count == 1)
        // The next write clears it.
        await model.removeLink("sample_link_youtube")
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
        Recording(id: "r1", createdAt: noon, tuneID: tuneID, source: "microphone", addedAt: noon, label: label)
    }

    @Test func namesAnUnlabeledRecordingForItsTuneEvenUnderTheTunesOwnHeading() {
        let row = recording(label: nil)
        let item = PlayerItem.recording(row, tuneTitle: "Soldier's Joy")
        #expect(
            item
                == PlayerItem(
                    kind: .recording, id: "r1", title: "Soldier's Joy", tuneTitle: "Soldier's Joy", recording: row))
    }

    @Test func prefersTheLabelThenFallsBackToTheDate() {
        #expect(
            PlayerItem.recording(recording(label: "Jam at Mike's"), tuneTitle: "Soldier's Joy").title == "Jam at Mike's"
        )
        let locale = Locale(identifier: "en_US")
        let untitled = PlayerItem.recording(recording(label: nil), tuneTitle: nil, locale: locale, timeZone: .gmt)
        // No recorded date, so the title falls back to the day it was added.
        #expect(untitled.title == "Recording, Sep 25, 2026")
    }
}

@Suite struct TunePageTests {
    private func detail(_ tune: Tune) -> TuneDetail {
        TuneDetail(tune: tune, userTune: SampleCatalog.entries[0].userTune)
    }

    @Test func facetLineJoinsWhatTheTuneHolds() {
        var tune = SampleCatalog.entries[0].tune
        tune.key = "A"
        tune.modes = ["modal"]
        tune.tuneType = "Breakdown"
        tune.genre = nil
        // The key shows as its pill before the line, so the line starts at the mode.
        #expect(TunePage.facetLine(detail(tune)) == "modal · Breakdown · 2/4 · AABB")

        let sparse = Tune(id: "sparse", createdAt: SampleCatalog.now, title: "Sparse", tuneType: "Reel")
        #expect(TunePage.facetLine(detail(sparse)) == "Reel")
    }

    @Test func facetLineKeepsGenreAndCrookedBesideTheirNeighbors() {
        var tune = SampleCatalog.entries[0].tune
        tune.isCrooked = true
        #expect(TunePage.facetLine(detail(tune)) == "major · Reel · Old-time · 2/4 · Crooked · AABB")
    }

    @Test func aBareTuneShowsRecordingsScansAndNotesButNotLyricsOrLists() {
        let bare = Tune(id: "bare", createdAt: SampleCatalog.now, title: "Bare", tuneType: "Reel")
        #expect(TunePageColumn.sections(detail(bare)) == [.recordings, .scans, .notes])
    }

    @Test func lyricsAndListsShowOnceTheTuneHasThem() {
        let entry = SampleCatalog.entries[0]
        var tune = entry.tune
        tune.lyrics = "My old hen"
        let full = TuneDetail(
            tune: tune, userTune: entry.userTune,
            lists: [TuneMembership(list: SampleCatalog.lists[0], itemID: "item_0")])
        #expect(TunePageColumn.sections(full) == [.recordings, .scans, .lyrics, .notes, .lists])
    }

    @Test func emptySectionsSayWhatIsMissingInTheWebClientsWords() {
        #expect(TuneScreen.noMediaTitle == "No recordings yet")
        #expect(TuneScreen.noMediaHint == "Record one, paste a link, or find one on a music service.")
        #expect(TuneScreen.noNotesTitle == "No notes yet")
        #expect(TuneScreen.addNotes == "Add notes")
        #expect(TuneScreen.editNotes == "Edit notes")
    }
}
