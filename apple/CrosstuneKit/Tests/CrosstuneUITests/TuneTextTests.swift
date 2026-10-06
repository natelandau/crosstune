import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct KeyModeTextTests {
    @Test(arguments: [
        ("D", "major", "D", "D major"),
        ("D", "minor", "Dm", "D minor"),
        ("E", "dorian", "E dor", "E dorian"),
        ("A", "mixolydian", "A mix", "A mixolydian"),
        ("G", "modal", "G modal", "G modal"),
        ("G", "other", "G", "G"),
        ("G", "phrygian", "G", "G"),
    ])
    func abbreviatesTheModeForRowsAndSpellsItOutForScreenReaders(
        key: String, mode: String, shown: String, spoken: String
    ) throws {
        let text = try #require(KeyModeText(key: key, modes: [mode]))
        #expect(text.shown == shown)
        #expect(text.spoken == spoken)
    }

    @Test func showsTheFirstModeOnly() throws {
        let text = try #require(KeyModeText(key: "A", modes: ["mixolydian", "dorian"]))
        #expect(text.shown == "A mix")
    }

    @Test func showsTheKeyAloneWithNoMode() throws {
        let text = try #require(KeyModeText(key: "A", modes: []))
        #expect(text.shown == "A")
        #expect(text.spoken == "A")
    }

    @Test func showsNoModeWithoutAKey() {
        #expect(KeyModeText(key: nil, modes: ["minor"]) == nil)
        #expect(KeyModeText(key: "  ", modes: ["minor"]) == nil)
    }
}

@Suite struct TuningTextTests {
    let tunings: JSONObject = [
        "violin": .object(["tuning": .string("Standard (GDAE)")]),
        "five_string_banjo": .object(["tuning": .string("Open G (gDGBD)"), "capo": .integer(2)]),
        "guitar": .object(["capo": .integer(3)]),
        "mandolin": .object(["tuning": .string("Cross A (AEAE)")]),
        "bouzouki": .string("a shape from a newer server"),
    ]

    @Test func leavesAStandardTuningUnsaidUnlessACapoIsSet() {
        #expect(TuningText.summary(tunings, instrument: "violin") == nil)
        #expect(TuningText.summary(tunings, instrument: "five_string_banjo") == "Open G (gDGBD), capo 2")
        #expect(TuningText.summary(tunings, instrument: "mandolin") == "Cross A (AEAE)")
    }

    @Test func rowShowsOnlyPlayedInstrumentsInVocabularyOrder() {
        #expect(TuningText.row(tunings, instruments: ["mandolin"]) == "Cross A (AEAE)")
        #expect(
            TuningText.row(tunings, instruments: ["mandolin", "five_string_banjo", "violin"])
                == "5-string banjo: Open G (gDGBD), capo 2 · Mandolin: Cross A (AEAE)")
        #expect(TuningText.row(tunings, instruments: ["violin"]) == nil)
        #expect(TuningText.row(tunings, instruments: []) == nil)
    }
}

@Suite struct TuneRowTextTests {
    private func text(
        key: String? = "E", modes: [String] = ["dorian"], status: String = "learning", archived: Bool = false,
        tunings: JSONObject = [:], instruments: Set<String> = []
    ) -> TuneRowText {
        let tune = Tune(title: "Elzic's Farewell", key: key, modes: modes, tunings: tunings)
        let userTune = UserTune(tuneID: tune.id, status: status, archivedAt: archived ? noon : nil)
        return TuneRowText(tune: tune, userTune: userTune, instruments: instruments)
    }

    @Test func speaksEachPartWithACommaBetween() {
        let row = text(
            archived: true, tunings: ["violin": .object(["tuning": .string("Cross A (AEAE)")])],
            instruments: ["violin"])
        #expect(row.accessibilityLabel() == "Elzic's Farewell, Key E dorian, Learning, Cross A (AEAE), Archived")
        #expect(row.accessibilityLabel(position: 3).hasPrefix("3, Elzic's Farewell, "))
    }

    @Test func leavesOutWhatIsUnset() {
        let row = text(key: nil, status: "known")
        #expect(row.key == nil)
        #expect(row.tunings == nil)
        #expect(!row.isArchived)
        #expect(row.accessibilityLabel() == "Elzic's Farewell, Known")
    }

    @Test func rowSecondLineOnlyForTuningsCaposOrArchived() {
        let tuning: JSONObject = ["violin": .object(["tuning": .string("Cross A (AEAE)")])]
        #expect(text().secondLine == nil)
        #expect(
            text(tunings: ["violin": .object(["tuning": .string("Standard (GDAE)")])], instruments: ["violin"])
                .secondLine == nil)
        #expect(text(tunings: tuning, instruments: ["violin"]).secondLine == "Cross A (AEAE)")
        #expect(text(archived: true).secondLine == "Archived")
        #expect(
            text(archived: true, tunings: tuning, instruments: ["violin"]).secondLine == "Cross A (AEAE) · Archived")
    }

    @Test func showsAnUnrecognizedStatusAsWantToLearn() {
        #expect(text(status: "mastered").status == "want_to_learn")
    }
}

@Suite struct EditedTextTests {
    let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()
    let locale = Locale(identifier: "en_US")
    // 2026-09-25 08:00 in New York.
    let now = Date(timeIntervalSince1970: 1_790_337_600)

    private func label(hoursAgo: Double) -> String {
        let edited = Timestamp(now.addingTimeInterval(-hoursAgo * 3600))
        return EditedText.label(edited, now: now, calendar: calendar, locale: locale)
    }

    @Test func comparesLocalCalendarDays() {
        #expect(label(hoursAgo: 7) == EditedText.today)
        #expect(label(hoursAgo: 9) == EditedText.yesterday)
        #expect(label(hoursAgo: 33) == "Edited Sep 23")
    }

    @Test func addsTheYearOnlyWhenItIsNotTheCurrentOne() {
        #expect(label(hoursAgo: 24 * 400) == "Edited Aug 21, 2025")
    }

    @Test func readsAFutureEditAsToday() {
        #expect(label(hoursAgo: -30) == EditedText.today)
    }
}
