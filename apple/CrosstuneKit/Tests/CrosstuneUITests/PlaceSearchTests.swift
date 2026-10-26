import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
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

private let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.661_234_5, lon: -80.923_456_7))
private let ennis = RecordingPlace(name: "Ennis, Ireland", coordinate: Coordinate(lat: 52.843_1, lon: -8.986_4))

/// About 1 m of latitude, in degrees, so a test can place a point a given distance north.
private let meter = 1.0 / 111_195

/// A recording with whatever place a test gives it, its origin set as the store would.
private func recording(
    _ id: String = "r1", name: String? = nil, at point: Coordinate? = nil, placeID: String? = nil, minutes: Int64 = 0
) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: later(minutes * 60_000), state: "ready",
        placeName: name, placeLat: point?.lat, placeLon: point?.lon, placeAccuracyM: point?.accuracyM,
        placeID: placeID, placeOrigin: point == nil ? nil : point?.accuracyM == nil ? "picked" : "device")
}

private func saved(_ id: String, _ name: String, at point: Coordinate, address: String? = nil) -> SavedPlace {
    SavedPlace(id: id, createdAt: noon, name: name, lat: point.lat, lon: point.lon, address: address)
}

/// `point` moved `meters` north.
private func north(_ point: Coordinate, _ meters: Double) -> Coordinate {
    Coordinate(lat: point.lat + meters * meter, lon: point.lon)
}

/// Where each Open in Maps went.
@MainActor private final class MapsOpened {
    var calls: [(name: String?, coordinate: Coordinate)] = []
}

/// The location page over the edit sheet of `opened`, after the store holds `opened`, `others`, and `places`.
@MainActor
private func openPage(
    _ store: CrosstuneStore, _ opened: Recording, others: [Recording] = [], places: [SavedPlace] = [],
    search: FakePlaceSearch = FakePlaceSearch(), nearby: FakeNearbySearch? = nil, analytics: AnalyticsClient = .noop,
    maps: MapsOpened = MapsOpened()
) async throws -> (EditRecordingModel, PlaceSearchModel) {
    try await store.write { writer in
        for place in places { try writer.put(place, at: noon) }
        for recording in others + [opened] { try writer.put(recording, at: noon) }
    }
    let edit = EditRecordingModel(store: store, recording: opened, analytics: analytics)
    await edit.load()
    var makeNearby: (@MainActor () -> any NearbySearch)?
    if let nearby { makeNearby = { nearby } }
    let page = PlaceSearchModel(
        edit: edit, search: { search }, nearby: makeNearby, analytics: analytics,
        openMaps: { name, point in maps.calls.append((name, point)) })
    return (edit, page)
}

@MainActor
@Suite struct PlaceSearchModelTests {
    @Test func listsTheRecentPlacesUntilTheQueryIsLongEnough() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let search = FakePlaceSearch()
        search.results["Ga"] = [FakePlaceSearch.completion("Galax")]
        let older = recording("r2", name: ennis.name, at: ennis.coordinate)
        let newer = recording("r3", name: galax.name, at: galax.coordinate, minutes: 1)
        let (_, places) = try await openPage(store, recording(), others: [older, newer], search: search)
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
        let root = TemporaryRoot()
        let store = try root.open()
        let search = FakePlaceSearch()
        search.results["Ga"] = [FakePlaceSearch.completion("Gainesville")]
        search.results["Gal"] = [FakePlaceSearch.completion("Galax")]
        search.held = ["Ga"]
        let (_, places) = try await openPage(store, recording(), search: search)
        places.setQuery("Ga")
        let first = Task { await places.refresh() }
        #expect(try await poll { search.queries == ["Ga"] })

        places.setQuery("Gal")
        await places.refresh()
        search.release("Ga")
        await first.value
        #expect(places.completions.map(\.title) == ["Galax"])
    }

    @Test func aResolvedResultIsASearchPick() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let search = FakePlaceSearch()
        search.places["Galax"] = galax
        let (edit, places) = try await openPage(store, recording(), search: search)
        #expect(await places.pick(FakePlaceSearch.completion("Galax", "Virginia, United States")))
        #expect(edit.place == galax)
        #expect(edit.placeMethod == .search)
    }

    @Test func aRecentPlaceIsASuggestionPick() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (edit, places) = try await openPage(
            store, recording(), others: [recording("r2", name: galax.name, at: galax.coordinate)])
        #expect(places.pickRecent(galax))
        #expect(edit.place == galax)
        #expect(edit.placeMethod == .suggestion)
    }

    @Test func clearAsksToClearThePlace() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (edit, places) = try await openPage(store, recording(name: galax.name, at: galax.coordinate))
        #expect(places.current == galax)
        #expect(places.clear())
        #expect(edit.place == nil)
        #expect(!edit.canClearPlace)
    }

    @Test func marksTheRecentPlaceThatIsTheCurrentOne() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let captured = Coordinate(lat: galax.coordinate.lat, lon: galax.coordinate.lon, accuracyM: 14)
        let others = [recording("r2", name: ennis.name, at: ennis.coordinate)]
        let (_, places) = try await openPage(store, recording(name: galax.name, at: captured), others: others)
        #expect(places.isCurrent(galax))
        #expect(!places.isCurrent(ennis))
    }

    @Test func ignoresEveryOtherPickWhileOneResolvesAndPicksOnce() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let search = FakePlaceSearch()
        search.places["Galax"] = galax
        search.held = ["Galax"]
        let others = [recording("r2", name: ennis.name, at: ennis.coordinate)]
        let (edit, places) = try await openPage(store, recording(), others: others, search: search)
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
        #expect(edit.place == galax)
    }

    @Test func aResultThatFailsToResolveLeavesThePlaceAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (edit, places) = try await openPage(store, recording(name: galax.name, at: galax.coordinate))
        #expect(!(await places.pick(FakePlaceSearch.completion("Nowhere"))))
        #expect(edit.place == galax)
        #expect(!edit.isEdited)
        #expect(places.failure == PlaceSearchText.pickFailed)

        places.setQuery("Ga")
        #expect(places.failure == nil)
    }
}

@MainActor
@Suite struct LocationPageTests {
    private let spot = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)

    @Test func pageShowsTheMapOnlyWithCoordinates() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (_, bare) = try await openPage(store, recording("r1"))
        #expect(bare.mapCoordinate == nil)
        let (_, unnamed) = try await openPage(store, recording("r2", at: spot))
        #expect(unnamed.mapCoordinate == spot)
        #expect(unnamed.current == nil)
        #expect(unnamed.canClear)
    }

    @Test func nearbyListsSavedPlacesFirstThenVenuesByDistance() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let far = north(spot, 120)
        let close = north(spot, 40)
        nearby.found = [
            NearbyPlace(name: "Far Cafe", address: "2 Main St", lat: far.lat, lon: far.lon, applePlaceID: "far"),
            NearbyPlace(name: "Close Bar", address: "1 Main St", lat: close.lat, lon: close.lon, applePlaceID: "close"),
        ]
        let places = [
            saved("p1", "Tom’s kitchen", at: north(spot, 90)),
            saved("p2", "The barn", at: north(spot, 20)),
            saved("p3", "Across town", at: north(spot, 400)),
        ]
        let (_, page) = try await openPage(store, recording(at: spot), places: places, nearby: nearby)
        await page.loadNearby()
        #expect(try await poll { page.nearby.count == 4 })
        #expect(page.nearby.map(\.name) == ["The barn", "Tom’s kitchen", "Close Bar", "Far Cafe"])
        let asked = try #require(nearby.asked.first)
        #expect(asked.center == spot)
        #expect(asked.radiusM == 150)
        #expect(asked.limit == 10)
    }

    @Test func nearbyDropsAVenueSavedAlreadyAndListsAtMostTen() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let barnPoint = north(spot, 10)
        nearby.found =
            [
                NearbyPlace(
                    name: "Barn venue", address: nil, lat: barnPoint.lat, lon: barnPoint.lon, applePlaceID: "barn")
            ]
            + (1...12).map { index in
                let point = north(spot, Double(10 + index * 10))
                return NearbyPlace(
                    name: "Venue \(index)", address: nil, lat: point.lat, lon: point.lon, applePlaceID: "v\(index)")
            }
        let barn = SavedPlace(
            id: "p1", createdAt: noon, name: "The barn", lat: barnPoint.lat, lon: barnPoint.lon, applePlaceID: "barn")
        let (_, page) = try await openPage(store, recording(at: spot), places: [barn], nearby: nearby)
        await page.loadNearby()
        #expect(try await poll { page.nearby.first?.name == "The barn" })
        #expect(page.nearby.count == 10)
        #expect(!page.nearby.map(\.name).contains("Barn venue"))
        #expect(page.nearby.dropFirst().map(\.name) == (1...9).map { "Venue \($0)" })
    }

    @Test func nearbyDropsAVenueSavedUnderItsNameWithin30m() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let hall = north(spot, 60)
        let venue = north(hall, 10)
        nearby.found = [
            NearbyPlace(name: " grange HALL", address: nil, lat: venue.lat, lon: venue.lon, applePlaceID: "v-hall"),
            NearbyPlace(name: "Cafe", address: nil, lat: hall.lat, lon: hall.lon, applePlaceID: "v-cafe"),
        ]
        let (_, page) = try await openPage(
            store, recording(at: spot), places: [saved("p1", "Grange hall", at: hall)], nearby: nearby)
        await page.loadNearby()
        #expect(try await poll { page.nearby.first?.name == "Grange hall" })
        #expect(page.nearby.map(\.name) == ["Grange hall", "Cafe"])
    }

    @Test func nearbyFailureHidesTheSectionOnly() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let nearby = FakeNearbySearch()
        nearby.failure = URLError(.notConnectedToInternet)
        let places = [saved("p1", "The barn", at: north(spot, 20))]
        let others = [recording("r2", name: galax.name, at: galax.coordinate, minutes: 1)]
        let (_, page) = try await openPage(
            store, recording(name: "1 Main St, Galax, VA", at: spot), others: others, places: places, nearby: nearby)
        await page.loadNearby()
        #expect(page.nearby.isEmpty)
        #expect(page.current?.name == "1 Main St, Galax, VA")
        #expect(page.mapCoordinate == spot)
        #expect(try await poll { page.saved.map(\.name) == ["The barn"] })
        #expect(page.recent.map(\.name) == [galax.name, "1 Main St, Galax, VA"])
        #expect(page.canClear)
    }

    @Test func nameThisLocationHiddenForALooseFix() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let loose = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 120)
        let edge = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 50)
        #expect(!(try await openPage(store, recording("r1", at: loose)).1.canName))
        #expect(try await openPage(store, recording("r2", at: edge)).1.canName)
        #expect(try await openPage(store, recording("r3", name: "Galax, VA", at: galax.coordinate)).1.canName)
        #expect(!(try await openPage(store, recording("r4")).1.canName))
    }

    @Test func namingOffersSavedPlacesWithin30mFirst() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let places = [
            saved("p1", "Upstairs flat", at: north(spot, 25)),
            saved("p2", "The bar", at: north(spot, 10)),
            saved("p3", "Next door", at: north(spot, 40)),
        ]
        let (edit, page) = try await openPage(store, recording(at: spot), places: places)
        #expect(try await poll { page.namingCandidates.map(\.name) == ["The bar", "Upstairs flat"] })
        let bar = try #require(page.namingCandidates.first)
        #expect(page.pickCandidate(bar))
        #expect(edit.place?.name == "The bar")
        #expect(edit.placeMethod == .saved)
    }

    @Test func currentFollowsARenameWhileOpen() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = saved("p1", "The barn", at: spot, address: "1 Main St, Galax, VA")
        let (_, page) = try await openPage(
            store, recording(name: "1 Main St, Galax, VA", at: spot, placeID: "p1"), places: [barn])
        #expect(try await poll { page.current?.name == "The barn" })
        #expect(page.currentAddress == "1 Main St, Galax, VA")
        try await store.write { writer in try writer.renameSavedPlace("p1", name: "Grandpa’s barn", at: later(1_000)) }
        #expect(try await poll { page.current?.name == "Grandpa’s barn" })
    }

    @Test func openInMapsSendsNoLocationInAnalytics() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let maps = MapsOpened()
        let venue = north(spot, 20)
        let barn = saved("p1", "The barn", at: venue)
        let (_, page) = try await openPage(
            store, recording(name: "1 Main St, Galax, VA", at: spot, placeID: "p1"), places: [barn],
            analytics: sink.client, maps: maps)
        #expect(try await poll { page.current?.name == "The barn" })
        page.openInMaps()
        #expect(maps.calls.map(\.name) == ["The barn"])
        #expect(maps.calls.map(\.coordinate) == [Coordinate(lat: venue.lat, lon: venue.lon)])
        #expect(sink.captures == [.init(name: "location_opened_in_maps", properties: [:])])
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
