import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import MapKit
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

    @Test func aVenueSavesItsOwnNameWithItsAddressBelow() {
        let saved = PlaceNames.savedLocation(
            name: "Jalopy Theatre", isPointOfInterest: true, street: "315 Columbia St", locality: "Brooklyn",
            administrativeAreaCode: "NY", countryCode: "US", country: "United States")
        #expect(saved?.name == "Jalopy Theatre")
        #expect(saved?.address == "315 Columbia St, Brooklyn, NY")
    }

    @Test func aStreetAddressSavesTheAddressAsItsName() {
        let saved = PlaceNames.savedLocation(
            name: "1038 Center St", isPointOfInterest: false, street: "1038 Center St", locality: "Newton",
            administrativeAreaCode: "MA", countryCode: "US", country: "United States")
        #expect(saved?.name == "1038 Center St, Newton, MA")
        #expect(saved?.address == nil)
    }

    @Test func aTownSavesNothing() {
        #expect(
            PlaceNames.savedLocation(
                name: "New York", isPointOfInterest: false, street: nil, locality: "New York",
                administrativeAreaCode: "NY", countryCode: "US", country: "United States") == nil)
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

@Suite struct LocationWordsTests {
    @Test func theSearchAndItsRowsSayLocation() {
        #expect(RecordingPageCopy.location == "Location")
        #expect(PlaceSearchText.clearPlace == "Clear location")
        #expect(PlaceSearchText.findAPlace == "Find a place or address")
        #expect(PlaceSearchText.useCurrentLocation == "Use current location")
        #expect(PlaceSearchText.dropAPin == "Can’t find it? Drop a pin on the map")
        #expect(PlaceSearchText.recent == "Recent locations")
        #expect(PlaceSearchText.pickFailed == "Couldn’t find that location. Try another.")
        #expect(PlaceSearchText.current == "Current")
        #expect(PlaceSearchText.nearby == "Nearby")
        #expect(PlaceSearchText.saved == "Saved locations")
        #expect(PlaceSearchText.nameThisLocation == "Name this location…")
        #expect(PlaceSearchText.openInMaps == "Open in Maps")
        #expect(PlaceSearchText.pick("Rex Theater", detail: "113 E Grayson St") == "Use Rex Theater, 113 E Grayson St")
        #expect(PlaceSearchText.pick("Galax, VA", detail: nil) == "Use Galax, VA")
        #expect(PlaceSearchText.pick("Galax, VA", detail: "") == "Use Galax, VA")
        #expect(NameLocationText.title == "Name this location")
        #expect(NameLocationText.nameLabel == "Location name")
        #expect(NameLocationText.savedHere == "Saved here")
        #expect(NameLocationText.help == "Recordings made here show this name.")
    }

    @Test func theAccessNoteSaysHowToTurnLocationBackOn() {
        #expect(LocationAccessText.off == "Location access is off, so new recordings don’t save where they were made.")
        #expect(LocationAccessText.openSettings == "Open Settings")
    }
}

@MainActor
@Suite struct MapKitPlaceSearchTests {
    @Test func theFullSearchRegionCentersOnTheHintAndSpansHalfADegree() throws {
        let hint = Coordinate(lat: 40.678, lon: -73.944, accuracyM: 12)
        let region = try #require(MapKitPlaceSearch.region(near: hint))
        #expect(region.center.latitude == 40.678)
        #expect(region.center.longitude == -73.944)
        #expect(region.span.latitudeDelta == 0.5)
        #expect(region.span.longitudeDelta == 0.5)
    }

    @Test func noHintLeavesTheSearchWorldwide() async {
        #expect(MapKitPlaceSearch.region(near: nil) == nil)
        let search = MapKitPlaceSearch(completer: FakePlaceCompleter())
        #expect(await search.localResults(for: "globe bar").isEmpty)
    }

    @Test func aLocalSearchListsAtMostSevenPlacesInRankOrder() {
        #expect(MapKitPlaceSearch.limited(Array(1...12)) == Array(1...7))
        #expect(MapKitPlaceSearch.limited(Array(1...3)) == [1, 2, 3])
    }

    @Test func answersAQueryOnceTheCompleterDoes() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let found = Task { await search.completions(for: "Gal").map(\.title) }
        try await eventually { completer.fragments == ["Gal"] }
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
        try await eventually { completer.fragments == ["Gal"] }
        let second = Task { await search.completions(for: "Gal").map(\.title) }
        try await eventually { search.waitingSearches == 2 }
        completer.answer(["Galax"])
        #expect(await first.value == ["Galax"])
        #expect(await second.value == ["Galax"])
        #expect(completer.fragments == ["Gal"])
    }

    @Test func aNewerQueryEndsTheWaitOfAnOlderOne() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let older = Task { await search.completions(for: "Ga").map(\.title) }
        try await eventually { completer.fragments == ["Ga"] }
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
        try await eventually { completer.fragments == ["Ga"] }
        let newer = Task { await search.completions(for: "Gal").map(\.title) }
        #expect(await older.value.isEmpty)
        try await eventually { search.waitingSearches == 1 }
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
        try await eventually { completer.fragments == ["Gal"] }
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
        try await eventually { completer.fragments == ["Gal"] }
        completer.fail()
        #expect(await found.value.isEmpty)
    }

    @Test func aCancelledSearchStopsWaiting() async throws {
        let completer = FakePlaceCompleter()
        let search = MapKitPlaceSearch(completer: completer)
        let found = Task { await search.completions(for: "Gal").map(\.title) }
        try await eventually { completer.fragments == ["Gal"] }
        found.cancel()
        #expect(await found.value.isEmpty)
        completer.answer(["Galax"])
        #expect(await search.completions(for: "Gal").map(\.title) == ["Galax"])
    }
}
