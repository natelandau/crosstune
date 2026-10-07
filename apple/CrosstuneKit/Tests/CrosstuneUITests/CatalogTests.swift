import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func tune(
    _ id: String, _ title: String, alternateTitles: [String] = [], composer: String? = nil, genre: String? = nil,
    type: String? = nil, key: String? = nil, modes: [String] = [], tunings: JSONObject = [:], deleted: Bool = false
) -> Tune {
    Tune(
        id: id, createdAt: noon, deletedAt: deleted ? noon : nil, title: title, alternateTitles: alternateTitles,
        composer: composer, genre: genre, tuneType: type, key: key, modes: modes, tunings: tunings)
}

private func userTune(
    _ id: String, _ tuneID: String, status: String = "known", archived: Bool = false, learnedFrom: String? = nil
) -> UserTune {
    UserTune(
        id: id, createdAt: noon, tuneID: tuneID, status: status, learnedFrom: learnedFrom,
        archivedAt: archived ? noon : nil)
}

private func tunings(_ pairs: [String: String]) -> JSONObject {
    pairs.mapValues { .object(["tuning": .string($0)]) }
}

private let catalog = CatalogSearch.entries(
    tunes: [
        tune(
            "s1", "soldier's joy", genre: "Old-time", key: "D", modes: ["major"],
            tunings: tunings(["violin": "ADAE", "five_string_banjo": "gDGBD"])),
        tune("s2", "Cluck Old Hen", alternateTitles: ["Cluck"], key: "A", modes: ["mixolydian"]),
        tune("s3", "Deleted", deleted: true),
        tune("s4", "Angeline the Baker", key: "D"),
        tune("s5", "Orphan", key: "G"),
    ],
    userTunes: [
        userTune("u1", "s1"),
        userTune("u2", "s2", status: "learning"),
        userTune("u3", "s3"),
        userTune("u4", "s4", status: "want_to_learn", archived: true),
    ])

private func ids(_ entries: [CatalogEntry]) -> [String] { entries.map(\.tune.id) }

private let blankAndSentinel = CatalogSearch.entries(
    tunes: [
        tune("b1", "A", genre: "\u{300}", key: "None"), tune("b2", "B", genre: "  ", key: "D"),
        tune("b3", "C", genre: "All", key: "G"),
    ],
    userTunes: [userTune("ub1", "b1"), userTune("ub2", "b2"), userTune("ub3", "b3")])

@Suite struct CatalogFilteringTests {
    @Test func joinsActivePairsAndSortsByTitleIgnoringCase() {
        #expect(ids(catalog) == ["s4", "s2", "s1"])
    }

    @Test func hidesArchivedTunesUnlessAsked() {
        #expect(ids(CatalogSearch.filter(catalog, by: .default)) == ["s2", "s1"])
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(archived: true))) == ["s4", "s2", "s1"])
    }

    @Test func matchesTheQueryAgainstTitlesAlternateTitlesAndComposers() {
        #expect(ids(CatalogSearch.filter(catalog, by: .default, query: "SOLD")) == ["s1"])
        #expect(ids(CatalogSearch.filter(catalog, by: .default, query: " cluck ")) == ["s2"])
        let reavy = CatalogSearch.entries(
            tunes: [tune("r1", "Lucy Farr", composer: "Ed Reavy")], userTunes: [userTune("ru1", "r1")])
        #expect(ids(CatalogSearch.filter(reavy, by: .default, query: "reavy")) == ["r1"])
    }

    @Test func ignoresAccentsWhenMatching() {
        let accented = CatalogSearch.entries(
            tunes: [tune("e1", "Été Waltz")], userTunes: [userTune("eu1", "e1")])
        #expect(ids(CatalogSearch.filter(accented, by: .default, query: "ete waltz")) == ["e1"])
        #expect(ids(CatalogSearch.filter(accented, by: .default, query: "ETE")) == ["e1"])
    }

    @Test func matchesAFacetValueTheSharedFoldCallsTheSame() {
        let spelled = CatalogSearch.entries(
            tunes: [tune("f1", "A", genre: " Fe\u{302}te "), tune("f2", "B", genre: "Fete Noire")],
            userTunes: [userTune("fu1", "f1"), userTune("fu2", "f2")])
        #expect(ids(CatalogSearch.filter(spelled, by: CatalogFilters(facets: [.genre: "F\u{EA}TE"]))) == ["f1"])
    }

    @Test func offersNoOptionAStoredFilterWouldReadAsAnyOrNoKeyOrTheFoldCallsBlank() {
        let values = CatalogSearch.facetValues(blankAndSentinel)
        #expect(values[.key] == ["D", "G"])
        #expect(values[.genre] == [])
    }

    @Test func readsAValueThatFoldsToNothingAsMissingAndMatchesNoFilterWithIt() {
        #expect(ids(CatalogSearch.filter(blankAndSentinel, by: CatalogFilters(missing: .genre))) == ["b1", "b2"])
        #expect(CatalogSearch.filter(blankAndSentinel, by: CatalogFilters(facets: [.genre: "\u{301}"])).isEmpty)
    }

    @Test func tellsWhichValuesCanBeAFilter() {
        #expect(CatalogSearch.isFilterValue("Irish", for: .genre))
        #expect(!CatalogSearch.isFilterValue(" ALL ", for: .genre))
        #expect(!CatalogSearch.isFilterValue("\u{300}", for: .genre))
        #expect(CatalogSearch.isFilterValue("None", for: .genre))
        #expect(!CatalogSearch.isFilterValue("n\u{F3}ne", for: .key))
    }

    @Test func filtersByStatusAndEachFacet() {
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(status: "learning"))) == ["s2"])
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(facets: [.key: "D"]))) == ["s1"])
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(facets: [.mode: "mixolydian"]))) == ["s2"])
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(facets: [.genre: "old-time"]))) == ["s1"])
        #expect(ids(CatalogSearch.filter(catalog, by: CatalogFilters(facets: [.tuning("violin"): "ADAE"]))) == ["s1"])
        #expect(
            CatalogSearch.filter(catalog, by: CatalogFilters(facets: [.tuning("five_string_banjo"): "gCGCD"])).isEmpty)
    }

    @Test func matchesAModeHeldByAnyPart() {
        let kesh = CatalogSearch.entries(
            tunes: [tune("k1", "The Kesh", modes: ["major", "mixolydian"]), tune("k2", "Sally Ann")],
            userTunes: [userTune("ku1", "k1"), userTune("ku2", "k2")])
        #expect(ids(CatalogSearch.filter(kesh, by: CatalogFilters(facets: [.mode: "mixolydian"]))) == ["k1"])
        #expect(CatalogSearch.filter(kesh, by: .default).count == 2)
        #expect(CatalogSearch.facetValues(kesh)[.mode] == ["major", "mixolydian"])
    }

    @Test func listsDistinctSortedFacetValuesArchivedIncluded() {
        let values = CatalogSearch.facetValues(catalog)
        #expect(values[.key] == ["A", "D"])
        #expect(values[.mode] == ["major", "mixolydian"])
        #expect(values[.tuning("violin")] == ["ADAE"])
        #expect(values[.tuning("five_string_banjo")] == ["gDGBD"])
        #expect(values[.genre] == ["Old-time"])
        #expect(values[.tuneType] == [])
    }

    @Test func foldsSpellingsThatDifferOnlyByCaseIntoOneOption() {
        let entries = CatalogSearch.entries(
            tunes: [tune("a", "A", genre: "old-time", key: "D"), tune("b", "B", genre: "Old-Time", key: "d")],
            userTunes: [userTune("ua", "a"), userTune("ub", "b")])
        let values = CatalogSearch.facetValues(entries)
        #expect(values[.key] == ["D"])
        #expect(values[.genre] == ["Old-Time"])
        #expect(CatalogSearch.filter(entries, by: CatalogFilters(facets: [.key: "D"])).count == 2)
    }

    @Test func offersAFacetOnlyWithValuesAndATuningOnlyForAPlayedInstrument() {
        let values = CatalogSearch.facetValues(catalog)
        #expect(
            CatalogSearch.visibleFacets(values, instruments: ["violin"]) == [.key, .mode, .tuning("violin"), .genre])
        #expect(
            CatalogSearch.visibleFacets(values, instruments: ["five_string_banjo"])
                == [.key, .mode, .tuning("five_string_banjo"), .genre])
    }

    @Test func clearsHiddenFacets() {
        let filters = CatalogFilters(
            status: "known", facets: [.key: "D", .tuneType: "Reel", .tuning("guitar"): "DADGAD"], archived: true)
        let cleared = filters.clearingHidden(visible: [.key, .mode, .genre])
        #expect(cleared == CatalogFilters(status: "known", facets: [.key: "D"], archived: true))
    }

    @Test func labelsTheCountsTheSameWayEverywhere() {
        #expect(CatalogSearch.countLabel(visible: 84, total: 84) == "84 tunes")
        #expect(CatalogSearch.countLabel(visible: 11, total: 84) == "11 of 84 tunes")
        #expect(CatalogSearch.countLabel(visible: 1, total: 84) == "1 of 84 tunes")
        #expect(CatalogSearch.countLabel(visible: 1, total: 1) == "1 tune")
        #expect(CatalogSearch.countLabel(visible: 0, total: 0) == "0 tunes")
    }

    @Test func countsTheSheetsFiltersAndResetsOnlyThem() {
        let filters = CatalogFilters(
            status: "learning", facets: [.key: "D", .tuneType: "Reel", .genre: "Irish", .mode: "dorian"],
            archived: true)
        #expect(filters.sheetCount == 4)
        #expect(filters.sheetReset == CatalogFilters(status: "learning", facets: [.key: "D"]))
        #expect(CatalogFilters(status: "known", facets: [.key: "D"]).sheetCount == 0)
        #expect(FiltersButton.name(setCount: 0) == "Filters")
        #expect(FiltersButton.name(setCount: 2) == "Filters, 2 set")
    }

    @Test func keepsKeyOnTheScreenAndTheRestInTheSheet() {
        #expect(CatalogFacet.all.filter { !$0.isInSheet } == [.key])
        #expect(CatalogFacet.tuneType.isInSheet && CatalogFacet.tuning("violin").isInSheet)
        #expect(CatalogFacet.mode.isInSheet && CatalogFacet.genre.isInSheet)
    }

    @Test func showsASetKeyOnItsControlAndASetTypeAsAToken() {
        let filters = CatalogFilters(status: "learning", facets: [.key: "D", .tuneType: "Reel", .genre: "Irish"])
        #expect(CatalogFilterRow.setFilters(filters).map(\.label) == ["Reel", "Irish"])
    }

    @Test func keepsAStaleSetValueAsAChoiceWithoutDuplicatingAHeldOne() {
        #expect(CatalogSearch.choices(["A", "D"], set: "Bb") == ["A", "D", "Bb"])
        #expect(CatalogSearch.choices(["A", "D"], set: "D") == ["A", "D"])
        #expect(CatalogSearch.choices(["A", "D"], set: nil) == ["A", "D"])
        #expect(CatalogSearch.selected(["A", "D"], set: "Bb") == "Bb")
        #expect(CatalogSearch.selected(["A", "D"], set: nil) == nil)
    }

    @Test func offersOneOptionForASetValueTheFoldCallsTheSameAsAFacetValue() {
        // The stats row for these shows "Bruce Molsky", the spelling most of them hold, and a tap
        // on it stores that spelling, though the tune that sorts first holds another.
        let entries = CatalogSearch.entries(
            tunes: [tune("m1", "A Tune"), tune("m2", "B Tune"), tune("m3", "C Tune")],
            userTunes: [
                userTune("mu1", "m1", learnedFrom: "bruce molsky"), userTune("mu2", "m2", learnedFrom: "Bruce Molsky"),
                userTune("mu3", "m3", learnedFrom: "Bruce Molsky"),
            ])
        let values = CatalogSearch.facetValues(entries)[.learnedFrom] ?? []
        #expect(values == ["Bruce Molsky"])
        #expect(CatalogSearch.choices(values, set: "Bruce Molsky") == ["Bruce Molsky"])
        #expect(CatalogSearch.selected(values, set: "Bruce Molsky") == "Bruce Molsky")
        #expect(CatalogSearch.choices(values, set: " bruce MOLSKY") == ["Bruce Molsky"])
        #expect(CatalogSearch.selected(values, set: " bruce MOLSKY") == "Bruce Molsky")
    }

    @Test func showsEachSetFilterAsARemovableCapsule() {
        let filters = CatalogFilters(
            status: "known", facets: [.key: "D", .genre: "Irish", .tuning("violin"): "Cross A (AEAE)"], archived: true)
        let set = CatalogFilterRow.setFilters(filters)
        #expect(set.map(\.label) == ["Violin: Cross A (AEAE)", "Irish", "Archived shown"])
        #expect(set.map(\.id) == ["tuning:violin", "genre", "archived"])
        var removed = filters
        set[0].remove(&removed)
        #expect(removed == CatalogFilters(status: "known", facets: [.key: "D", .genre: "Irish"], archived: true))
        set[2].remove(&removed)
        #expect(!removed.archived)
    }

    @Test func namesTheFieldOnAComposerOrLearnedFromCapsuleSoOnePersonStaysApart() {
        let filters = CatalogFilters(facets: [.composer: "Ed Haley", .learnedFrom: "Ed Haley"])
        #expect(
            CatalogFilterRow.setFilters(filters).map(\.label) == [
                "\(TuneFieldLabels.composer): Ed Haley", "\(TuneFieldLabels.learnedFrom): Ed Haley",
            ])
    }

    @Test func findsTunesWithNoKey() {
        let entries = CatalogSearch.entries(
            tunes: [tune("n1", "Keyed", key: "D"), tune("n2", "Nil key"), tune("n3", "Blank key", key: "  ")],
            userTunes: [userTune("nu1", "n1"), userTune("nu2", "n2"), userTune("nu3", "n3")])
        let filters = CatalogFilters(facets: [.key: CatalogFilters.noKey])
        #expect(ids(CatalogSearch.filter(entries, by: filters)) == ["n3", "n2"])
        // No key leads the key choices, and a blank key is never a choice of its own.
        #expect(CatalogSearch.facetValues(entries)[.key] == [CatalogFilters.noKey, "D"])
    }

    @Test func offersNoKeyOnlyBesideAKeyItWouldNarrow() {
        let keyless = CatalogSearch.entries(tunes: [tune("n2", "Nil key")], userTunes: [userTune("nu2", "n2")])
        #expect(CatalogSearch.facetValues(keyless)[.key] == [])
        let keyed = CatalogSearch.entries(tunes: [tune("n1", "Keyed", key: "D")], userTunes: [userTune("nu1", "n1")])
        #expect(CatalogSearch.facetValues(keyed)[.key] == ["D"])
    }

    @Test func keepsAStaleNoKeyFilterFirstAndNamesItInWords() {
        #expect(CatalogSearch.choices(["A", "D"], set: CatalogFilters.noKey) == [CatalogFilters.noKey, "A", "D"])
        #expect(CatalogFacet.key.valueLabel(CatalogFilters.noKey) == KeyChooser.unknownKey)
        #expect(CatalogFacet.key.valueLabel("D") == "D")
        let filters = CatalogFilters(facets: [.key: CatalogFilters.noKey])
        #expect(CatalogFacet.key.capsuleLabel(CatalogFilters.noKey) == KeyChooser.unknownKey)
        #expect(CatalogFilters(stored: filters.stored) == filters)
    }

    @Test func labelsFacetsAsTheWebDoes() {
        #expect(CatalogFacet.all.map(\.label).prefix(3) == ["Key", "Type", "Mode"])
        #expect(CatalogFacet.tuning("tenor_banjo").label == "Tenor banjo tuning")
        #expect(CatalogFilterSheet.archivedFooter(1) == "1 archived tune")
        #expect(CatalogFilterSheet.archivedFooter(3) == "3 archived tunes")
    }
}

@Suite struct ComposerAndLearnedFromTests {
    private let entries = CatalogSearch.entries(
        tunes: [
            tune("c1", "Sally Ann", composer: "Ed Haley"), tune("c2", "Lucy Farr", composer: "ed haley"),
            tune("c3", "Plain Title"), tune("c4", "Blank", composer: "  "),
        ],
        userTunes: [
            userTune("cu1", "c1", learnedFrom: "Bruce Molsky"), userTune("cu2", "c2", learnedFrom: " bruce molsky "),
            userTune("cu3", "c3", archived: true, learnedFrom: "   "), userTune("cu4", "c4"),
        ])

    private func shown(_ filters: CatalogFilters, query: String = "") -> [String] {
        ids(CatalogSearch.filter(entries, by: filters, query: query))
    }

    @Test func filtersByTheUsersLearnedFromIgnoringCaseAndPadding() {
        #expect(shown(CatalogFilters(facets: [.learnedFrom: "bruce molsky"])) == ["c2", "c1"])
    }

    @Test func filtersByTheTunesComposer() {
        #expect(shown(CatalogFilters(facets: [.composer: "ED HALEY"])) == ["c2", "c1"])
    }

    @Test func offersOneValuePerSpellingAndNoneForBlanksArchivedIncluded() {
        let values = CatalogSearch.facetValues(entries)
        #expect(values[.learnedFrom]?.count == 1)
        #expect(values[.composer]?.count == 1)
        let archived = CatalogSearch.entries(
            tunes: [tune("a1", "A")], userTunes: [userTune("au1", "a1", archived: true, learnedFrom: "Kevin")])
        #expect(CatalogSearch.facetValues(archived)[.learnedFrom] == ["Kevin"])
    }

    @Test func neverOffersAllAsALearnedFrom() {
        #expect(!CatalogSearch.isFilterValue("All", for: .learnedFrom))
        let all = CatalogSearch.entries(tunes: [tune("x", "X")], userTunes: [userTune("xu", "x", learnedFrom: "All")])
        #expect(CatalogSearch.facetValues(all)[.learnedFrom] == [])
    }

    @Test func offersBothFacetsAfterGenreAndKeepsThemOffTheScreen() {
        #expect(CatalogFacet.all.suffix(3) == [.genre, .composer, .learnedFrom])
        let values = CatalogSearch.facetValues(entries)
        #expect(CatalogSearch.visibleFacets(values, instruments: []) == [.composer, .learnedFrom])
        #expect(!CatalogFacet.onScreen.contains(.composer) && !CatalogFacet.onScreen.contains(.learnedFrom))
        #expect(CatalogFacet.composer.label == TuneFieldLabels.composer)
        #expect(CatalogFacet.learnedFrom.label == TuneFieldLabels.learnedFrom)
    }

    @Test func storesBothUnderTheWebsKeysAndReadsAbsentOnesAsAny() {
        let filters = CatalogFilters(facets: [.composer: "Ed Haley", .learnedFrom: "Bruce Molsky"])
        guard case .object(let object) = filters.stored else {
            Issue.record("not an object")
            return
        }
        #expect(object["composer"] == .string("Ed Haley") && object["learned_from"] == .string("Bruce Molsky"))
        #expect(CatalogFilters(stored: filters.stored) == filters)
        let old = CatalogFilters(stored: .object(["status": .string("known"), "genre": .string("Irish")]))
        #expect(old[.composer] == nil && old[.learnedFrom] == nil)
    }

    @Test func searchesTheLearnedFrom() {
        let kevin = CatalogSearch.entries(
            tunes: [tune("k", "Plain Title")], userTunes: [userTune("ku", "k", learnedFrom: "Kevin Wimmer")])
        #expect(ids(CatalogSearch.filter(kevin, by: .default, query: "kev")) == ["k"])
    }

    @Test func missingLearnedFromReadsTheUsersRow() {
        let held = CatalogSearch.entries(tunes: [tune("m", "M")], userTunes: [userTune("mu", "m", learnedFrom: "Sam")])
        #expect(!MissingAttribute.learnedFrom.isMissing(in: held[0]))
        #expect(MissingAttribute.learnedFrom.isMissing(in: catalog[0]))
    }
}

@Suite struct UnheardAndMissingTests {
    private let entries = CatalogSearch.entries(
        tunes: [
            tune(
                "a", "Alpha", composer: "Ed Reavy", genre: "Irish", key: "D", modes: ["major"],
                tunings: tunings(["violin": "ADAE"])),
            tune("b", "Bravo", composer: "  ", key: " "),
            tune("c", "Charlie", modes: [""]),
        ],
        userTunes: [userTune("ua", "a"), userTune("ub", "b"), userTune("uc", "c")],
        heard: ["a"])

    private func shown(_ filters: CatalogFilters) -> [String] { ids(CatalogSearch.filter(entries, by: filters)) }

    @Test func hidesHeardTunesWhenUnheard() {
        #expect(shown(CatalogFilters(unheard: true)) == ["b", "c"])
        #expect(shown(.default) == ["a", "b", "c"])
    }

    @Test func findsTunesMissingAnAttribute() {
        #expect(shown(CatalogFilters(missing: .composer)) == ["b", "c"])
        #expect(shown(CatalogFilters(missing: .key)) == ["b", "c"])
        #expect(shown(CatalogFilters(missing: .mode)) == ["b", "c"])
        #expect(shown(CatalogFilters(missing: .tuning("violin"))) == ["b", "c"])
        #expect(shown(CatalogFilters(missing: .genre)) == ["b", "c"])
        #expect(shown(CatalogFilters(missing: .learnedFrom)) == ["a", "b", "c"])
        #expect(shown(CatalogFilters(unheard: true, missing: .composer)) == ["b", "c"])
    }

    @Test func offersOnlyAttributesSomeTuneHolds() {
        #expect(
            CatalogSearch.missingChoices(entries)
                == [.key, .mode, .genre, .composer, .tuning("violin")])
    }

    @Test func offersAMissingTuningOnlyForAPlayedInstrument() {
        let violin = CatalogOverview(entries: catalog, instruments: ["violin"]).missingChoices
        #expect(violin.contains(.tuning("violin")))
        #expect(!violin.contains(.tuning("five_string_banjo")))
        #expect(CatalogOverview(entries: catalog, instruments: []).missingChoices.allSatisfy { $0.tuningFacet == nil })
    }

    @Test func marksHeardTunesOnTheEntry() {
        #expect(entries.map(\.heard) == [true, false, false])
        #expect(CatalogSearch.entries(tunes: [tune("a", "A")], userTunes: [userTune("ua", "a")]).first?.heard == false)
    }

    @Test func keepsAStaleMissingAttributeAsAnOption() {
        let overview = CatalogOverview(entries: entries, instruments: ["violin"])
        let filters = CatalogFilters(missing: .timeSignature)
        let results = CatalogResults(
            entries: entries, instruments: [], filters: filters, facetValues: [:], facets: [], visible: [],
            outcome: .none, total: 0, archivedCount: 0, missingChoices: overview.missingChoices)
        #expect(results.missingOptions.last == .timeSignature)
    }

    @Test func clearsAMissingTuningForAnInstrumentNotPlayed() {
        let filters = CatalogFilters(missing: .tuning("guitar"))
        #expect(filters.clearingHidden(visible: [.tuning("violin")]).missing == nil)
        #expect(filters.clearingHidden(visible: [.tuning("guitar")]).missing == .tuning("guitar"))
        #expect(CatalogFilters(missing: .composer).clearingHidden(visible: []).missing == .composer)
    }

    @Test func countsAndResetsBothInTheSheet() {
        let filters = CatalogFilters(status: "known", unheard: true, missing: .key)
        #expect(filters.sheetCount == 2)
        #expect(filters.sheetReset == CatalogFilters(status: "known"))
    }

    @Test func showsCapsulesForBoth() {
        let set = CatalogFilterRow.setFilters(CatalogFilters(unheard: true, missing: .tuning("violin")))
        #expect(
            set.map(\.label) == [
                CatalogFilterRow.unheardShown, "\(CatalogFilterSheet.missing) Violin tuning",
            ])
        var removed = CatalogFilters(unheard: true, missing: .key)
        set[0].remove(&removed)
        #expect(removed == CatalogFilters(missing: .key))
    }

    @Test func storedWebShapeRoundTrips() {
        let filters = CatalogFilters(unheard: true, missing: .learnedOn)
        guard case .object(let object) = filters.stored else {
            Issue.record("not an object")
            return
        }
        #expect(object["unheard"] == .bool(true) && object["missing"] == .string("learned_on"))
        #expect(CatalogFilters(stored: filters.stored) == filters)
        let tuning = CatalogFilters(missing: .tuning("violin"))
        #expect(tuning.stored == CatalogFilters(stored: tuning.stored).stored)
        guard case .object(let t) = tuning.stored else {
            Issue.record("not an object")
            return
        }
        #expect(t["missing"] == .string("tuning:violin"))
    }

    @Test func readsAWebWrittenFilter() throws {
        let literal = """
            {"status":"known","key":"all","tune_type":"Reel","mode":"all","genre":"all",
             "tuning:violin":"ADAE","tuning:five_string_banjo":"all","tuning:tenor_banjo":"all",
             "tuning:guitar":"all","tuning:mandolin":"all","tuning:bouzouki":"all",
             "tuning:mountain_dulcimer":"all","archived":false,"unheard":true,"missing":"tuning:violin"}
            """
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(literal.utf8))
        #expect(
            CatalogFilters(stored: value)
                == CatalogFilters(
                    status: "known", facets: [.tuneType: "Reel", .tuning("violin"): "ADAE"], unheard: true,
                    missing: .tuning("violin")))
    }

    @Test func readsInvalidValuesAsDefaults() {
        let read = CatalogFilters(stored: .object(["unheard": .string("yes"), "missing": .string("bogus")]))
        #expect(read == .default)
        #expect(CatalogFilters(stored: .object(["missing": .string("all")])).missing == nil)
    }
}

@Suite struct CatalogFilterStorageTests {
    @Test func readsDefaultsForMissingOrMalformedValues() {
        #expect(CatalogFilters(stored: nil) == .default)
        #expect(CatalogFilters(stored: .string("nonsense")) == .default)
        #expect(CatalogFilters(stored: .object(["status": .string("bogus"), "archived": .string("yes")])) == .default)
        let read = CatalogFilters(
            stored: .object(["key": .string("A"), "archived": .bool(true), "status": .string("all")]))
        #expect(read == CatalogFilters(facets: [.key: "A"], archived: true))
    }

    @Test func readsAFilterUnderARetiredKeyAsAny() {
        let read = CatalogFilters(
            stored: .object([
                "tuning": .string("AEAE"), "violin_tuning": .string("ADAE"), "query": .string("soldier"),
            ]))
        #expect(read == .default)
        guard case .object(let object) = read.stored else {
            Issue.record("not an object")
            return
        }
        #expect(object["tuning"] == nil && object["violin_tuning"] == nil && object["query"] == nil)
    }

    @Test func storesTheWebsShapeWithEveryField() throws {
        let filters = CatalogFilters(status: "learning", facets: [.tuneType: "Reel", .tuning("violin"): "ADAE"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(filters.stored)) as? [String: Any]
        let expected: [String: Any] = [
            "status": "learning", "key": "all", "tune_type": "Reel", "mode": "all", "genre": "all",
            "composer": "all", "learned_from": "all",
            "tuning:violin": "ADAE", "tuning:five_string_banjo": "all", "tuning:tenor_banjo": "all",
            "tuning:guitar": "all", "tuning:mandolin": "all", "tuning:bouzouki": "all",
            "tuning:mountain_dulcimer": "all", "archived": false, "unheard": false, "missing": "all",
        ]
        #expect(NSDictionary(dictionary: json ?? [:]).isEqual(to: expected))
        #expect(CatalogFilters(stored: filters.stored) == filters)
    }
}

@Suite struct SearchIntentTests {
    private let entries = CatalogSearch.entries(
        tunes: [
            tune("s1", "Soldier's Joy"),
            tune("s2", "Cluck Old Hen", alternateTitles: ["Cluckin Hen"]),
            tune("s3", "Ashokan Farewell"),
            tune("s4", "Été Waltz"),
        ],
        userTunes: [
            userTune("u1", "s1"), userTune("u2", "s2"), userTune("u3", "s3", archived: true), userTune("u4", "s4"),
        ])

    private func entry(_ id: String) -> CatalogEntry { entries.first { $0.tune.id == id }! }

    @Test func offersNothingForABlankQuery() {
        #expect(SearchOutcome(entries: entries, visible: entries, query: "", archivedShown: false) == .none)
        #expect(SearchOutcome(entries: entries, visible: [], query: "   ", archivedShown: false) == .none)
    }

    @Test func offersAnotherTuneWhenAVisibleTuneHasTheTitle() {
        let outcome = SearchOutcome(
            entries: entries, visible: [entry("s1")], query: "soldier's joy", archivedShown: false)
        #expect(outcome == .create(title: "soldier's joy", another: true, hidden: nil))
        #expect(outcome.offerLabel == "Add another \"soldier's joy\"")
        #expect(
            SearchOutcome(entries: entries, visible: [entry("s2")], query: "cluckin hen", archivedShown: false)
                == .create(title: "cluckin hen", another: true, hidden: nil))
        #expect(
            SearchOutcome(entries: entries, visible: [entry("s4")], query: " ete waltz ", archivedShown: false)
                == .create(title: "ete waltz", another: true, hidden: nil))
    }

    @Test func pointsToAHiddenExactMatch() {
        let archived = SearchOutcome(entries: entries, visible: [], query: "ashokan farewell", archivedShown: false)
        #expect(archived.hidden == HiddenMatch(entry: entry("s3"), reason: .archived))
        #expect(archived.hidden?.note == "\"Ashokan Farewell\" is archived.")
        #expect(archived.hidden?.openName == "Open Ashokan Farewell")
        let filtered = SearchOutcome(
            entries: entries, visible: [entry("s2")], query: "SOLDIER'S JOY", archivedShown: false)
        #expect(filtered.hidden == HiddenMatch(entry: entry("s1"), reason: .filtered))
        #expect(filtered.hidden?.note == "\"Soldier's Joy\" is hidden by your filters.")
        #expect(
            SearchOutcome(entries: entries, visible: [], query: "Ashokan Farewell", archivedShown: true).hidden?.reason
                == .filtered)
    }

    @Test func offersToCreateTheTrimmedQueryWhenNothingMatchesExactly() {
        let outcome = SearchOutcome(entries: entries, visible: [entry("s1")], query: "  Soldier ", archivedShown: false)
        #expect(outcome == .create(title: "Soldier", another: false, hidden: nil))
        #expect(outcome.offerLabel == "Add \"Soldier\"")
    }

    @Test func returnOpensTheOnlyVisibleTuneWhateverTheOutcome() {
        let hidden = SearchOutcome.create(
            title: "Ashokan Farewell", another: true, hidden: HiddenMatch(entry: entry("s3"), reason: .archived))
        for outcome in [SearchOutcome.none, .create(title: "Soldier", another: false, hidden: nil), hidden] {
            #expect(SearchSubmit(query: "s", visible: [entry("s1")], outcome: outcome) == .open(tuneID: "s1"))
            #expect(SearchSubmit(query: "o", visible: [entry("s1"), entry("s2")], outcome: outcome) == .dismiss)
        }
        #expect(SearchSubmit(query: "s", visible: [], outcome: hidden) == .open(tuneID: "s3"))
    }

    @Test func returnCreatesOnlyWhenNothingMatches() {
        let create = SearchOutcome.create(title: "Soldier", another: false, hidden: nil)
        #expect(SearchSubmit(query: "s", visible: [], outcome: create) == .create(title: "Soldier"))
        #expect(SearchSubmit(query: "s", visible: [], outcome: .none) == .dismiss)
        #expect(SearchSubmit(query: "  ", visible: [entry("s1")], outcome: .none) == .dismiss)
    }
}

@Suite struct HeardTunesTests {
    @Test func readsHeardFromLiveRecordingsAndLinksOnly() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        let sampleHeard = Set(
            SampleCatalog.recordings.filter { $0.recording.deletedAt == nil }.compactMap(\.recording.tuneID)
                + SampleCatalog.links.filter { $0.deletedAt == nil }.map(\.tuneID))
        let quiet = try #require(SampleCatalog.entries.map(\.tune.id).first { !sampleHeard.contains($0) })
        try await store.write { writer in
            try Recording(id: "gone", deletedAt: noon, tuneID: quiet, source: "microphone", recordedAt: noon)
                .insert(writer.db)
            try Recording(id: "unfiled", tuneID: nil, source: "microphone", recordedAt: noon).insert(writer.db)
        }
        let before = try await store.read { try CatalogModel.fetchEntries($0, withHeard: true) }
        #expect(before.filter(\.heard).map(\.tune.id).sorted() == sampleHeard.sorted())
        #expect(try await store.read { try CatalogModel.fetchEntries($0) }.allSatisfy { !$0.heard })

        try await store.write { writer in
            try RecordingLink(id: "live", tuneID: quiet, url: "https://example.com/a", provider: "other")
                .insert(writer.db)
        }
        let with = try await store.read { try CatalogModel.fetchEntries($0, withHeard: true) }
        #expect(with.first { $0.tune.id == quiet }?.heard == true)
    }
}

@MainActor
@Suite struct CatalogModelTests {
    /// Waits for the model's live queries to catch up with the store.
    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    private func sampleStore(_ root: TemporaryRoot) async throws -> CrosstuneStore {
        try await SampleCatalog.makeStore(root: root.url)
    }

    @Test func showsTheWholeCatalogWithItsCounts() async throws {
        let root = TemporaryRoot()
        let model = CatalogModel(store: try await sampleStore(root))
        try await eventually { model.results != nil }
        let results = try #require(model.results)
        #expect(results.entries.count == SampleCatalog.entries.count)
        #expect(results.visible.count == SampleCatalog.entries.count - 1)
        #expect(results.archivedCount == 1)
        #expect(results.countLabel == "\(SampleCatalog.entries.count - 1) tunes")

        model.query = "farewell"
        #expect(model.results?.visible.map(\.tune.title) == ["Ashokan Farewell", "Elzic's Farewell"])
        #expect(model.results?.countLabel == "2 of \(SampleCatalog.entries.count - 1) tunes")
    }

    @Test func offersTuningsOnlyForTheInstrumentsInTheSettingsRow() async throws {
        let root = TemporaryRoot()
        let model = CatalogModel(store: try await sampleStore(root))
        try await eventually { model.results != nil }
        let facets = try #require(model.results?.facets)
        #expect(facets.contains(.tuning("violin")) && facets.contains(.tuning("five_string_banjo")))
    }

    @Test func persistsFiltersInTheWebsShapeAndClearsHiddenFacets() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        // A filter on a guitar tuning the musician does not play, stored by another client.
        try await store.setMeta(
            .catalogFilters, to: JSONValue.object(["tuning:guitar": .string("DADGAD"), "genre": .string("Irish")]))
        let model = CatalogModel(store: store)
        try await eventually { model.results?.filters.facets[.genre] == "Irish" }
        #expect(model.results?.filters == CatalogFilters(facets: [.genre: "Irish"]))

        model.updateFilters { $0.status = "learning" }
        #expect(model.results?.filters.status == "learning")
        try await eventually { !model.isSavingFilters }
        let stored = CatalogFilters(stored: try await store.meta(.catalogFilters, as: JSONValue.self))
        #expect(stored == CatalogFilters(status: "learning", facets: [.genre: "Irish"]))
        #expect(model.filterError == nil)
        #expect(model.results?.visible.map(\.tune.title) == [])
    }

    @Test func resetsAMissingTuningForAnInstrumentNotPlayed() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        try await store.setMeta(
            .catalogFilters,
            to: CatalogFilters(unheard: true, missing: .tuning("guitar")).stored)
        let model = CatalogModel(store: store)
        try await eventually { model.results?.filters.unheard == true }
        #expect(model.results?.filters.missing == nil)
    }

    @Test func picksUpAFilterChangeFromElsewhere() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        let model = CatalogModel(store: store)
        try await eventually { model.results != nil }
        try await store.setMeta(.catalogFilters, to: CatalogFilters(status: "known").stored)
        try await eventually { model.results?.filters.status == "known" }
    }

    @Test func worksOutTheCatalogWideValuesOnlyWhenTheCatalogChanges() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        let model = CatalogModel(store: store)
        try await eventually { model.results != nil }
        let revision = model.catalogRevision
        for query in ["f", "fa", "far", "farewell", ""] {
            model.query = query
            _ = model.results
        }
        #expect(model.catalogRevision == revision)

        let entry = try #require(model.results?.visible.first)
        await model.setArchived(entry, archived: true)
        try await eventually { model.catalogRevision > revision }
        #expect(model.results?.archivedCount == 2)
    }

    @Test func announcesTheCountOnlyWhenItsWordingChanges() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        let model = CatalogModel(store: store)
        try await eventually { model.results != nil }
        let shown = SampleCatalog.entries.count - 1
        // The first count is only remembered, so loading is quiet.
        #expect(model.countToAnnounce() == nil)
        #expect(model.countToAnnounce() == nil)

        // A write that changes a tune but not the count.
        let revision = model.catalogRevision
        let first = SampleCatalog.entries[0]
        try await store.write { writer in try writer.put(first.tune, at: later(1, than: SampleCatalog.now)) }
        try await eventually { model.catalogRevision > revision }
        #expect(model.countToAnnounce() == nil)

        await model.setArchived(CatalogEntry(tune: first.tune, userTune: first.userTune), archived: true)
        try await eventually { model.results?.countLabel == "\(shown - 1) tunes" }
        #expect(model.countToAnnounce() == "\(shown - 1) tunes")
        #expect(model.countToAnnounce() == nil)
    }

    @Test func choicesKeepAStaleFilterValue() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        try await store.setMeta(.catalogFilters, to: CatalogFilters(facets: [.genre: "Cajun"]).stored)
        let model = CatalogModel(store: store)
        try await eventually { model.results?.filters.facets[.genre] == "Cajun" }
        let genres = try #require(model.results?.choices(.genre))
        #expect(genres.last == "Cajun")
        #expect(genres.count(where: { $0 == "Old-time" }) == 1)
    }

    @Test func openingTheNewTuneFormClearsTheSearch() async throws {
        let root = TemporaryRoot()
        let model = CatalogModel(store: try await sampleStore(root))
        model.query = "Rove Riley"
        #expect(model.newTune(title: "Rove Riley") == .new(title: "Rove Riley"))
        #expect(model.query == "")
        model.query = "Rove"
        #expect(model.newTune() == .new(title: nil))
        #expect(model.query == "")
    }

    @Test func archivesATuneAndReportsAFailure() async throws {
        let root = TemporaryRoot()
        let store = try await sampleStore(root)
        let model = CatalogModel(store: store)
        try await eventually { model.results != nil }
        let entry = try #require(model.results?.visible.first)
        await model.setArchived(entry, archived: true)
        try await eventually { model.results?.visible.contains(entry) == false }
        #expect(model.results?.archivedCount == 2)
        #expect(model.actionError == nil)

        let gone = CatalogEntry(tune: entry.tune, userTune: userTune("missing", entry.tune.id))
        await model.setArchived(gone, archived: true)
        #expect(model.actionError == CommandError.tuneNotFoundMessage)
    }
}
