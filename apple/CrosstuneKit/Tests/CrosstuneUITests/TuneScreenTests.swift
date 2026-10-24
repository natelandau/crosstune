import CrosstuneAnalytics
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
            DeleteTuneMessage.one(files: [])
                == "This removes its links and list entries.")
    }

    @Test func countsASingleRecordingInTheSingular() {
        #expect(
            DeleteTuneMessage.one(files: [file(.uploaded)])
                == "This removes its links, list entries, and 1 recording.")
    }

    @Test func countsSeveralRecordingsInThePlural() {
        #expect(
            DeleteTuneMessage.one(files: [file(.uploaded), nil])
                == "This removes its links, list entries, and 2 recordings.")
    }

    @Test func warnsWhenAnyRecordingHasNotUploaded() {
        #expect(
            DeleteTuneMessage.one(files: [file(.downloaded), file(.failedUpload)])
                == "This removes its links, list entries, and 2 recordings. "
                + "Some recordings have not uploaded, so they cannot be recovered.")
    }

    @Test func titleNamesTheTuneAsStored() {
        #expect(DeleteTuneMessage.title(for: "Soldier's Joy") == "Delete \"Soldier's Joy\"?")
    }

    @Test func speaksOfASelectionRatherThanOneTune() {
        #expect(
            DeleteTuneMessage.many(files: [])
                == "This removes their links and list entries.")
        #expect(
            DeleteTuneMessage.many(files: [file(.uploaded), file(.captured)])
                == "This removes their links, list entries, and 2 recordings. "
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
        let model = TuneModel(store: try await SampleCatalog.copiedStore(root: root.url), tuneID: soldiersJoy.tune.id)
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
        #expect(detail.deleteTitle == "Delete \"Soldier's Joy\"?")
        #expect(detail.deleteMessage == "This removes its links, list entries, and 1 recording.")
    }

    @Test func readsWhatPlaysFirstFromTheSettings() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown?.playFirst == UserSettings.playFirstRecordings }
        try await Commands(store: store).setPlayFirst(
            clerkUserID: store.userID, playFirst: UserSettings.playFirstAppleMusic)
        try await eventually { model.shown?.playFirst == UserSettings.playFirstAppleMusic }
    }

    @Test func showsAnUnknownTuneAsGone() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.copiedStore(root: root.url), tuneID: "no_such_tune")
        try await eventually { model.phase == .gone }
    }

    @Test func reportsAReadThatFailed() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.copiedStore(root: root.url)
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
        let model = TuneModel(store: try await SampleCatalog.copiedStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.setArchived(true)
        try await eventually { model.shown?.isArchived == true }
        await model.setArchived(false)
        try await eventually { model.shown?.isArchived == false }
        #expect(model.failure == nil)
    }

    @Test func removesALinkAndAListEntry() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.copiedStore(root: root.url), tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        await model.removeLink("sample_link_youtube")
        try await eventually { model.shown?.links.map(\.id) == ["sample_link_spotify"] }
        await model.removeFromList(itemID: "sample_item_session_0", listID: SampleCatalog.lists[0].id)
        try await eventually { model.shown?.lists.isEmpty == true }
    }

    @Test func pinsALinkAndAnotherRowTakesThePinOverThenClearsIt() async throws {
        let root = TemporaryRoot()
        let model = TuneModel(store: try await SampleCatalog.copiedStore(root: root.url), tuneID: soldiersJoy.tune.id)
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
        let store = try await SampleCatalog.copiedStore(root: root.url)
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
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.shown != nil }
        #expect(await model.delete())
        // The tune is gone from the store, but the screen keeps its title on the way out.
        try await eventually { model.phase == .deleting(title: "Soldier's Joy") }
        let tune = try await store.read { db in try Tune.fetchOne(db, key: soldiersJoy.tune.id) }
        #expect(tune?.deletedAt != nil)
        #expect(await model.delete() == false)
    }

    // MARK: - Single-fact writes

    private let sink = RecordingAnalyticsSink()

    /// A store holding `tunes`, each with the musician's own row, and a shown model for the first.
    private func factModel(
        _ tunes: [Tune], status: String = "want_to_learn", root: TemporaryRoot
    ) async throws -> (CrosstuneStore, TuneModel) {
        let store = try root.open()
        try await store.write { writer in
            for tune in tunes {
                try writer.put(tune, at: noon)
                try writer.put(UserTune(createdAt: noon, tuneID: tune.id, status: status), at: noon)
            }
        }
        let model = TuneModel(store: store, tuneID: tunes[0].id, analytics: sink.client)
        try await eventually { model.shown != nil }
        return (store, model)
    }

    private func storedTune(_ store: CrosstuneStore, _ tuneID: String) async throws -> Tune {
        try await store.read { db in try #require(try Tune.fetchOne(db, key: tuneID)) }
    }

    private func edited(_ fields: [String], _ tuneID: String = "t1") -> RecordingAnalyticsSink.Capture {
        .init(name: "tune_edited", properties: ["fields_changed": .strings(fields), "tune_id": .string(tuneID)])
    }

    @Test func writesKeyAndReportsOnlyKey() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel(
            [Tune(id: "t1", createdAt: noon, title: "Sally Ann", composer: "Trad", key: "A")], root: root)

        model.write { $0.key = "D" }

        try await eventually { !sink.captures.isEmpty }
        #expect(sink.captures == [edited(["key"])])
        let tune = try await storedTune(store, "t1")
        #expect(tune.key == "D" && tune.composer == "Trad")
        #expect(model.failure(at: .facts) == nil)
    }

    @Test func reportsStatusChange() async throws {
        let root = TemporaryRoot()
        let (_, model) = try await factModel(
            [Tune(id: "t1", createdAt: noon, title: "Sally Ann")], status: "learning", root: root)

        model.write { $0.status = "known" }

        try await eventually { sink.captures.count == 2 }
        #expect(
            sink.captures == [
                edited(["status"]),
                .init(
                    name: "tune_status_changed",
                    properties: ["from": .string("learning"), "to": .string("known"), "tune_id": .string("t1")]),
            ])
    }

    @Test func typeFillsUnsetTimeSignature() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.tuneType = "Jig" }

        try await eventually { !sink.captures.isEmpty }
        #expect(sink.captures == [edited(["tune_type", "time_signature"])])
        let tune = try await storedTune(store, "t1")
        #expect(tune.tuneType == "Jig" && tune.timeSignature == "6/8")
    }

    @Test func typeKeepsChosenTimeSignature() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel(
            [Tune(id: "t1", createdAt: noon, title: "Sally Ann", timeSignature: "2/4")], root: root)

        model.write { $0.tuneType = "Jig" }

        try await eventually { !sink.captures.isEmpty }
        #expect(sink.captures == [edited(["tune_type"])])
        let tune = try await storedTune(store, "t1")
        #expect(tune.tuneType == "Jig" && tune.timeSignature == "2/4")
    }

    @Test func trimsOpenText() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.composer = "  Jay Ungar \n" }

        try await eventually { !sink.captures.isEmpty }
        #expect(sink.captures == [edited(["composer"])])
        #expect(try await storedTune(store, "t1").composer == "Jay Ungar")
    }

    @Test func refusesEmptyTitle() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.title = "   " }

        try await eventually { model.failure(at: .facts) != nil }
        #expect(model.failure(at: .facts) == TuneFormModel.titleRequired)
        #expect(model.failure(at: .screen) == nil && model.failure(at: .media) == nil)
        #expect(try await storedTune(store, "t1").title == "Sally Ann")
        #expect(sink.captures.isEmpty)
    }

    @Test func refusesPartialLearnedOn() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.learnedOn = "2024-03" }

        try await eventually { model.failure(at: .facts) != nil }
        #expect(model.failure(at: .facts) == LearnedOnEditor.incomplete)
        let learnedOn = try await store.read { db in
            try UserTune.filter(UserTune.CodingKeys.tuneID == "t1").fetchOne(db)?.learnedOn
        }
        #expect(learnedOn == nil)
        // A whole date lands, and clears the refusal.
        model.write { $0.learnedOn = "2024-03-04" }
        try await eventually { model.shown?.userTune.learnedOn == "2024-03-04" }
        #expect(model.failure(at: .facts) == nil)
    }

    @Test func aTypePickFillsAnUnsetTimeSignature() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel(
            [Tune(id: "t1", createdAt: noon, title: "Sally Ann"), Tune(id: "t2", createdAt: noon, title: "Cooley's")],
            root: root)
        let detail = try #require(model.shown)

        model.write(FactEdit.tuneType(detail).patch("Jig"))

        try await eventually { model.shown?.tune.tuneType == "Jig" }
        #expect(try await storedTune(store, "t1").timeSignature == "6/8")
    }

    @Test func aTypePickKeepsATimeSignatureAlreadySet() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel(
            [Tune(id: "t1", createdAt: noon, title: "Sally Ann", timeSignature: "4/4")], root: root)
        let detail = try #require(model.shown)

        model.write(FactEdit.tuneType(detail).patch("Jig"))

        try await eventually { model.shown?.tune.tuneType == "Jig" }
        #expect(try await storedTune(store, "t1").timeSignature == "4/4")
    }

    @Test func refusesAWholeDateThatIsNotOnTheCalendar() async throws {
        let root = TemporaryRoot()
        let (_, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.learnedOn = "2024-02-30" }

        try await eventually { model.failure(at: .facts) != nil }
        #expect(model.failure(at: .facts) == LearnedOnEditor.incomplete)
        #expect(model.shown?.userTune.learnedOn == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func clearsLearnedOn() async throws {
        let root = TemporaryRoot()
        let (_, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)
        model.write { $0.learnedOn = "2024-03-04" }

        model.write { $0.learnedOn = "" }

        try await eventually { sink.captures.count == 2 }
        #expect(sink.captures == [edited(["learned_on"]), edited(["learned_on"])])
        try await eventually { model.shown?.userTune.learnedOn == nil }
        #expect(model.failure(at: .facts) == nil)
    }

    @Test func refusesAWriteToATuneDeletedMidFlight() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)
        try await Commands(store: store).deleteTune("t1")

        model.write { $0.key = "D" }

        try await eventually { model.failure(at: .facts) != nil }
        #expect(model.failure(at: .facts) == CommandError.tuneNotFoundMessage)
        #expect(sink.captures.isEmpty)
    }

    @Test func aFactWriteLeavesOtherPlacesFailuresAndTheyLeaveItsToo() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.copiedStore(root: root.url)
        try await store.write { writer in
            try writer.db.execute(
                sql: "CREATE TRIGGER refuse BEFORE UPDATE ON list_items BEGIN SELECT RAISE(ABORT, 'refused'); END")
        }
        let model = TuneModel(store: store, tuneID: soldiersJoy.tune.id, analytics: sink.client)
        try await eventually { model.shown != nil }
        await model.removeFromList(itemID: "sample_item_session_0", listID: SampleCatalog.lists[0].id)
        let listsFailure = try #require(model.failure(at: .lists))

        model.write { $0.title = "" }
        try await eventually { model.failure(at: .facts) != nil }
        #expect(model.failure(at: .lists) == listsFailure)
        model.write { $0.key = "G" }
        try await eventually { !sink.captures.isEmpty }
        #expect(model.failure(at: .facts) == nil)
        #expect(model.failure(at: .lists) == listsFailure)

        model.write { $0.title = "" }
        try await eventually { model.failure(at: .facts) != nil }
        await model.removeLink("sample_link_youtube")
        #expect(model.failure(at: .lists) == nil)
        #expect(model.failure(at: .facts) == TuneFormModel.titleRequired)
    }

    @Test func landsOnTheTuneItWasOpenedFor() async throws {
        let root = TemporaryRoot()
        let (store, first) = try await factModel(
            [
                Tune(id: "t1", createdAt: noon, title: "Sally Ann", key: "A"),
                Tune(id: "t2", createdAt: noon, title: "Angeline", key: "A"),
            ], root: root)

        first.write { $0.key = "D" }
        first.write { $0.title = "" }
        // The detail column swaps to the next tune before either write lands.
        let next = TuneModel(store: store, tuneID: "t2", analytics: sink.client)

        try await eventually { first.failure(at: .facts) != nil }
        #expect(try await storedTune(store, "t1").key == "D")
        #expect(try await storedTune(store, "t2").key == "A")
        try await eventually { next.shown != nil }
        #expect(next.shown?.tune.key == "A")
        #expect(next.failure == nil)
        #expect(sink.captures == [edited(["key"])])
    }

    @Test func aNotesWriteFailsUnderTheNotesAndLeavesTheFactsAlone() async throws {
        let root = TemporaryRoot()
        let (_, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.write { $0.title = "" }
        try await eventually { model.failure(at: .facts) != nil }
        model.writeNotes("Drive the B part")
        try await eventually { model.shown?.userTune.notes == "Drive the B part" }
        #expect(model.failure(at: .facts) == TuneFormModel.titleRequired)
        #expect(model.failure(at: .notes) == nil)
    }

    @Test func aRefusedNotesWriteShowsAtTheNotes() async throws {
        let root = TemporaryRoot()
        let (store, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)
        try await Commands(store: store).deleteTune("t1")

        model.writeNotes("Drive the B part")

        try await eventually { model.failure(at: .notes) != nil }
        #expect(model.failure(at: .notes) == CommandError.tuneNotFoundMessage)
        #expect(model.failure(at: .facts) == nil)
    }

    @Test func notesReportOncePerSession() async throws {
        let root = TemporaryRoot()
        let (_, model) = try await factModel([Tune(id: "t1", createdAt: noon, title: "Sally Ann")], root: root)

        model.noteEditing(began: true)
        model.write { $0.notes = "D" }
        model.write { $0.notes = "Dri" }
        model.write { $0.notes = "Drive the B part" }
        model.noteEditing(began: false)
        // Fact writes land in order, so this one's report marks that everything before it is in.
        model.write { $0.key = "G" }

        try await eventually { sink.captures.last == edited(["key"]) }
        #expect(sink.captures == [edited(["notes"]), edited(["key"])])
        #expect(model.shown?.userTune.notes == "Drive the B part")

        // A write in the session that changes another field reports that field at once.
        model.noteEditing(began: true)
        model.write {
            $0.notes = "Drive the B part hard"
            $0.composer = "Trad"
        }
        try await eventually { sink.captures.count == 3 }
        #expect(sink.captures.last == edited(["composer"]))
        model.write { $0.notes = "Drive the B part" }
        model.noteEditing(began: false)
        model.write { $0.key = "D" }
        try await eventually { sink.captures.count == 4 }
        #expect(sink.captures.last == edited(["key"]))

        // A session that ends where it began reports nothing.
        model.noteEditing(began: true)
        model.write { $0.notes = "Drive the B part hard" }
        model.write { $0.notes = "Drive the B part" }
        model.noteEditing(began: false)
        model.write { $0.key = "A" }

        try await eventually { sink.captures.count == 5 }
        #expect(
            sink.captures == [
                edited(["notes"]), edited(["key"]), edited(["composer"]), edited(["key"]), edited(["key"]),
            ])
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
    private let entry = SampleCatalog.entries[0]

    private func detail(
        key: String? = "D", modes: [String] = ["major"], lyrics: String? = nil, links: [RecordingLink] = []
    ) -> TuneDetail {
        var tune = entry.tune
        tune.key = key
        tune.modes = modes
        tune.lyrics = lyrics
        return TuneDetail(tune: tune, userTune: entry.userTune, links: links)
    }

    private var link: RecordingLink {
        RecordingLink(id: "l1", createdAt: noon, tuneID: entry.tune.id, url: "https://youtu.be/x", provider: "youtube")
    }

    private func addLine(
        _ detail: TuneDetail, scans: Int, loaded: Bool = true, adding: Bool = false, scanAddable: Bool = true
    ) -> [TunePageColumn.AddLineItem] {
        TunePageColumn.addLine(
            detail, scans: scans, scansLoaded: loaded, addingScans: adding, scanAddable: scanAddable)
    }

    private func sections(_ detail: TuneDetail, scans: Int, scanAddable: Bool = true) -> [TunePageColumn.Section] {
        TunePageColumn.sections(detail, scans: scans, addLine: addLine(detail, scans: scans, scanAddable: scanAddable))
    }

    @Test func theLyricsAddLineOpensTheFormOnLyricsAndEditAllOpensItPlain() {
        let bare = detail()
        #expect(
            TuneScreen.formTarget(bare, focus: .lyrics)
                == .edit(tuneID: bare.tune.id, userTuneID: bare.userTune.id, focus: .lyrics))
        #expect(
            TuneScreen.formTarget(bare, focus: nil) == .edit(tuneID: bare.tune.id, userTuneID: bare.userTune.id))
    }

    @Test func aBareTuneShowsRecordingsNotesAndTheAddLine() {
        #expect(sections(detail(), scans: 0) == [.recordings, .notes, .addLine])
        #expect(addLine(detail(), scans: 0) == [.lyrics, .scan])
    }

    @Test func lyricsAndScansShowOnceTheTuneHasThem() {
        #expect(sections(detail(), scans: 2) == [.recordings, .scans, .notes, .addLine])
        #expect(addLine(detail(), scans: 2) == [.lyrics])
        let worded = detail(lyrics: "My old hen")
        #expect(sections(worded, scans: 0) == [.recordings, .lyrics, .notes, .addLine])
        #expect(addLine(worded, scans: 0) == [.scan])
        #expect(sections(worded, scans: 1) == [.recordings, .lyrics, .scans, .notes])
        #expect(addLine(worded, scans: 1).isEmpty)
    }

    @Test func blankLyricsLeaveTheSectionOutAndTheAddLineOffersThem() {
        let blank = detail(lyrics: " \n ")
        #expect(sections(blank, scans: 0) == [.recordings, .notes, .addLine])
        #expect(addLine(blank, scans: 0) == [.lyrics, .scan])
    }

    @Test func theAddLineOffersAScanOnlyOnceScansHaveReadAndNoneIsAdding() {
        #expect(addLine(detail(), scans: 0, loaded: false) == [.lyrics])
        #expect(addLine(detail(), scans: 0, adding: true) == [.lyrics])
    }

    @Test func theAddLineGoesWhenNothingInItCanAct() {
        let worded = detail(lyrics: "My old hen")
        #expect(addLine(worded, scans: 0, scanAddable: false).isEmpty)
        #expect(sections(worded, scans: 0, scanAddable: false) == [.recordings, .lyrics, .notes])
    }

    @Test func listsEndThePageOnlyWhereTheFactsShowAsACard() {
        let worded = detail(lyrics: "My old hen")
        let addLine = addLine(worded, scans: 1)
        #expect(
            TunePageColumn.sections(worded, scans: 1, addLine: addLine, listsAtEnd: true)
                == [.recordings, .lyrics, .scans, .notes, .lists])
        #expect(!TunePageColumn.sections(worded, scans: 1, addLine: addLine, listsAtEnd: false).contains(.lists))
    }

    @Test func theLyricsSectionShowsVersesOnlyOnceOpened() {
        let worded = detail(
            lyrics: "\n  My old hen's a good old hen\n\tShe lays eggs for the railroad men \n\n\n\nSometimes one\n")
        #expect(TunePageColumn.lyricsShown(worded, open: false) == nil)
        #expect(
            TunePageColumn.lyricsShown(worded, open: true)
                == [["My old hen's a good old hen", "She lays eggs for the railroad men"], ["Sometimes one"]])
    }

    @Test func theNotesStayInEditingWhileFocusIsOnTheirDone() {
        #expect(NotesField.editing(.editor))
        #expect(NotesField.editing(.done))
        #expect(!NotesField.editing(nil))
    }

    @Test func moreSitsOnTheTitleRowOnTheMacAndAtRegularWidth() {
        #expect(TuneScreen.moreOnTitleRow(mac: true, compactWidth: false))
        #expect(TuneScreen.moreOnTitleRow(mac: false, compactWidth: false))
        #expect(!TuneScreen.moreOnTitleRow(mac: false, compactWidth: true))
    }

    private func recordingView(origin: String = "own", url: String? = nil) -> RecordingView {
        RecordingView(
            recording: Recording(
                id: "r1", tuneID: entry.tune.id, source: url == nil ? "microphone" : "import", origin: origin,
                originURL: url, addedAt: noon),
            file: nil, tuneID: entry.tune.id, tuneTitle: entry.tune.title)
    }

    /// The page's recording row swipes to Delete, Play first, Remove from tune, and Edit, as on
    /// the Recordings screen, and never offers to file it under the tune it is already under.
    @MainActor @Test func aRecordingRowOnTheTunePageSwipesToItsActions() {
        let handlers = TuneMediaRows.rowHandlers(
            recordingView(), pinned: false, togglePin: {}, open: { _ in }, edit: {}, removeFromTune: {},
            delete: {})
        #expect(handlers.swipe == [.delete, .pin, .removeFromTune, .edit])
        #expect(handlers.menu == [.edit, .removeFromTune, .pin, .delete])
    }

    /// An imported recording's page row opens the site it came from from its context menu only.
    @MainActor @Test func anImportedRecordingRowOnTheTunePageOpensItsSite() throws {
        var opened: URL?
        let handlers = TuneMediaRows.rowHandlers(
            recordingView(origin: "slippery_hill", url: "https://example.com/tune"), pinned: true, togglePin: {},
            open: { opened = $0 }, edit: {}, removeFromTune: {}, delete: {})
        let site = try #require(RecordingText.originLabel("slippery_hill"))
        #expect(handlers.menu.contains(.openOrigin(site: site)))
        #expect(!handlers.swipe.contains { if case .openOrigin = $0 { true } else { false } })
        handlers.onOpenOrigin?()
        #expect(opened == URL(string: "https://example.com/tune"))
    }

    /// The swipe list sizes to its rows, so it never collapses before they lay out: a row not
    /// measured yet counts at the estimate, and the gaps sit between rows only.
    @Test func theSwipeListTakesItsRowsHeightCountingUnmeasuredRowsAtTheEstimate() {
        #expect(SwipeRowsHeight.height([], gap: 10, estimate: 60) == 0)
        #expect(SwipeRowsHeight.height([nil], gap: 10, estimate: 60) == 60)
        #expect(SwipeRowsHeight.height([nil, nil], gap: 10, estimate: 60) == 130)
        #expect(SwipeRowsHeight.height([48, nil, 52], gap: 10, estimate: 60) == 180)
        #expect(SwipeRowsHeight.height([48, 72], gap: 10, estimate: 60) == 130)
    }

    @Test func anEmptyRecordingsSectionStartsWithTheCardAndNoHeadingAdd() {
        #expect(TunePageColumn.startsWithCard(detail()))
        #expect(!TunePageColumn.startsWithCard(detail(links: [link])))
    }

    @Test func theStartCardOffersOnlyWhatCanAct() {
        #expect(FirstRecordingCard.actions(record: true, pasteLink: true, find: true) == [.record, .pasteLink, .find])
        #expect(FirstRecordingCard.actions(record: false, pasteLink: true, find: true) == [.pasteLink, .find])
        #expect(FirstRecordingCard.actions(record: false, pasteLink: false, find: false).isEmpty)
    }

    @MainActor @Test func findSaysWhyOnlyAfterAPressTheConnectionRefused() {
        var find = FirstRecordingCard.FindPress()
        #expect(find.refusal(offline: true) == nil)
        find.press()
        #expect(find.refusal(offline: true) == FindRecordingsModel.searchNeedsConnection)
        find.connectionChanged()
        #expect(find.refusal(offline: false) == nil)
    }

    @MainActor @Test func aPressOnlineSaysNothingOnceTheConnectionGoes() {
        var find = FirstRecordingCard.FindPress()
        find.press()
        #expect(find.refusal(offline: false) == nil)
        find.connectionChanged()
        #expect(find.refusal(offline: true) == nil)
    }

    @Test func theKeyTileHoldsTheKeyAndANamedModeOrOffersToAddOne() {
        #expect(TuneBand.keyTile(detail(key: "A", modes: ["dorian"])) == .key("A", mode: "dorian"))
        #expect(TuneBand.keyTile(detail(key: "A", modes: ["other"])) == .key("A", mode: nil))
        #expect(TuneBand.keyTile(detail(key: "A", modes: [])) == .key("A", mode: nil))
        #expect(TuneBand.keyTile(detail(key: nil)) == .empty)
        #expect(TuneBand.keyTile(detail(key: "  ")) == .empty)
        #expect(TuneBand.keyTileLabel(.key("A", mode: "dorian")) == "Key, A dorian")
        #expect(TuneBand.keyTileLabel(.key("A", mode: nil)) == "Key, A")
        #expect(TuneBand.keyTileLabel(.empty) == "Add key")
    }

    @Test func theKeyTileIsSmallerOnACompactWidth() {
        #expect(TuneBand.keyTileSize(compact: true) == 54)
        #expect(TuneBand.keyTileSize(compact: false) == 64)
    }

    @Test func aRenameEndingAnyWayButEscapeSavesAndEscapeRestores() {
        #expect(TuneBand.renameResult(.commit, draft: "Sally Ann ", stored: "Sally Gooden") == "Sally Ann")
        #expect(TuneBand.renameResult(.cancel, draft: "Sally Ann", stored: "Sally Gooden") == nil)
        #expect(TuneBand.renameResult(.commit, draft: " ", stored: "Sally Gooden") == nil)
    }

    @Test func aNotesSessionOpensOnFocusAndClosesOnceOnBlurOrLeaving() {
        var session = NotesField.Session()
        #expect(session.focus(true) == true)
        #expect(session.focus(true) == nil)
        #expect(session.focus(false) == false)
        // The field going after a blur closes nothing more.
        #expect(session.focus(false) == nil)
        #expect(session.focus(true) == true)
        #expect(session.focus(false) == false)
        #expect(session.focus(false) == nil)
    }

    @Test func aRenameSavesOnlyATrimmedChangedTitle() {
        #expect(TuneBand.renamed("  Soldier's Joy II ", from: "Soldier's Joy") == "Soldier's Joy II")
        #expect(TuneBand.renamed("Soldier's Joy", from: "Soldier's Joy") == nil)
        #expect(TuneBand.renamed("   ", from: "Soldier's Joy") == nil)
        #expect(TuneBand.renamed("", from: "Soldier's Joy") == nil)
    }

    @Test func moreLeadsWithEditAllDetailsAndLeavesOutWhatCannotAct() {
        #expect(
            TuneMoreMenu.entries(archived: false, canAddToList: true) == [
                .editAll, .addToList, .archive(archived: false), .delete,
            ])
        #expect(
            TuneMoreMenu.entries(archived: true, canAddToList: false) == [.editAll, .archive(archived: true), .delete])
    }

    @MainActor @Test func pageWordsMatchTheWebClient() {
        #expect(FirstRecordingCard.title == "Add the first recording")
        #expect(FirstRecordingCard.hint == "Record it, paste a link, or find a version to learn from.")
        #expect(FirstRecordingCard.record == "Record")
        #expect(FirstRecordingCard.pasteLink == "Paste link")
        #expect(FirstRecordingCard.findARecording == "Find a recording")
        #expect(NotesField.placeholder == "Write a note…")
        #expect(TuneScreen.editAllDetails == "Edit all details")
        #expect(TuneScreen.recordingsHeader == "Recordings")
        #expect(TuneFieldLabels.lyrics == "Lyrics")
        #expect(TuneScreen.scansHeader == "Scans and images")
        #expect(TuneScreen.notesHeader == "Notes")
        #expect(TuneScreen.openLyrics == "Open lyrics")
        #expect(LyricsReader.editLyrics == "Edit lyrics")
        #expect(NotesField.savesAsYouType == "Saves as you type")
        #expect(TuneScreen.addToTune == "Add to this tune")
        #expect(TuneScreen.addScan == "Add scan or image")
        #expect(TuneScreen.addScanText == "Scan or image")
        #expect(TuneScreen.addLyrics == "Add lyrics")
        #expect(TuneScreen.addLyricsText == "Lyrics")
        #expect(TuneBand.rename == "Rename")
        #expect(TuneBand.addKey == "Add key")
    }

    /// The page says what is missing with a start card or an add line, never an empty-state block.
    @Test(arguments: [
        "Tune/TunePage.swift", "Tune/TuneBand.swift", "Tune/FirstRecordingCard.swift", "Tune/NotesField.swift",
    ])
    func noEmptyStateBlocks(path: String) throws {
        let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.sources.appending(path: path)))
        #expect(!text.contains("PageEmptyState"))
    }

    /// The band's key tile and rename write through the opened tune's own model, so a save that
    /// lands as the detail column swaps tunes lands on the tune it was made on.
    @Test func theBandWritesThroughItsOwnTunesModel() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Tune/TuneBand.swift")))
        #expect(text.contains("write: model.write"))
        #expect(text.contains("model.write {"))
    }
}
