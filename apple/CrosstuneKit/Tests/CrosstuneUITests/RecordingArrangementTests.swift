import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func view(
    _ id: String, label: String? = nil, tune: String? = nil, title: String? = nil, stale: String? = nil,
    origin: String = "own", minutes: Int64, recorded: (at: String, precision: String)? = nil
) -> RecordingView {
    var recording = Recording(
        id: id, tuneID: stale ?? tune, source: "microphone", origin: origin, addedAt: later(minutes * 60_000),
        recordedAt: recorded.flatMap { Timestamp(iso: $0.at) }, recordedPrecision: recorded?.precision,
        state: "ready")
    recording.label = label
    return RecordingView(recording: recording, file: nil, tuneID: tune, tuneTitle: title)
}

private func filedUnder(_ views: [RecordingView], tune: String = "t", title: String = "T") -> [RecordingView] {
    views.map { RecordingView(recording: $0.recording, file: nil, tuneID: tune, tuneTitle: title) }
}

private func ids(_ views: [RecordingView]) -> [String] { views.map(\.id) }
private func choice(_ sort: RecordingSort, _ descending: Bool) -> SortChoice {
    SortChoice(sort: sort, descending: descending)
}

private func flat(_ filed: FiledRecordings) -> [RecordingView] {
    guard case .flat(let views) = filed else {
        Issue.record("Expected a flat arrangement")
        return []
    }
    return views
}

private func groups(_ filed: FiledRecordings) -> [TuneRecordings] {
    guard case .byTune(let groups) = filed else {
        Issue.record("Expected a byTune arrangement")
        return []
    }
    return groups
}

@Suite struct RecordingArrangementByAddedTests {
    let views = [
        view("u1", minutes: 1), view("u2", minutes: 3), view("u3", minutes: 2),
        view("f1", tune: "t", title: "T", minutes: 4), view("f2", tune: "t", title: "T", minutes: 6),
        view("f3", tune: "t", title: "T", minutes: 5),
    ]

    @Test func putsTheNewestFirstWhenDescending() {
        let result = RecordingArrangement.arrange(views, choice: choice(.added, true), query: "")
        #expect(ids(result.unfiled) == ["u2", "u3", "u1"])
        #expect(ids(flat(result.filed)) == ["f2", "f3", "f1"])
    }

    @Test func putsTheOldestFirstWhenAscending() {
        let result = RecordingArrangement.arrange(views, choice: choice(.added, false), query: "")
        #expect(ids(result.unfiled) == ["u1", "u3", "u2"])
        #expect(ids(flat(result.filed)) == ["f1", "f3", "f2"])
    }

    @Test func breaksATieBetweenEqualDatesByIDMirroredWhenReversed() {
        let tied = [
            view("b", minutes: 1), view("c", minutes: 1), view("a", minutes: 1),
            view("fb", tune: "t", title: "T", minutes: 1), view("fa", tune: "t", title: "T", minutes: 1),
        ]
        let newest = RecordingArrangement.arrange(tied, choice: choice(.added, true), query: "")
        #expect(ids(newest.unfiled) == ["c", "b", "a"])
        #expect(ids(flat(newest.filed)) == ["fb", "fa"])
        let oldest = RecordingArrangement.arrange(tied.reversed(), choice: choice(.added, false), query: "")
        #expect(ids(oldest.unfiled) == ["a", "b", "c"])
        #expect(ids(flat(oldest.filed)) == ["fa", "fb"])
        let byTune = RecordingArrangement.arrange(tied, choice: choice(.tune, false), query: "")
        #expect(groups(byTune.filed).first.map { ids($0.views) } == ["fb", "fa"])
    }

    @Test func doesNotReorderItsInput() {
        let before = ids(views)
        _ = RecordingArrangement.arrange(views, choice: .default, query: "")
        #expect(ids(views) == before)
    }
}

@Suite struct RecordingArrangementByRecordedTests {
    let views = [
        view("time", minutes: 1, recorded: ("1998-10-03T16:12:00Z", "time")),
        view("day", minutes: 2, recorded: ("1937-05-12T00:00:00Z", "day")),
        view("month", minutes: 3, recorded: ("1998-05-01T00:00:00Z", "month")),
        view("year", minutes: 4, recorded: ("1937-01-01T00:00:00Z", "year")),
        view("none1", minutes: 5), view("none2", minutes: 6),
    ]

    @Test func putsTheNewestFirstAYearAtItsStartAndUnknownDatesLast() {
        let result = RecordingArrangement.arrange(views, choice: choice(.recorded, true), query: "")
        #expect(ids(result.unfiled) == ["time", "month", "day", "year", "none2", "none1"])
    }

    @Test func putsTheOldestFirstAndStillLeavesUnknownDatesLast() {
        let result = RecordingArrangement.arrange(views, choice: choice(.recorded, false), query: "")
        #expect(ids(result.unfiled) == ["year", "day", "month", "time", "none1", "none2"])
    }

    @Test func ordersTheFlatFiledListTheSameWay() {
        let result = RecordingArrangement.arrange(filedUnder(views), choice: choice(.recorded, true), query: "")
        #expect(ids(flat(result.filed)) == ["time", "month", "day", "year", "none2", "none1"])
    }

    @Test func treatsADateWhosePrecisionThisClientPredatesAsUnknown() {
        let odd = [
            view("newer", minutes: 1, recorded: ("1930-01-01T00:00:00Z", "decade")),
            view("year", minutes: 2, recorded: ("1937-01-01T00:00:00Z", "year")),
        ]
        for descending in [true, false] {
            let result = RecordingArrangement.arrange(odd, choice: choice(.recorded, descending), query: "")
            #expect(ids(result.unfiled) == ["year", "newer"])
        }
    }

    @Test func breaksATieByDateAddedThenByID() {
        let year = ("1937-01-01T00:00:00Z", "year")
        let tied = [
            view("b", minutes: 1, recorded: year), view("a", minutes: 1, recorded: year),
            view("c", minutes: 2, recorded: year),
        ]
        #expect(
            ids(RecordingArrangement.arrange(tied, choice: choice(.recorded, true), query: "").unfiled) == [
                "c", "b", "a",
            ])
        #expect(
            ids(RecordingArrangement.arrange(tied, choice: choice(.recorded, false), query: "").unfiled) == [
                "a", "b", "c",
            ])
    }
}

@Suite struct RecordingArrangementByTitleTests {
    let views = [
        view("b", label: "banjo", minutes: 1), view("a", label: "Álpha", minutes: 2),
        view("c", label: "cello", minutes: 3), view("n1", minutes: 4), view("n2", minutes: 5),
    ]

    @Test func ordersTitledWithTheCollatorThenUntitledNewestAddedFirst() {
        let result = RecordingArrangement.arrange(views, choice: choice(.title, false), query: "")
        #expect(ids(result.unfiled) == ["a", "b", "c", "n2", "n1"])
    }

    @Test func reversesTitledAndStillPutsUntitledLastOldestAddedFirst() {
        let result = RecordingArrangement.arrange(views, choice: choice(.title, true), query: "")
        #expect(ids(result.unfiled) == ["c", "b", "a", "n1", "n2"])
    }

    @Test func ordersTheFlatFiledListTheSameWay() {
        let result = RecordingArrangement.arrange(filedUnder(views), choice: choice(.title, false), query: "")
        #expect(result.unfiled.isEmpty)
        #expect(ids(flat(result.filed)) == ["a", "b", "c", "n2", "n1"])
    }

    @Test func reversesTheFlatFiledListTheSameWay() {
        let result = RecordingArrangement.arrange(filedUnder(views), choice: choice(.title, true), query: "")
        #expect(result.unfiled.isEmpty)
        #expect(ids(flat(result.filed)) == ["c", "b", "a", "n1", "n2"])
    }
}

@Suite struct RecordingArrangementByTuneTests {
    let views = [
        view("b1", tune: "tb", title: "Banks", minutes: 1), view("b2", tune: "tb", title: "Banks", minutes: 3),
        view("a1", tune: "ta", title: "Arkansas", minutes: 2), view("a2", tune: "ta", title: "Arkansas", minutes: 4),
        view("u1", minutes: 5), view("u2", minutes: 6),
    ]

    @Test func groupsByTitleAscendingNewestFirstInside() {
        let result = RecordingArrangement.arrange(views, choice: choice(.tune, false), query: "")
        let found = groups(result.filed)
        #expect(found.map(\.tuneTitle) == ["Arkansas", "Banks"])
        #expect(found.map { ids($0.views) } == [["a2", "a1"], ["b2", "b1"]])
        #expect(ids(result.unfiled) == ["u2", "u1"])
    }

    @Test func reversesTheGroupsOnlyWhenDescending() {
        let result = RecordingArrangement.arrange(views, choice: choice(.tune, true), query: "")
        let found = groups(result.filed)
        #expect(found.map(\.tuneTitle) == ["Banks", "Arkansas"])
        #expect(found.map { ids($0.views) } == [["b2", "b1"], ["a2", "a1"]])
        #expect(ids(result.unfiled) == ["u1", "u2"])
    }

    @Test func putsOwnRecordingsBeforeImportedOnesInsideAGroupEachNewestAddedFirst() {
        let mixed = [
            view("i1", tune: "t", title: "T", origin: "slippery_hill", minutes: 1),
            view("o1", tune: "t", title: "T", minutes: 2),
            view("i2", tune: "t", title: "T", origin: "slippery_hill", minutes: 4),
            view("o2", tune: "t", title: "T", minutes: 3),
        ]
        for descending in [false, true] {
            let found = groups(RecordingArrangement.arrange(mixed, choice: choice(.tune, descending), query: "").filed)
            #expect(found.first.map { ids($0.views) } == ["o2", "o1", "i2", "i1"])
        }
    }

    @Test func keepsTwoTunesWithOneTitleAsTwoGroupsOrderedByID() {
        let same = [
            view("x2", tune: "t2", title: "Soldier's Joy", minutes: 1),
            view("x1", tune: "t1", title: "Soldier's Joy", minutes: 2),
        ]
        let result = RecordingArrangement.arrange(same, choice: choice(.tune, false), query: "")
        #expect(groups(result.filed).map(\.tuneID) == ["t1", "t2"])
    }
}

@Suite struct RecordingArrangementFilingTests {
    @Test func leavesARecordingWhoseTuneIsGoneUnfiled() {
        let result = RecordingArrangement.arrange(
            [view("r", tune: nil, stale: "deleted", minutes: 1)], choice: .default, query: "")
        #expect(ids(result.unfiled) == ["r"])
        #expect(flat(result.filed).isEmpty)
    }
}

@Suite struct RecordingArrangementSearchTests {
    let views = [
        view("s", label: "fast", tune: "t", title: "Soldier's Joy", minutes: 1),
        view("a", label: "Álpha", minutes: 2), view("n", minutes: 3),
    ]

    @Test func matchesTheTuneTitleTrimmedAndIgnoringCase() {
        let result = RecordingArrangement.arrange(views, choice: .default, query: "  soldier ")
        #expect(ids(flat(result.filed)) == ["s"])
        #expect(result.unfiled.isEmpty)
    }

    @Test func matchesALabelIgnoringCaseAndAccents() {
        let result = RecordingArrangement.arrange(views, choice: .default, query: "ALPHA")
        #expect(ids(result.unfiled) == ["a"])
        #expect(flat(result.filed).isEmpty)
    }

    @Test func doesNotMatchThePlaceholderNameOfAnUntitledRecording() {
        let result = RecordingArrangement.arrange(views, choice: .default, query: "Recording")
        #expect(result.unfiled.isEmpty)
    }

    @Test func treatsOnlySpacesAsNoQuery() {
        let result = RecordingArrangement.arrange(views, choice: .default, query: "   ")
        #expect(ids(result.unfiled) == ["n", "a"])
        #expect(ids(flat(result.filed)) == ["s"])
    }

    @Test func returnsEmptyListsWhenNothingMatches() {
        let flatResult = RecordingArrangement.arrange(views, choice: .default, query: "zzz")
        #expect(flatResult.unfiled.isEmpty)
        #expect(flat(flatResult.filed).isEmpty)
        let tuneResult = RecordingArrangement.arrange(views, choice: choice(.tune, false), query: "zzz")
        #expect(tuneResult.unfiled.isEmpty)
        #expect(groups(tuneResult.filed).isEmpty)
    }
}

@Suite struct SortChoiceTests {
    @Test func defaultsToDateAddedNewestFirst() {
        #expect(SortChoice.default == choice(.added, true))
        #expect(SortChoice.storageKey == "recordingsSort.v2")  // gitleaks:allow -- a defaults key, not a secret
    }

    @Test func reversesTheCurrentSortWhenPickedAgain() {
        #expect(choice(.added, true).picking(.added) == choice(.added, false))
        #expect(choice(.recorded, true).picking(.recorded) == choice(.recorded, false))
    }

    @Test func startsADifferentSortAtItsFirstDirection() {
        #expect(choice(.added, true).picking(.title) == choice(.title, false))
        #expect(choice(.title, true).picking(.tune) == choice(.tune, false))
        #expect(choice(.title, false).picking(.recorded) == choice(.recorded, true))
        #expect(choice(.recorded, false).picking(.added) == choice(.added, true))
    }

    @Test func roundTripsThroughItsRawValue() {
        for sort in RecordingSort.allCases {
            for descending in [true, false] {
                let original = choice(sort, descending)
                #expect(SortChoice(rawValue: original.rawValue) == original)
            }
        }
        #expect(SortChoice.default.rawValue == "added.desc")
        #expect(SortChoice(rawValue: "bogus") == nil)
        #expect(SortChoice(rawValue: "title.sideways") == nil)
    }

    @Test func namesEachDirection() {
        #expect(RecordingsListText.direction(choice(.added, true)) == RecordingsListText.newestFirst)
        #expect(RecordingsListText.direction(choice(.added, false)) == RecordingsListText.oldestFirst)
        #expect(RecordingsListText.direction(choice(.recorded, true)) == RecordingsListText.newestFirst)
        #expect(RecordingsListText.direction(choice(.recorded, false)) == RecordingsListText.oldestFirst)
        #expect(RecordingsListText.direction(choice(.title, false)) == RecordingsListText.aToZ)
        #expect(RecordingsListText.direction(choice(.tune, true)) == RecordingsListText.zToA)
        #expect(RecordingsListText.newestFirst == "Newest first")
        #expect(RecordingsListText.oldestFirst == "Oldest first")
        #expect(RecordingsListText.aToZ == "A to Z")
        #expect(RecordingsListText.zToA == "Z to A")
    }

    @Test func labelsEachSort() {
        #expect(
            RecordingSort.allCases.map(RecordingsListText.label) == ["Date added", "Date recorded", "Title", "Tune"])
        #expect(RecordingsListText.openTune("Banks") == "Open Banks")
    }
}

@Suite struct RecordingSortChoicesTests {
    @Test func showsTheDirectionOnTheCheckedItemOnly() {
        let items = RecordingSortChoices.items(for: .default)
        #expect(items.map(\.label) == ["Date added", "Date recorded", "Title", "Tune"])
        #expect(items.map(\.isChecked) == [true, false, false, false])
        #expect(items.map(\.direction) == [RecordingsListText.newestFirst, nil, nil, nil])
        #expect(items.map(\.directionSymbol) == ["arrow.down", nil, nil, nil])

        let title = RecordingSortChoices.items(for: choice(.title, false))
        #expect(title.map(\.direction) == [nil, nil, RecordingsListText.aToZ, nil])
        #expect(title.map(\.directionSymbol) == [nil, nil, "arrow.up", nil])
        let oldest = RecordingSortChoices.items(for: choice(.recorded, false))
        #expect(oldest.map(\.direction) == [nil, RecordingsListText.oldestFirst, nil, nil])
        #expect(oldest.map(\.directionSymbol) == [nil, "arrow.up", nil, nil])
    }

    @Test func reChoosingTheCheckedItemReversesItsSort() {
        // A menu toggle turns the checked item off when it is chosen again.
        #expect(RecordingSortChoices.toggled(.added, isOn: false, from: .default) == choice(.added, false))
        #expect(RecordingSortChoices.toggled(.title, isOn: false, from: choice(.title, false)) == choice(.title, true))
        #expect(RecordingSortChoices.toggled(.tune, isOn: true, from: .default) == choice(.tune, false))
        #expect(RecordingSortChoices.toggled(.recorded, isOn: true, from: .default) == choice(.recorded, true))
    }
}
