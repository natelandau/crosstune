import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

private func tune(
    _ title: String, id: String = UUID().uuidString, key: String? = nil, modes: [String] = [],
    composer: String? = nil, genre: String? = nil, type: String? = nil, timeSignature: String? = nil,
    alternateTitles: [String] = [], lyrics: String? = nil, tunings: JSONObject = [:], deleted: Bool = false
) -> Tune {
    Tune(
        id: id, createdAt: noon, deletedAt: deleted ? noon : nil, title: title, alternateTitles: alternateTitles,
        composer: composer, genre: genre, tuneType: type, key: key, modes: modes, timeSignature: timeSignature,
        lyrics: lyrics, tunings: tunings)
}

private func userTune(_ tuneID: String, status: String = "want_to_learn", notes: String? = nil) -> UserTune {
    UserTune(createdAt: noon, tuneID: tuneID, status: status, notes: notes)
}

private func entry(_ tuning: String? = nil, capo: Int64? = nil) -> JSONValue {
    var object: JSONObject = [:]
    if let tuning { object["tuning"] = .string(tuning) }
    if let capo { object["capo"] = .integer(capo) }
    return .object(object)
}

@Suite struct TuneFormValuesTests {
    @Test func startsANewTuneAsWantToLearnIn44() {
        let values = TuneFormValues()
        #expect(values.status == "want_to_learn")
        #expect(values.timeSignature == "4/4")
        #expect(values.title == "")
    }

    @Test func roundTripsATuneAndTrimsSplitsAndNilsBlanksOnTheWayOut() {
        let stored = tune("Soldier's Joy", key: "D", modes: ["major"], alternateTitles: ["Joy"])
        var values = TuneFormValues(tune: stored, userTune: userTune(stored.id, status: "known", notes: "  "))
        #expect(values.title == "Soldier's Joy")
        #expect(values.key == "D")
        #expect(values.alternateTitles == "Joy")
        #expect(values.modes == ["major"])
        #expect(values.status == "known")
        values.alternateTitles = " Joy , Soldier ,"
        values.genre = "  "
        #expect(values.tuneInput.alternateTitles == ["Joy", "Soldier"])
        #expect(values.tuneInput.genre == nil)
        #expect(values.userTuneInput.notes == nil)
    }

    @Test func fallsBackWhenAStoredModeTimeSignatureOrStatusIsUnknown() {
        let stored = tune("Odd", modes: ["lydian"], timeSignature: "7/8")
        let values = TuneFormValues(tune: stored, userTune: userTune(stored.id, status: "bogus"))
        #expect(values.modes == [])
        #expect(values.timeSignature == "")
        #expect(values.status == "want_to_learn")
        #expect(values.tuneInput.timeSignature == nil)
        #expect(values.tuneInput.modes == [])
    }

    @Test func savesPartModesInOrderWithNoGaps() {
        var values = TuneFormValues()
        values.modes = ["", "dorian", ""]
        #expect(values.tuneInput.modes == ["dorian"])
    }

    @Test func keepsEveryPartModeAndDropsOneThisBuildDoesNotKnow() {
        let stored = tune("Cooley's", modes: ["major", "lydian", "dorian"])
        let values = TuneFormValues(tune: stored, userTune: userTune(stored.id))
        #expect(values.modes == ["major", "dorian"])
        #expect(values.tuneInput.modes == ["major", "dorian"])
    }

    @Test func carriesTheComposerAndLyricsThroughAndNilsBlankOnes() {
        let stored = tune("Lucy Farr", composer: "Ed Reavy", lyrics: "Did you ever go to meeting")
        var values = TuneFormValues(tune: stored, userTune: userTune(stored.id))
        #expect(values.tuneInput.composer == "Ed Reavy")
        #expect(values.tuneInput.lyrics == "Did you ever go to meeting")
        values.composer = "  "
        values.lyrics = "  \n\n  "
        #expect(values.tuneInput.composer == nil)
        #expect(values.tuneInput.lyrics == nil)
    }

    @Test func showsOneEmptyModeRowForATuneWithNoMode() {
        #expect(TuneFormValues().modeRows == [""])
    }

    @Test func setsOnePartAndKeepsTheOthers() {
        var values = TuneFormValues()
        values.modes = ["major", "minor"]
        values.setMode("dorian", part: 1)
        #expect(values.modes == ["major", "dorian"])
    }

    @Test func setsTheFirstPartOfATuneWithNoMode() {
        var values = TuneFormValues()
        values.setMode("dorian", part: 0)
        #expect(values.modes == ["dorian"])
    }

    @Test func emptiesAPartSetToAModeThisBuildDoesNotKnow() {
        var values = TuneFormValues()
        values.modes = ["major", "minor"]
        values.setMode("lydian", part: 0)
        #expect(values.modes == ["", "minor"])
    }

    @Test func addsAPartRowOnlyOnceTheLastHoldsAModeAndUpToTheLimit() {
        var values = TuneFormValues()
        #expect(!values.canAddModeRow)
        values.setMode("major", part: 0)
        #expect(values.canAddModeRow)
        values.addModeRow()
        #expect(values.modeRows == ["major", ""])
        #expect(!values.canAddModeRow)
        values.modes = ["major", "minor", "dorian", "major"]
        #expect(!values.canAddModeRow)
    }

    @Test func removesAPartRowAndKeepsTheRest() {
        var values = TuneFormValues()
        values.modes = ["major", "minor", "dorian"]
        values.removeModeRow(at: 1)
        #expect(values.modes == ["major", "dorian"])
        values.removeModeRow(at: 0)
        values.removeModeRow(at: 0)
        #expect(values.modeRows == [""])
    }

    @Test func readsEachTuningAndCapoAndWritesBackACompactMap() {
        let stored: JSONObject = [
            "hardanger": entry("x"),
            "guitar": entry("DADGAD", capo: 2),
            "bouzouki": entry(capo: 3),
        ]
        let row = tune("Sally Ann", tunings: stored)
        var values = TuneFormValues(tune: row, userTune: userTune(row.id))
        #expect(values.tuning("guitar") == TuningValues(tuning: "DADGAD", capo: 2))
        #expect(values.tuning("bouzouki") == TuningValues(tuning: "", capo: 3))
        #expect(values.tuning("violin") == TuningValues())
        values.tunings["violin"] = TuningValues(tuning: " Cross A (AEAE) ")
        values.tunings["guitar"] = TuningValues()
        #expect(
            values.tuningsMap(stored: stored) == [
                "hardanger": entry("x"), "bouzouki": entry(capo: 3), "violin": entry("Cross A (AEAE)"),
            ])
    }

    @Test func keepsAnUntouchedTuningEntryExactlyAsStored() {
        let stored: JSONObject = [
            "guitar": .object(["tuning": .string("DADGAD"), "capo": .integer(2), "strings": .integer(6)]),
            "violin": entry("AEAE", capo: 1),
        ]
        let row = tune("Sally Ann", tunings: stored)
        let values = TuneFormValues(tune: row, userTune: userTune(row.id))
        #expect(values.tuningsMap(stored: stored) == stored)
    }

    @Test func keepsTheCapoWhenAStoredTuningIsCleared() {
        let stored: JSONObject = ["guitar": entry("DADGAD", capo: 2)]
        let row = tune("Sally Ann", tunings: stored)
        var values = TuneFormValues(tune: row, userTune: userTune(row.id))
        values.tunings["guitar"]?.tuning = ""
        #expect(values.tuningsMap(stored: stored) == ["guitar": entry(capo: 2)])
    }

    @Test func writesOnlyTheInstrumentsTheFormTouchedForANewTune() {
        var values = TuneFormValues()
        values.tunings["guitar"] = TuningValues(capo: 2)
        #expect(values.tuneInput.tunings == ["guitar": entry(capo: 2)])
    }

    @Test func patchesOnlyTheFieldsTheMusicianChanged() {
        let stored = tune("Angeline", key: "D", modes: ["major"], genre: " Old-time ", timeSignature: "7/8")
        let opened = TuneFormValues(tune: stored, userTune: userTune(stored.id, notes: "slow"))
        var values = opened
        values.key = ""
        values.status = "known"
        values.title = " Angeline "
        let (tunePatch, userPatch) = values.patches(from: opened, storedTunings: stored.tunings)
        #expect(tunePatch.key.resolved(from: "x") == nil)
        #expect(tunePatch.title.isKeep)
        #expect(tunePatch.genre.isKeep)
        #expect(tunePatch.timeSignature.isKeep)
        #expect(tunePatch.modes.isKeep)
        #expect(tunePatch.tunings.isKeep)
        #expect(userPatch.status.resolved(from: "") == "known")
        #expect(userPatch.notes.isKeep)
    }

    @Test func patchesNothingForAnUntouchedForm() {
        let stored = tune("Angeline", tunings: ["hardanger": entry("x")])
        let opened = TuneFormValues(tune: stored, userTune: userTune(stored.id))
        let (tunePatch, userPatch) = opened.patches(from: opened, storedTunings: stored.tunings)
        #expect(tunePatch.isEmpty)
        #expect(userPatch.isEmpty)
    }
}

@Suite struct TypeTimeSignatureTests {
    @Test func setsANewTunesUntouchedDefaultTimeSignature() {
        var values = TuneFormValues()
        values.setType("Jig", isNew: true, timeSignatureTouched: false)
        #expect(values.tuneType == "Jig")
        #expect(values.timeSignature == "6/8")
    }

    @Test func keepsATimeSignatureThePlayerChoseOnANewTune() {
        var values = TuneFormValues()
        values.setType("Jig", isNew: true, timeSignatureTouched: true)
        #expect(values.timeSignature == "4/4")
    }

    @Test func keepsAnEditedTunesStoredTimeSignature() {
        var values = TuneFormValues()
        values.setType("Jig", isNew: false, timeSignatureTouched: false)
        #expect(values.timeSignature == "4/4")
    }

    @Test func fillsAnEditedTunesEmptyTimeSignature() {
        var values = TuneFormValues()
        values.timeSignature = ""
        values.setType("Slide", isNew: false, timeSignatureTouched: false)
        #expect(values.timeSignature == "12/8")
    }

    @Test func leavesTheTimeSignatureForATypeWithoutOne() {
        var values = TuneFormValues()
        values.timeSignature = ""
        values.setType("Air", isNew: false, timeSignatureTouched: false)
        #expect(values.timeSignature == "")
    }

    @Test(arguments: [
        ("Reel", "4/4"), ("HORNPIPE", "4/4"), ("Barndance", "4/4"), ("Highland", "4/4"), ("Strathspey", "4/4"),
        ("Breakdown", "4/4"), ("Rag", "4/4"), ("jig", "6/8"), ("slip JIG", "9/8"), ("Hop jig", "9/8"),
        ("Slide", "12/8"), ("Single jig", "12/8"), ("Polka", "2/4"), ("March", "2/4"), ("Waltz", "3/4"),
        ("Mazurka", "3/4"),
    ])
    func readsEachTypesOwnTimeSignature(type: String, expected: String) {
        #expect(TuneSuggestions.timeSignature(for: type) == expected)
    }

    @Test func hasNoTimeSignatureForATypeWrittenInSeveral() {
        #expect(TuneSuggestions.timeSignature(for: "Set dance") == nil)
        #expect(TuneSuggestions.timeSignature(for: "Air") == nil)
    }
}

@Suite struct TuneSuggestionsTests {
    @Test func putsAGenresOwnTypesFirstThenTheRestAlphabetically() {
        let types = TuneSuggestions.types(genre: "Irish", tunes: [])
        #expect(Array(types.prefix(3)) == ["Reel", "Jig", "Slip jig"])
        #expect(types.firstIndex(of: "Breakdown")! > types.firstIndex(of: "Waltz")!)
        #expect(Set(types).count == types.count)
    }

    @Test func matchesTheGenreIgnoringCase() {
        #expect(TuneSuggestions.types(genre: "irish", tunes: []).first == "Reel")
    }

    @Test func ordersByTheCatalogsOwnUseWhenTheTuneHasNoGenre() {
        let tunes = [tune("a", type: "Polka"), tune("b", type: "polka"), tune("c", type: "Rag")]
        #expect(Array(TuneSuggestions.types(genre: "", tunes: tunes).prefix(2)) == ["Polka", "Rag"])
    }

    @Test func spellsAKnownTypeTheCanonicalWayOnce() {
        let types = TuneSuggestions.types(genre: "", tunes: [tune("a", type: "polka")])
        #expect(types.first == "Polka")
        #expect(types.filter { $0 == "Polka" }.count == 1)
        #expect(!types.contains("polka"))
    }

    @Test func keepsACustomTypeTheCatalogUses() {
        #expect(TuneSuggestions.types(genre: "", tunes: [tune("a", type: "Fling")]).contains("Fling"))
    }

    @Test func countsGenreSpellingsAlikeAndBreaksTiesAlphabetically() {
        let tunes = [
            tune("a", genre: "Old-time"), tune("b", genre: "irish"), tune("c", genre: "Irish"),
            tune("d", genre: "Old-time"),
        ]
        #expect(TuneSuggestions.mostUsedGenre(tunes) == "Irish")
    }

    @Test func spellsAKnownGenreTheCanonicalWay() {
        let tunes = [tune("a", genre: "IRISH"), tune("b", genre: "Irish"), tune("c", genre: "Irish")]
        #expect(TuneSuggestions.mostUsedGenre(tunes) == "Irish")
        #expect(TuneSuggestions.mostUsedGenre([tune("a", genre: "irish")]) == "Irish")
    }

    @Test func spellsACustomGenreTheWayMostTunesDoTiesToTheFirstSeen() {
        let most = [tune("a", genre: "klezmer"), tune("b", genre: "KLEZMER"), tune("c", genre: "KLEZMER")]
        #expect(TuneSuggestions.mostUsedGenre(most) == "KLEZMER")
        let tied = [tune("a", genre: "klezmer"), tune("b", genre: "Klezmer")]
        #expect(TuneSuggestions.mostUsedGenre(tied) == "klezmer")
    }

    @Test func hasNoGenreForACatalogWithoutOne() {
        #expect(TuneSuggestions.mostUsedGenre([tune("a")]) == nil)
    }

    @Test func offersTraditionalFirstThenEveryComposerOnceAlphabetically() {
        let tunes = [
            tune("a", composer: "Ed Reavy"), tune("b", composer: "ed reavy"), tune("c", composer: "Charlie Lennon"),
        ]
        #expect(TuneSuggestions.composers(tunes) == [TuneSuggestions.traditional, "Charlie Lennon", "Ed Reavy"])
    }

    @Test func spellsAComposerTheWayMostTunesDo() {
        let tunes = [tune("a", composer: "ED REAVY"), tune("b", composer: "Ed Reavy"), tune("c", composer: "Ed Reavy")]
        #expect(TuneSuggestions.composers(tunes) == [TuneSuggestions.traditional, "Ed Reavy"])
    }
}

@Suite struct TuneFormControlTests {
    @Test func showsTheQuickKeysAndAChosenKeyTheyLack() {
        #expect(KeyChooser.shown(chosen: "") == Vocabulary.quickKeys)
        #expect(KeyChooser.shown(chosen: "D") == Vocabulary.quickKeys)
        #expect(KeyChooser.shown(chosen: "F#") == Vocabulary.quickKeys + ["F#"])
        #expect(KeyChooser.shown(chosen: "C/G") == Vocabulary.quickKeys + ["C/G"])
    }

    @Test func offersEveryOtherKeyUnderMoreKeysInOrder() {
        #expect(KeyChooser.more(chosen: "") == ["A#", "Ab", "C#", "D#", "Db", "F#", "G#", "Gb"])
        #expect(!KeyChooser.more(chosen: "F#").contains("F#"))
    }

    @Test func clearsTheKeyWhenTheChosenPillIsPressed() {
        #expect(KeyChooser.pressing("D", chosen: "D") == "")
        #expect(KeyChooser.pressing("A", chosen: "D") == "A")
    }

    @Test func keepsAValueTheSuggestionsLackAsItsOwnChoice() {
        #expect(SuggestionPicker.choices(["Reel"], value: "Fling") == ["Reel", "Fling"])
        #expect(SuggestionPicker.choices(["Reel"], value: "Reel") == ["Reel"])
        #expect(SuggestionPicker.choices(["Reel"], value: "") == ["Reel"])
    }

    @Test func clearsASuggestionWhenOtherIsChosenAndKeepsACustomValue() {
        let options = ["Reel", "Jig"]
        #expect(SuggestionPicker.choosing(SuggestionPicker.otherTag, value: "Reel", options: options) == ("", true))
        #expect(
            SuggestionPicker.choosing(SuggestionPicker.otherTag, value: "Fling", options: options) == ("Fling", true))
        #expect(SuggestionPicker.choosing(SuggestionPicker.noneTag, value: "Reel", options: options) == ("", false))
        #expect(SuggestionPicker.choosing("Jig", value: "", options: options) == ("Jig", false))
    }

    @Test func storesACalendarDayAndReadsItBackUnchanged() throws {
        var calendar = Calendar(identifier: .gregorian)
        for zone in ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"] {
            calendar.timeZone = try #require(TimeZone(identifier: zone))
            let date = try #require(CalendarDay.date("2024-03-04", calendar: calendar))
            #expect(CalendarDay.day(date, calendar: calendar) == "2024-03-04")
        }
        #expect(CalendarDay.date("2024-02-30") == nil)
        #expect(CalendarDay.date("March 4") == nil)
        #expect(CalendarDay.date("") == nil)
    }

    @Test func namesTuningAndCapoRowsInFull() {
        #expect(TuneFieldLabels.tuning("five_string_banjo") == "5-string banjo tuning")
        #expect(TuneFieldLabels.capo("guitar") == "Guitar capo")
        #expect(TuneFieldLabels.other(TuneFieldLabels.genre) == "Other genre")
    }
}

@MainActor
@Suite struct TuneFormModelTests {
    private func seed(_ store: CrosstuneStore, instruments: [String] = ["violin"], tunes: [Tune] = []) async throws {
        try await store.write { writer in
            try writer.put(
                UserSettings(
                    id: settingsID(clerkUserID: store.userID), createdAt: noon, audioQuality: "standard",
                    instruments: instruments), at: noon)
            for tune in tunes {
                try writer.put(tune, at: noon)
                try writer.put(userTune(tune.id), at: noon)
            }
        }
    }

    @Test func startsANewTuneWithTheSearchTitleCappedAndTheMostUsedGenre() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, tunes: [tune("a", genre: "Irish"), tune("b", genre: "irish"), tune("c", genre: "Cajun")])
        let long = String(repeating: "x", count: Vocabulary.Limits.Tune.title + 20)
        let model = TuneFormModel(store: store, target: .new(title: long))
        await model.load()

        #expect(model.phase == .ready)
        #expect(model.values.title.count == Vocabulary.Limits.Tune.title)
        #expect(model.values.genre == "Irish")
        #expect(model.tuningInstruments == ["violin"])
        // A carried title is work a swipe would lose.
        #expect(model.isEdited)
    }

    @Test func holdsAnUntouchedNewTuneAsUneditedAndRefusesToSaveItWithoutATitle() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .new(title: nil))
        await model.load()

        #expect(!model.isEdited)
        #expect(!model.canSave)
        #expect(await model.save() == nil)
        #expect(model.validation == TuneFormModel.titleRequired)
        model.setTitle("Angeline")
        #expect(model.validation == nil)
        #expect(model.isEdited)
        #expect(model.canSave)
    }

    @Test func holdsAChoiceThatSavesNothingAsNoEdit() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, instruments: ["guitar"])
        let model = TuneFormModel(store: store, target: .new(title: nil))
        await model.load()
        model.values.tunings["guitar"] = TuningValues(tuning: "", capo: nil)
        model.values.composer = ""
        #expect(!model.isEdited)
        model.values.tunings["guitar"]?.capo = 2
        #expect(model.isEdited)
    }

    @Test func keepsAReChosenTimeSignatureWhenATypeFollows() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .new(title: nil))
        await model.load()
        // Picking the 4/4 already shown is still the player's choice.
        model.setTimeSignature(model.values.timeSignature)
        model.setType("Slide")
        #expect(model.values.timeSignature == "4/4")
    }

    @Test func createsTheTuneAndTheMusiciansRowOnce() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .new(title: "Angeline"))
        await model.load()
        model.values.key = "D"
        model.values.status = "learning"
        model.setType("Jig")

        let tuneID = try #require(await model.save())
        #expect(await model.save() == nil)
        #expect(!model.canSave)

        let saved = try await store.read { db in
            (try Tune.fetchOne(db, key: tuneID), try UserTune.filter(UserTune.CodingKeys.tuneID == tuneID).fetchAll(db))
        }
        let tune = try #require(saved.0)
        #expect(tune.title == "Angeline")
        #expect(tune.key == "D")
        #expect(tune.tuneType == "Jig")
        #expect(tune.timeSignature == "6/8")
        #expect(saved.1.map(\.status) == ["learning"])
    }

    @Test func keepsATimeSignatureThePlayerPickedWhenATypeFollows() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .new(title: nil))
        await model.load()
        model.setTimeSignature("4/4")
        model.setType("Jig")
        #expect(model.values.timeSignature == "4/4")
    }

    @Test func editsOnlyTheFieldsTheMusicianChanged() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = tune(
            "Sally Ann", key: "A", modes: ["major"], timeSignature: "7/8",
            tunings: ["guitar": entry("DADGAD", capo: 2), "hardanger": entry("x")])
        try await seed(store, instruments: ["violin"], tunes: [stored])
        let userTuneID = try await store.read { db in
            try UserTune.filter(UserTune.CodingKeys.tuneID == stored.id).fetchOne(db)!.id
        }
        let model = TuneFormModel(store: store, target: .edit(tuneID: stored.id, userTuneID: userTuneID))
        await model.load()
        #expect(model.tuningInstruments == ["violin", "guitar"])
        #expect(!model.isEdited)

        // Written from elsewhere while the form is open: a field the form leaves alone keeps it.
        try await store.write { writer in try writer.updateTune(stored.id, patch: TunePatch(genre: .value("Irish"))) }
        model.values.key = "D"
        #expect(model.isEdited)
        #expect(await model.save() == stored.id)

        let tune = try #require(try await store.read { db in try Tune.fetchOne(db, key: stored.id) })
        #expect(tune.key == "D")
        #expect(tune.genre == "Irish")
        #expect(tune.timeSignature == "7/8")
        #expect(tune.tunings == stored.tunings)
    }

    @Test func showsATuneThatIsGoneAsGone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .edit(tuneID: "missing", userTuneID: "missing"))
        await model.load()
        #expect(model.phase == .gone)
        #expect(!model.canSave)
    }

    @Test func showsATuningRowForAnUnplayedInstrumentOnlyWhenTheTuneHoldsOne() {
        let tunings: JSONObject = ["guitar": entry(capo: 2), "hardanger": entry("x")]
        #expect(TuneFormModel.tuningInstruments(["violin"], tunings: tunings) == ["violin", "guitar"])
        #expect(TuneFormModel.tuningInstruments([], tunings: [:]) == [])
    }
}
