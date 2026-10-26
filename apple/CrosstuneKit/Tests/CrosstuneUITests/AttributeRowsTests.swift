import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct AttributeRowsTests {
    private func detail(
        _ tune: Tune = Tune(createdAt: noon, title: "Test"), status: String = "learning",
        learnedFrom: String? = nil, learnedOn: String? = nil, instruments: Set<String> = ["violin"]
    ) -> TuneDetail {
        TuneDetail(
            tune: tune,
            userTune: UserTune(
                createdAt: noon, tuneID: tune.id, status: status, learnedFrom: learnedFrom, learnedOn: learnedOn),
            instruments: instruments)
    }

    private func row(_ id: AttributeID, in detail: TuneDetail) -> AttributeRow? {
        AttributeRows.rows(detail, locale: Locale(identifier: "en_US")).first { $0.id == id }
    }

    @Test func ordersTheRowsAsTheSpecListsThem() {
        let rows = AttributeRows.rows(detail())
        #expect(
            rows.map(\.id) == [
                .status, .key, .tuning("violin"), .tuneType, .timeSignature, .partStructure, .genre, .composer,
                .alternateTitles, .learnedFrom, .learnedOn,
            ])
        #expect(rows.first { $0.id == .status }?.text == "Learning")
        #expect(rows.filter { $0.group == .learned }.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func namesAPartForEveryModeATuneCanHold() {
        #expect(AttributeRows.partLetters == Array("ABCD"))
        #expect(AttributeRows.partLetters.count == Vocabulary.Limits.Tune.modes)
    }

    @Test func labelsTheRows() {
        let rows = AttributeRows.rows(detail())
        #expect(
            rows.map(\.label) == [
                "Status", "Key", "Violin tuning", "Type", "Time signature", "Parts", "Genre", "Composer",
                "Also known as", "Learned from", "Learned on",
            ])
    }

    @Test func readsAnUnrecognizedStatusAsWantToLearn() {
        #expect(row(.status, in: detail(status: "mastered"))?.text == "Unknown")
    }

    @Test func showsCrookedOnlyWhenOnAndRightAfterParts() {
        let crooked = detail(Tune(createdAt: noon, title: "T", isCrooked: true))
        let on = AttributeRows.rows(crooked).map(\.id)
        let at = on.firstIndex(of: .partStructure)!
        #expect(on[at + 1] == .isCrooked)
        #expect(row(.isCrooked, in: crooked)?.text == "Crooked")
        #expect(!AttributeRows.rows(detail()).map(\.id).contains(.isCrooked))
    }

    @Test func leavesOutAModeOfOtherAndKeepsTheKey() {
        func text(_ modes: [String]) -> String? {
            row(.key, in: detail(Tune(createdAt: noon, title: "T", key: "A", modes: modes)))?.text
        }
        #expect(text(["other"]) == "A")
        #expect(text(["dorian", "other"]) == "A dorian")
        #expect(text(["major"]) == "A major")
        #expect(text([]) == "A")
    }

    @Test func formatsTheKeyWithEveryMode() {
        let tune = Tune(createdAt: noon, title: "T", key: "A", modes: ["dorian", "mixolydian"])
        #expect(row(.key, in: detail(tune))?.text == "A dorian, B part mixolydian")
    }

    @Test func leavesTheKeyNilWithoutOne() {
        #expect(row(.key, in: detail())?.text == nil)
    }

    @Test func writesACapoAlone() {
        let tune = Tune(createdAt: noon, title: "T", tunings: ["violin": .object(["capo": .integer(2)])])
        #expect(row(.tuning("violin"), in: detail(tune))?.text == "Capo 2")
    }

    @Test func writesTheTuningWithItsCapo() {
        let tune = Tune(
            createdAt: noon, title: "T",
            tunings: ["violin": .object(["tuning": .string("Open G (gDGBD)"), "capo": .integer(2)])])
        #expect(row(.tuning("violin"), in: detail(tune))?.text == "Open G (gDGBD), capo 2")
    }

    @Test func hasNoRowForAnUnplayedInstrumentWithNoValue() {
        #expect(!AttributeRows.rows(detail()).map(\.id).contains(.tuning("mandolin")))
    }

    @Test func addsATuningRowForAnUnplayedInstrumentThatHoldsAValue() {
        let tune = Tune(
            createdAt: noon, title: "T",
            tunings: ["five_string_banjo": .object(["tuning": .string("gDGBD")])])
        #expect(AttributeRows.rows(detail(tune)).map(\.id).contains(.tuning("five_string_banjo")))
    }

    @Test func leavesAnUnsetAttributeNil() {
        #expect(row(.genre, in: detail())?.text == nil)
        #expect(row(.alternateTitles, in: detail())?.text == nil)
        #expect(row(.learnedFrom, in: detail())?.text == nil)
        #expect(row(.learnedOn, in: detail())?.text == nil)
    }

    @Test func joinsAlternateTitles() {
        let tune = Tune(createdAt: noon, title: "T", alternateTitles: ["A", "B"])
        #expect(row(.alternateTitles, in: detail(tune))?.text == "A, B")
    }

    @Test func formatsTheLearnedOnDate() {
        #expect(row(.learnedOn, in: detail(learnedOn: "2024-03-05"))?.text == "Mar 5, 2024")
    }

    @Test func foldsPartsIntoTypeOnTheCard() {
        let tune = Tune(createdAt: noon, title: "T", genre: "Old-time", tuneType: "Reel", partStructure: "AABB")
        let (shown, more) = AttributeRows.card(AttributeRows.rows(detail(tune)))
        #expect(shown.map(\.id) == [.status, .key, .tuning("violin"), .tuneType])
        #expect(shown.first { $0.id == .tuneType }?.text == "Reel · AABB")
        #expect(
            more.map(\.id) == [
                .timeSignature, .partStructure, .genre, .composer, .alternateTitles, .learnedFrom, .learnedOn,
            ])
    }

    @Test func readsPartsAloneOnTheCardWhenTheTypeIsEmpty() {
        let tune = Tune(createdAt: noon, title: "T", partStructure: "AABB")
        let (shown, _) = AttributeRows.card(AttributeRows.rows(detail(tune)))
        #expect(shown.first { $0.id == .tuneType }?.text == "AABB")
    }

    @Test func leavesTheCardTypeNilWhenBothAreEmpty() {
        let (shown, _) = AttributeRows.card(AttributeRows.rows(detail()))
        #expect(shown.first { $0.id == .tuneType }?.text == nil)
    }

    @Test func wordsTheAddedDayAsTheDayItJoinedTheCatalog() {
        let locale = Locale(identifier: "en_US")
        let date = Date(timeIntervalSince1970: 1_709_640_000)
        #expect(AttributeCopy.addedOn(date, locale: locale, timeZone: .gmt) == "Added to catalog Mar 5, 2024")
    }

    @Test func labelsAndWritesAHeldValueForAnUnplayedInstrument() {
        let tune = Tune(
            createdAt: noon, title: "T",
            tunings: ["five_string_banjo": .object(["tuning": .string("gDGBD")])])
        let banjo = row(.tuning("five_string_banjo"), in: detail(tune))
        #expect(banjo?.label == "5-string banjo tuning")
        #expect(banjo?.text == "gDGBD")
    }

    @Test func capsTheKeyAtFourModes() {
        let tune = Tune(
            createdAt: noon, title: "T", key: "A", modes: ["major", "minor", "dorian", "mixolydian", "modal"])
        #expect(
            row(.key, in: detail(tune))?.text
                == "A major, B part minor, C part dorian, D part mixolydian")
    }

    @Test func skipsAnUnknownLaterMode() {
        let tune = Tune(createdAt: noon, title: "T", key: "A", modes: ["major", "lydian", "minor"])
        #expect(row(.key, in: detail(tune))?.text == "A major, C part minor")
    }

    @Test func showsAnUnparsableLearnedOnAsStored() {
        #expect(row(.learnedOn, in: detail(learnedOn: "last spring"))?.text == "last spring")
    }

    @Test func keepsEveryTuningOnTheCard() {
        let tune = Tune(
            createdAt: noon, title: "T",
            tunings: ["mandolin": .object(["tuning": .string("Standard (GDAE)")])])
        let (shown, _) = AttributeRows.card(AttributeRows.rows(detail(tune, instruments: ["violin", "guitar"])))
        #expect(
            shown.map(\.id) == [
                .status, .key, .tuning("violin"), .tuning("guitar"), .tuning("mandolin"), .tuneType,
            ])
    }
}
