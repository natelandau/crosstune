import CrosstuneStore
import CrosstuneTestSupport
import Testing

@testable import CrosstuneUI

/// What each attribute's editor opens on, what its choices do to the open editor, and what a saved
/// value writes.
extension AttributeEditorTests {
    private func detail(_ tune: Tune = Tune(createdAt: noon, title: "Test"), learnedOn: String? = nil) -> TuneDetail {
        TuneDetail(
            tune: tune, userTune: UserTune(createdAt: noon, tuneID: tune.id, status: "learning", learnedOn: learnedOn))
    }

    /// The form's values for `detail` once `patch` has run, as a write applies it.
    private func applying(_ patch: AttributePatch, to detail: TuneDetail) -> TuneFormValues {
        var values = TuneFormValues(tune: detail.tune, userTune: detail.userTune)
        patch(&values)
        return values
    }

    @Test func aKeyPickSavesAndKeepsTheEditorOpenForTheModes() {
        let tune = detail(Tune(createdAt: noon, title: "T", key: "G", modes: ["dorian"]))
        let edit = AttributeEdit.key(tune)
        #expect(edit.session.stored == KeyModes(key: "G", modes: ["dorian"]))

        let choice = KeyModes.choosing(key: "D", in: edit.session.stored)
        #expect(choice == .stay(KeyModes(key: "D", modes: ["dorian"])))
        guard case .stay(let next) = choice else { return }
        let saved = applying(edit.patch(next), to: tune)
        #expect(saved.key == "D")
        #expect(saved.modes == ["dorian"])
    }

    @Test func pressingTheChosenKeyClearsIt() {
        let tune = detail(Tune(createdAt: noon, title: "T", key: "D", modes: ["major"]))
        let edit = AttributeEdit.key(tune)
        let pressed = KeyChooser.pressing("D", chosen: edit.session.stored.key)
        guard case .stay(let next) = KeyModes.choosing(key: pressed, in: edit.session.stored) else {
            Issue.record("A key press keeps the editor open")
            return
        }
        #expect(applying(edit.patch(next), to: tune).key == "")
        #expect(applying(edit.patch(next), to: tune).modes == ["major"])
    }

    @Test func aModeChangeSavesAndAnEmptyRowWaits() {
        let stored = KeyModes(key: "A", modes: ["dorian"])
        #expect(
            KeyModes.choosing(modes: ["mixolydian"], in: stored) == .stay(KeyModes(key: "A", modes: ["mixolydian"])))
        #expect(
            KeyModes.choosing(modes: ["dorian", ""], in: stored) == .draft(KeyModes(key: "A", modes: ["dorian", ""])))
    }

    @Test func anEmptyModeRowLeftOpenSavesNothingOnClose() {
        var session = AttributeEdit.key(detail(Tune(createdAt: noon, title: "T", key: "A", modes: ["dorian"]))).session
        session.draft.modes = ["dorian", ""]
        #expect(session.end(.dismissed) == nil)
    }

    @Test func aFrettedInstrumentTakesACapoAndTheViolinDoesNot() {
        #expect(TuningRows.takesCapo("guitar"))
        #expect(TuningRows.takesCapo("five_string_banjo"))
        #expect(TuningRows.takesCapo("mandolin"))
        #expect(!TuningRows.takesCapo("violin"))
    }

    @Test func aTuningPickStaysOpenForTheCapoOnlyWhereThereIsOne() {
        let draft = TuningValues(tuning: "", capo: 2)
        #expect(
            AttributeEdit.choosing("Open G", instrument: "guitar", in: draft)
                == .stay(TuningValues(tuning: "Open G", capo: 2)))
        #expect(
            AttributeEdit.choosing("AEAE", instrument: "violin", in: TuningValues())
                == .close(TuningValues(tuning: "AEAE")))
    }

    @Test func aTuningSaveWritesOnlyItsInstrument() {
        let tune = detail(
            Tune(createdAt: noon, title: "T", tunings: ["guitar": .object(["tuning": .string("DADGAD")])]))
        let edit = AttributeEdit.tuning("violin", tune)
        #expect(edit.session.stored == TuningValues())
        let saved = applying(edit.patch(TuningValues(tuning: "AEAE")), to: tune)
        #expect(saved.tuning("violin") == TuningValues(tuning: "AEAE"))
        #expect(saved.tuning("guitar") == TuningValues(tuning: "DADGAD"))
    }

    @Test func enterOnAPartialLearnedOnDateIsRefusedWithTheMessage() {
        #expect(LearnedOnEditor.refusal("2024-05") == LearnedOnEditor.incomplete)
        #expect(LearnedOnEditor.refusal("2024-02-30") == LearnedOnEditor.incomplete)
        #expect(LearnedOnEditor.refusal("2024-05-03") == nil)
        #expect(LearnedOnEditor.refusal("") == nil)
    }

    @Test func theCrookedWriteLeavesThePartsAndThePartsWriteLeavesCrooked() {
        let tune = detail(Tune(createdAt: noon, title: "T", partStructure: "AABB"))
        let saved = applying(AttributeEdit.crooked(tune).patch(true), to: tune)
        #expect(saved.isCrooked)
        #expect(saved.partStructure == "AABB")
        #expect(applying(AttributeEdit.partStructure(tune).patch("AB"), to: tune).isCrooked == false)
    }

    @Test func eachTextAttributeOpensOnItsStoredValueAndWritesItsOwnField() {
        let tune = detail(
            Tune(
                createdAt: noon, title: "T", alternateTitles: ["One", "Two"], composer: "Ed Reavy", genre: "Irish",
                tuneType: "Reel", partStructure: "AABB"))
        let edits: [(AttributeEdit<String>, String, KeyPath<TuneFormValues, String>)] = [
            (.tuneType(tune), "Reel", \.tuneType), (.genre(tune), "Irish", \.genre),
            (.composer(tune), "Ed Reavy", \.composer), (.partStructure(tune), "AABB", \.partStructure),
            (.alternateTitles(tune), "One, Two", \.alternateTitles), (.learnedFrom(tune), "", \.learnedFrom),
            (.status(tune), "learning", \.status), (.timeSignature(tune), "", \.timeSignature),
            (.learnedOn(tune), "", \.learnedOn),
        ]
        for (edit, stored, field) in edits {
            #expect(edit.session.stored == stored)
            #expect(applying(edit.patch("x"), to: tune)[keyPath: field] == "x")
        }
    }

    @Test func aMacSuggestionPickReadsApartFromTyping() {
        #expect(SuggestionField.edit(SuggestionField.pickToken + "Reel", kept: false) == .pick("Reel"))
        #expect(SuggestionField.edit("Reel", kept: false) == .set("Reel"))
    }

    /// A capo instrument's tuning pick saves while the editor stays open. Changing the draft back
    /// to the value it opened on still saves on close, since the tune now holds the pick.
    @Test func revertingATuningAfterAStayOpenSaveStillSaves() {
        let tune = detail(
            Tune(createdAt: noon, title: "T", tunings: ["guitar": .object(["tuning": .string("DADGAD")])]))
        var session = AttributeEdit.tuning("guitar", tune).session
        #expect(session.save(TuningValues(tuning: "Open G")) == TuningValues(tuning: "Open G"))
        session.draft = TuningValues(tuning: "DADGAD")
        #expect(session.end(.dismissed) == TuningValues(tuning: "DADGAD"))
    }

    @Test func aStayOpenSaveOfTheStoredValueSavesNothing() {
        var session = AttributeEdit.key(detail(Tune(createdAt: noon, title: "T", key: "A"))).session
        #expect(session.save(KeyModes(key: "A", modes: [""])) == nil)
        #expect(session.save(KeyModes(key: "D", modes: [])) == KeyModes(key: "D", modes: []))
        // Closing on what the last key press saved writes nothing more.
        #expect(session.end(.dismissed) == nil)
    }

    @Test func aStayOpenSaveAfterTheEndSavesNothing() {
        var session = AttributeEditSession.text("Reel")
        _ = session.end(.done)
        #expect(session.save("Jig") == nil)
    }
}
