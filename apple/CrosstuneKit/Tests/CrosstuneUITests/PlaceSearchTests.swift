import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Testing

@testable import CrosstuneUI

/// The same cases as the API's `test_place_names.py`, so every platform names a place alike.
@Suite struct PlaceNamesTests {
    @Test func aUSPlaceUsesItsStateCode() {
        let name = PlaceNames.name(
            locality: "Galax", administrativeAreaCode: "VA", countryCode: "US", country: "United States",
            fallback: "Galax")
        #expect(name == "Galax, VA")
    }

    @Test func aPlaceOutsideTheUSUsesItsCountry() {
        let name = PlaceNames.name(
            locality: "Ennis", administrativeAreaCode: "CE", countryCode: "IE", country: "Ireland", fallback: "Ennis")
        #expect(name == "Ennis, Ireland")
    }

    @Test func aPlaceWithoutALocalityUsesItsName() {
        let name = PlaceNames.name(
            locality: nil, administrativeAreaCode: nil, countryCode: "US", country: nil, fallback: "Clifftop")
        #expect(name == "Clifftop")
    }

    @Test func aNameIsCutToTheLengthTheServerStores() {
        let long = String(repeating: "é", count: 150) + " " + String(repeating: "a", count: 100)
        let name = PlaceNames.name(
            locality: nil, administrativeAreaCode: nil, countryCode: nil, country: nil, fallback: long)
        #expect(name?.unicodeScalars.count == Vocabulary.Limits.Recording.placeName)
        let decomposed = String(repeating: "e\u{301}", count: 150)
        let cut = PlaceNames.name(
            locality: decomposed, administrativeAreaCode: nil, countryCode: "FR", country: "France", fallback: nil)
        #expect(cut?.unicodeScalars.count == Vocabulary.Limits.Recording.placeName)
        #expect(cut?.hasSuffix("e\u{301}") == true)
    }

    @Test func aCutNameNeverEndsInADanglingSeparator() {
        let locality = String(repeating: "a", count: Vocabulary.Limits.Recording.placeName - 1)
        let name = PlaceNames.name(
            locality: locality, administrativeAreaCode: "VA", countryCode: "US", country: nil, fallback: nil)
        #expect(name == locality)
    }

    @Test func aNameOfOnlySeparatorsIsNil() {
        #expect(
            PlaceNames.name(
                locality: nil, administrativeAreaCode: nil, countryCode: nil, country: nil, fallback: ", ,") == nil)
    }

    @Test func nothingUsableIsNil() {
        #expect(
            PlaceNames.name(
                locality: " ", administrativeAreaCode: nil, countryCode: nil, country: nil, fallback: "") == nil)
        #expect(
            PlaceNames.name(locality: nil, administrativeAreaCode: nil, countryCode: nil, country: nil, fallback: nil)
                == nil)
    }
}

/// The picked-name rule the API applies to web search suggestions in `places/names.py`.
@Suite struct PickedPlaceNamesTests {
    private func picked(
        _ name: String?, poi: Bool = false, street: String? = nil, locality: String?, area: String? = nil,
        code: String? = "US", country: String? = "United States"
    ) -> String? {
        PlaceNames.picked(
            name: name, isPointOfInterest: poi, street: street, locality: locality, administrativeAreaCode: area,
            countryCode: code, country: country)
    }

    @Test func aNamedPlaceKeepsItsNameAndAddress() {
        let name = picked("Jalopy Theatre", poi: true, street: "315 Columbia St", locality: "Brooklyn", area: "NY")
        #expect(name == "Jalopy Theatre, 315 Columbia St, Brooklyn, NY")
    }

    @Test func aStreetAddressKeepsTheAddress() {
        let name = picked("1038 Center St", street: "1038 Center St", locality: "Newton", area: "MA")
        #expect(name == "1038 Center St, Newton, MA")
    }

    @Test func aTownIsNamedByItsTown() {
        #expect(picked("New York", locality: "New York", area: "NY") == "New York, NY")
    }

    @Test func aPlaceOutsideTheUSNamesItsCountry() {
        let pub = picked(
            "The Cobblestone", poi: true, street: "77 King St N", locality: "Dublin", code: "IE", country: "Ireland")
        #expect(pub == "The Cobblestone, 77 King St N, Dublin, Ireland")
        let strand = picked(
            "1 Strand", street: "1 Strand", locality: "London", code: "GB", country: "United Kingdom")
        #expect(strand == "1 Strand, London, United Kingdom")
        #expect(picked("Ennis", locality: "Ennis", code: "IE", country: "Ireland") == "Ennis, Ireland")
    }

    @Test func aNameOtherThanItsStreetIsANamedPlaceWithoutACategory() {
        let name = picked("Newton Free Library", street: "1038 Center St", locality: "Newton", area: "MA")
        #expect(name == "Newton Free Library, 1038 Center St, Newton, MA")
    }

    @Test func anAddressNamedInOtherCaseIsStillAnAddress() {
        let name = picked("1038 CENTER ST", street: "1038 Center St", locality: "Newton", area: "MA")
        #expect(name == "1038 Center St, Newton, MA")
    }

    @Test func aNamedPlaceWithoutAnAddressKeepsItsTown() {
        let name = picked("Jalopy Theatre", poi: true, locality: "Brooklyn", area: "NY")
        #expect(name == "Jalopy Theatre, Brooklyn, NY")
    }

    @Test func aNamedPlaceWithNothingElseIsItsName() {
        #expect(picked("Clifftop", poi: true, locality: nil, code: nil, country: nil) == "Clifftop")
    }

    @Test func nothingUsableIsNil() {
        #expect(picked(nil, locality: nil) == nil)
        #expect(picked(" ", locality: "") == nil)
    }

    @Test func aPlaceIsNamedByItsMailingAddressTown() {
        // Apple Maps puts every borough's locality at New York and the borough the mail names in
        // its sub-locality.
        let eastern = PlaceNames.picked(
            name: "200 Eastern Pkwy", isPointOfInterest: false, street: "200 Eastern Pkwy", locality: "New York",
            subLocality: "Brooklyn",
            formattedAddress: "200 Eastern Pkwy, Brooklyn, NY  11238, United States", administrativeAreaCode: "NY",
            countryCode: "US",
            country: "United States")
        #expect(eastern == "200 Eastern Pkwy, Brooklyn, NY")
        let boosters = PlaceNames.picked(
            name: "Brooklyn Boosters Club", isPointOfInterest: true, street: "646 E Patapsco Ave",
            locality: "Baltimore", subLocality: "Brooklyn",
            formattedAddress: "646 E Patapsco Ave, Brooklyn, MD  21225, United States", administrativeAreaCode: "MD",
            countryCode: "US", country: "United States")
        #expect(boosters == "Brooklyn Boosters Club, 646 E Patapsco Ave, Brooklyn, MD")
    }

    @Test func aNeighborhoodTheMailingAddressSkipsIsNotTheTown() {
        let name = PlaceNames.picked(
            name: "200 Larkin St", isPointOfInterest: false, street: "200 Larkin St", locality: "San Francisco",
            subLocality: "Tenderloin",
            formattedAddress: "200 Larkin St, San Francisco, CA  94102, United States", administrativeAreaCode: "CA",
            countryCode: "US",
            country: "United States")
        #expect(name == "200 Larkin St, San Francisco, CA")
        let unknown = PlaceNames.name(
            locality: "New York", subLocality: "Brooklyn", formattedAddress: nil, administrativeAreaCode: "NY",
            countryCode: "US", country: "United States", fallback: nil)
        #expect(unknown == "New York, NY")
    }

    @Test func aLongNameIsCutWithoutADanglingSeparatorOrASplitCharacter() {
        let limit = Vocabulary.Limits.Recording.placeName
        let venue = String(repeating: "v", count: limit - 1)
        let cut = picked(venue, poi: true, street: "315 Columbia St", locality: "Brooklyn", area: "NY")
        #expect(cut == venue)
        let decomposed = String(repeating: "a", count: limit - 1) + "e\u{301}"
        let whole = picked(decomposed, poi: true, street: "315 Columbia St", locality: "Brooklyn", area: "NY")
        #expect(whole == String(repeating: "a", count: limit - 1))
    }
}

@MainActor
@Suite struct PlaceSearchModelTests {
    private let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.661_234_5, lon: -80.923_456_7))
    private let ennis = RecordingPlace(name: "Ennis, Ireland", coordinate: Coordinate(lat: 52.843_1, lon: -8.986_4))

    private final class Picks {
        var picked: [(RecordingPlace, PlaceMethod)] = []
        var clears = 0
    }

    private func model(
        _ search: FakePlaceSearch, recent: [RecordingPlace] = [], current: RecordingPlace? = nil, picks: Picks
    ) -> PlaceSearchModel {
        PlaceSearchModel(
            search: { search }, recent: recent, current: { current },
            onPick: { picks.picked.append(($0, $1)) }, onClear: { picks.clears += 1 })
    }

    @Test func listsTheRecentPlacesUntilTheQueryIsLongEnough() async {
        let search = FakePlaceSearch()
        search.results["Ga"] = [FakePlaceSearch.completion("Galax")]
        let places = model(search, recent: [galax, ennis], picks: Picks())
        #expect(places.showsRecent)
        #expect(places.recent == [galax, ennis])

        places.setQuery("G")
        await places.refresh()
        #expect(places.showsRecent)
        #expect(search.queries.isEmpty)

        places.setQuery("Ga")
        await places.refresh()
        #expect(!places.showsRecent)
        #expect(search.queries == ["Ga"])
        #expect(places.completions.map(\.title) == ["Galax"])
        #expect(!places.foundNothing)

        places.setQuery("Gx")
        #expect(!places.foundNothing)
        await places.refresh()
        #expect(places.completions.isEmpty)
        #expect(places.foundNothing)
    }

    @Test func dropsAnAnswerToAQueryNoLongerTyped() async throws {
        let search = FakePlaceSearch()
        search.results["Ga"] = [FakePlaceSearch.completion("Gainesville")]
        search.results["Gal"] = [FakePlaceSearch.completion("Galax")]
        search.held = ["Ga"]
        let places = model(search, picks: Picks())
        places.setQuery("Ga")
        let first = Task { await places.refresh() }
        #expect(try await poll { search.queries == ["Ga"] })

        places.setQuery("Gal")
        await places.refresh()
        search.release("Ga")
        await first.value
        #expect(places.completions.map(\.title) == ["Galax"])
    }

    @Test func aResolvedResultIsASearchPick() async {
        let search = FakePlaceSearch()
        let result = FakePlaceSearch.completion("Galax", "Virginia, United States")
        search.places["Galax"] = galax
        let picks = Picks()
        let places = model(search, picks: picks)
        #expect(await places.pick(result))
        #expect(picks.picked.map(\.0) == [galax])
        #expect(picks.picked.map(\.1) == [.search])
    }

    @Test func aPickedVenueStoresItsNameAndAddress() async {
        let search = FakePlaceSearch()
        let jalopy = RecordingPlace(
            name: "Jalopy Theatre, 315 Columbia St, Brooklyn, NY", coordinate: Coordinate(lat: 40.684_5, lon: -74.001_9)
        )
        search.places["Jalopy Theatre"] = jalopy
        let picks = Picks()
        let places = model(search, current: galax, picks: picks)
        #expect(await places.pick(FakePlaceSearch.completion("Jalopy Theatre", "315 Columbia St, Brooklyn, NY")))
        #expect(picks.picked.map(\.0) == [jalopy])
        #expect(picks.picked.map(\.1) == [.search])
    }

    @Test func aRecentPlaceIsASuggestionPick() {
        let picks = Picks()
        let places = model(FakePlaceSearch(), recent: [galax], picks: picks)
        #expect(places.pickRecent(galax))
        #expect(picks.picked.map(\.0) == [galax])
        #expect(picks.picked.map(\.1) == [.suggestion])
    }

    @Test func clearAsksToClearThePlace() {
        let picks = Picks()
        let places = model(FakePlaceSearch(), current: galax, picks: picks)
        #expect(places.current == galax)
        #expect(places.clear())
        #expect(picks.clears == 1)
        #expect(picks.picked.isEmpty)
    }

    @Test func marksTheRecentPlaceThatIsTheCurrentOne() {
        let captured = RecordingPlace(
            name: galax.name,
            coordinate: Coordinate(lat: galax.coordinate.lat, lon: galax.coordinate.lon, accuracyM: 14))
        let places = model(FakePlaceSearch(), recent: [ennis, galax], current: captured, picks: Picks())
        #expect(places.isCurrent(galax))
        #expect(!places.isCurrent(ennis))
        #expect(!model(FakePlaceSearch(), recent: [galax], picks: Picks()).isCurrent(galax))
    }

    @Test func ignoresEveryOtherPickWhileOneResolvesAndPicksOnce() async throws {
        let search = FakePlaceSearch()
        search.places["Galax"] = galax
        search.held = ["Galax"]
        let picks = Picks()
        let places = model(search, recent: [ennis], current: galax, picks: picks)
        let galaxResult = FakePlaceSearch.completion("Galax")
        let first = Task { await places.pick(galaxResult) }
        #expect(try await poll { places.picking == galaxResult })

        #expect(!(await places.pick(FakePlaceSearch.completion("Ennis"))))
        #expect(!places.pickRecent(ennis))
        #expect(!places.clear())
        search.release("Galax")
        #expect(await first.value)
        #expect(places.picking == nil)
        #expect(!(await places.pick(galaxResult)))
        #expect(search.resolves == ["Galax"])
        #expect(picks.picked.map(\.0) == [galax])
        #expect(picks.clears == 0)
    }

    @Test func aResultThatFailsToResolveLeavesThePlaceAlone() async {
        let picks = Picks()
        let places = model(FakePlaceSearch(), current: galax, picks: picks)
        #expect(!(await places.pick(FakePlaceSearch.completion("Nowhere"))))
        #expect(picks.picked.isEmpty)
        #expect(picks.clears == 0)
        #expect(places.failure == PlaceSearchText.pickFailed)

        places.setQuery("Ga")
        #expect(places.failure == nil)
    }
}

@Suite struct LocationWordsTests {
    @Test func theSearchAndItsRowsSayLocation() {
        #expect(EditRecordingText.place == "Location")
        #expect(EditRecordingText.clearPlace == "Clear location")
        #expect(PlaceSearchText.searchLabel == "Search locations")
        #expect(PlaceSearchText.recent == "Recent locations")
        #expect(PlaceSearchText.noPlacesFound == "No locations found")
        #expect(PlaceSearchText.pickFailed == "Couldn’t find that location. Try another.")
        #expect(PlaceSearchText.current == "Current")
    }

    @Test func theAccessNoteSaysHowToTurnLocationBackOn() {
        #expect(LocationAccessText.off == "Location access is off, so new takes don’t save where they were made.")
        #expect(LocationAccessText.openSettings == "Open Settings")
    }
}

@MainActor
@Suite struct MapKitPlaceSearchTests {
    @Test func answersAQueryOnceTheCompleterDoes() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let found = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { completer.fragments == ["Gal"] })
        completer.answer(["Galax"])
        #expect(await found.value == ["Galax"])

        #expect(await search.completions(for: "Gal").map(\.title) == ["Galax"])
        #expect(completer.fragments == ["Gal"])
    }

    @Test func aSearchForTheFragmentStillRunningWaitsForItsAnswer() async throws {
        let completer = FakePlaceCompleter()
        completer.completions = [FakePlaceSearch.completion("Old")]
        let search = MapKitPlaceSearch(completer: completer)
        let first = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { completer.fragments == ["Gal"] })
        let second = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { search.waitingSearches == 2 })
        completer.answer(["Galax"])
        #expect(await first.value == ["Galax"])
        #expect(await second.value == ["Galax"])
        #expect(completer.fragments == ["Gal"])
    }

    @Test func aNewerQueryEndsTheWaitOfAnOlderOne() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let older = Task { await search.completions(for: "Ga").map(\.title) }
        #expect(try await poll { completer.fragments == ["Ga"] })
        let newer = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(await older.value.isEmpty)
        #expect(completer.fragments == ["Ga", "Gal"])
        completer.answer(["Galax"])
        #expect(await newer.value == ["Galax"])
    }

    @Test func dropsALateAnswerForAReplacedFragment() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let older = Task { await search.completions(for: "Ga").map(\.title) }
        #expect(try await poll { completer.fragments == ["Ga"] })
        let newer = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(await older.value.isEmpty)
        #expect(try await poll { search.waitingSearches == 1 })
        completer.answer(["Gainesville"], for: "Ga")
        #expect(search.waitingSearches == 1)
        completer.answer(["Galax"])
        #expect(await newer.value == ["Galax"])
        #expect(await search.completions(for: "Gal").map(\.title) == ["Galax"])
    }

    @Test func aQueryTooShortToSearchFindsNothingAtOnce() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let running = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { completer.fragments == ["Gal"] })
        #expect(await search.completions(for: "").isEmpty)
        #expect(await search.completions(for: " G ").isEmpty)
        #expect(completer.fragments == ["Gal"])
        #expect(search.waitingSearches == 1)
        completer.answer(["Galax"])
        #expect(await running.value == ["Galax"])
    }

    @Test func aFailedSearchFindsNothing() async throws {
        let completer = FakePlaceCompleter()
        completer.completions = [FakePlaceSearch.completion("Old")]
        let search = MapKitPlaceSearch(completer: completer)
        let found = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { completer.fragments == ["Gal"] })
        completer.fail()
        #expect(await found.value.isEmpty)
    }

    @Test func aCancelledSearchStopsWaiting() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let found = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(try await poll { completer.fragments == ["Gal"] })
        found.cancel()
        #expect(await found.value.isEmpty)
        completer.answer(["Galax"])
        #expect(await search.completions(for: "Gal").map(\.title) == ["Galax"])
    }
}
