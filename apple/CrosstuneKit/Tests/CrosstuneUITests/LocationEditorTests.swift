import CoreLocation
import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneRecording
@testable import CrosstuneUI

private let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.661_234_5, lon: -80.923_456_7))
private let ennis = RecordingPlace(name: "Ennis, Ireland", coordinate: Coordinate(lat: 52.843_1, lon: -8.986_4))
private let brooklyn = Coordinate(lat: 40.678, lon: -73.944, accuracyM: 12)

/// About 1 m of latitude, in degrees, so a test can place a point a given distance north.
private let meter = 1.0 / 111_195

private let unitedStates = Locale(identifier: "en_US")

private func saved(_ id: String, _ name: String, at point: Coordinate, address: String? = nil) -> SavedPlace {
    SavedPlace(id: id, createdAt: noon, name: name, lat: point.lat, lon: point.lon, address: address)
}

/// `point` moved `meters` north.
private func north(_ point: Coordinate, _ meters: Double) -> Coordinate {
    Coordinate(lat: point.lat + meters * meter, lon: point.lon)
}

/// Location access as the device reports it.
@MainActor private func access(_ status: CLAuthorizationStatus) -> LocationAccess {
    LocationAccess(manager: AccessManager(status))
}

/// Where each Open in Maps went.
@MainActor private final class MapsOpened {
    var calls: [(name: String?, coordinate: Coordinate)] = []
}

/// The location editor over the edit of `opened`, after the store holds `opened`, `others`, and `places`.
@MainActor
private func openEditor(
    _ store: CrosstuneStore, _ opened: Recording, others: [Recording] = [], places: [SavedPlace] = [],
    searches: FakePlaceSearches = FakePlaceSearches(), nearby: FakeNearbySearch? = nil,
    locationAccess: LocationAccess? = nil, device: FakeLocation? = nil, analytics: AnalyticsClient = .noop,
    maps: MapsOpened = MapsOpened(), sleep: @escaping @MainActor (Duration) async throws -> Void = { _ in }
) async throws -> (RecordingLocationEdit, LocationEditorModel) {
    try await store.write { writer in
        for place in places { try writer.put(place, at: noon) }
        for recording in others + [opened] { try writer.put(recording, at: noon) }
    }
    let edit = RecordingLocationEdit(store: store, recording: opened, analytics: analytics)
    await edit.load()
    var makeNearby: (@MainActor () -> any NearbySearch)?
    if let nearby { makeNearby = { nearby } }
    let editor = LocationEditorModel(
        edit: edit, search: { searches.make(near: $0) }, nearby: makeNearby, locationAccess: locationAccess,
        device: device, analytics: analytics, locale: unitedStates,
        openMaps: { name, point in maps.calls.append((name, point)) }, sleep: sleep)
    return (edit, editor)
}

/// The search's rows as a test reads them: each result's title, each matching saved location's
/// name, then the pin row the editor draws under every search. Empty with no text typed.
@MainActor
private func searchRows(_ editor: LocationEditorModel) -> [String] {
    guard editor.showsResults else { return [] }
    return editor.completions.map(\.title) + editor.savedMatches.map { "saved \($0.name)" } + ["pin"]
}

@MainActor
private func stored(_ store: CrosstuneStore, _ id: String = "r1", sourceLocation: SourceLocation = #_sourceLocation)
    async throws -> Recording
{
    try #require(try await store.read { db in try Recording.fetchOne(db, key: id) }, sourceLocation: sourceLocation)
}

@MainActor
@Suite struct LocationEditorTests {
    private let root = TemporaryRoot()

    @Test func theEditorOpensOnTheStoredRecordingAndNotOnAGoneOne() async throws {
        let store = try root.open()
        try await store.write { writer in try writer.put(placedRecording(name: ennis.name, at: ennis.coordinate)) }
        func open(_ id: String) async -> LocationEditorModel? {
            await LocationEditorModel.open(
                recordingID: id, store: store, placeSearch: FakePlaceSearch.self, nearbySearch: nil,
                locationAccess: nil, device: nil, analytics: .noop)
        }
        let opened = try #require(await open("r1"))
        #expect(opened.edit.placeCoordinate == ennis.coordinate)
        #expect(await open("gone") == nil)
    }

    @Test func searchIsFirstAndNamedForNewPlaces() throws {
        #expect(PlaceSearchText.findAPlace == "Find a place or address")
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "RecordingPage/Location/LocationEditor.swift")))
        #expect(text.contains("PlaceSearchText.findAPlace"))
        for compiled in [SourceScan.iOSCompiled(text), SourceScan.macCompiled(text)] {
            let page = try #require(compiled.range(of: "private var page: some View {"))
            let body = compiled[page.upperBound...]
            let search = try #require(body.range(of: "searchField"))
            for later in ["currentLocationRow", "LocationMap(", "listPicker"] {
                let other = try #require(body.range(of: later), "\(later) is missing")
                #expect(search.lowerBound < other.lowerBound, "\(later) comes before the search")
            }
        }
    }

    @Test func theCompleterRegionCentersOnTheRecording() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let others = [placedRecording("r2", name: ennis.name, at: ennis.coordinate, minutes: 1)]
        let (_, editor) = try await openEditor(
            store, placedRecording(name: "Brooklyn, NY", at: brooklyn), others: others, searches: searches,
            locationAccess: access(.authorizedAlways), device: FakeLocation(galax.coordinate))
        await editor.start()
        editor.query = "globe bar"
        await editor.refresh()
        #expect(searches.asked == [brooklyn])
        #expect(searches.search.queries == ["globe bar"])
    }

    @Test func theCompleterRegionCentersOnTheDeviceForAnUnplacedRecording() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let device = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 20)
        let others = [placedRecording("r2", name: ennis.name, at: ennis.coordinate, minutes: 1)]
        let (_, editor) = try await openEditor(
            store, placedRecording(), others: others, searches: searches, locationAccess: access(.authorizedAlways),
            device: FakeLocation(device))
        await editor.start()
        editor.query = "craft society"
        await editor.refresh()
        #expect(searches.asked == [device])
    }

    @Test func theCompleterRegionFallsBackToTheLatestPlacedRecording() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let device = FakeLocation(galax.coordinate)
        let others = [
            placedRecording("r2", name: galax.name, at: galax.coordinate, minutes: 1),
            placedRecording("r3", name: ennis.name, at: ennis.coordinate, minutes: 2),
        ]
        let (_, editor) = try await openEditor(
            store, placedRecording(), others: others, searches: searches, locationAccess: access(.denied),
            device: device)
        await editor.start()
        editor.query = "Ga"
        await editor.refresh()
        #expect(searches.asked == [ennis.coordinate])
        #expect(device.requests == 0)
    }

    @Test func useCurrentLocationWritesADevicePlaceWithAccuracy() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let fix = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)
        let device = FakeLocation(fix)
        let (edit, editor) = try await openEditor(
            store, placedRecording(name: ennis.name, at: ennis.coordinate), locationAccess: access(.authorizedAlways),
            device: device, analytics: sink.client)
        #expect(editor.isCurrentLocationOff == false)
        #expect(await editor.useCurrentLocation())
        #expect(edit.placeMethod == .currentLocation)
        #expect(editor.edit.placeCoordinate == fix)
        // The server names the spot, so the editor shows no name for it yet.
        #expect(editor.edit.place == nil)
        #expect(try await stored(store).placeName == ennis.name)

        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        #expect(written.placeName == nil)
        #expect(written.placeLat == fix.lat)
        #expect(written.placeLon == fix.lon)
        #expect(written.placeAccuracyM == 12)
        #expect(written.placeOrigin == PlaceOrigin.device.rawValue)
        #expect(written.placeID == nil)
        #expect(sink.captures.map(\.name) == ["recording_place_set"])
        #expect(sink.captures.first?.properties["method"] == .string("current_location"))
    }

    @Test func useCurrentLocationLinksTheOneSavedLocationAtTheSpot() async throws {
        let store = try root.open()
        let fix = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)
        let places = [saved("p1", "The barn", at: north(fix, 20)), saved("p2", "Next door", at: north(fix, 90))]
        let (_, editor) = try await openEditor(
            store, placedRecording(), places: places, locationAccess: access(.authorizedAlways),
            device: FakeLocation(fix))
        try await eventually { editor.edit.savedPlaces.count == 2 }
        #expect(await editor.useCurrentLocation())
        #expect(editor.edit.place?.name == "The barn")

        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        #expect(written.placeID == "p1")
        #expect(written.placeAccuracyM == 12)
        #expect(written.placeOrigin == PlaceOrigin.device.rawValue)
    }

    @Test func aLooseFixLinksNoSavedLocation() async throws {
        let store = try root.open()
        let fix = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 120)
        let (_, editor) = try await openEditor(
            store, placedRecording(), places: [saved("p1", "The barn", at: fix)],
            locationAccess: access(.authorizedAlways),
            device: FakeLocation(fix))
        try await eventually { editor.edit.savedPlaces.count == 1 }
        #expect(await editor.useCurrentLocation())
        #expect(await editor.leave() == nil)
        #expect(try await stored(store).placeID == nil)
    }

    @Test func accessOffMakesCurrentLocationInertAndOpensOnSaved() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        nearby.found = [NearbyPlace(name: "Close Bar", address: nil, lat: 36.66, lon: -80.92, applePlaceID: "bar")]
        let device = FakeLocation(Coordinate(lat: 36.66, lon: -80.92, accuracyM: 10))
        let (edit, editor) = try await openEditor(
            store, placedRecording(), nearby: nearby, locationAccess: access(.denied), device: device)
        #expect(editor.list == .saved)
        await editor.start()
        #expect(editor.isCurrentLocationOff)
        #expect((await editor.useCurrentLocation()) == false)
        #expect(device.requests == 0)
        #expect(edit.isEdited == false)
        #expect(editor.nearby.isEmpty)
        #expect(nearby.asked.isEmpty)
        #expect(editor.list == .saved)
    }

    @Test func anUnplacedRecordingCentersNearbyOnTheDevice() async throws {
        let store = try root.open()
        let fix = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 10)
        let nearby = FakeNearbySearch()
        let close = north(fix, 12)
        nearby.found = [NearbyPlace(name: "Close Bar", address: nil, lat: close.lat, lon: close.lon, applePlaceID: "b")]
        let (_, editor) = try await openEditor(
            store, placedRecording(), nearby: nearby, locationAccess: access(.authorizedAlways),
            device: FakeLocation(fix))
        #expect(editor.list == .nearby)
        await editor.start()
        #expect(nearby.asked.first?.center == fix)
        #expect(editor.nearby.map(\.name) == ["Close Bar"])
    }

    @Test func aLinkedRecordingWithNoPointCentersNearbyOnItsSavedLocation() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let searches = FakePlaceSearches()
        let device = Coordinate(lat: 10, lon: 10, accuracyM: 10)
        let kitchen = saved("p1", "Tom’s kitchen", at: brooklyn)
        let close = north(brooklyn, 30)
        nearby.found = [NearbyPlace(name: "Close Bar", address: nil, lat: close.lat, lon: close.lon, applePlaceID: "b")]
        let (_, editor) = try await openEditor(
            store, placedRecording(placeID: "p1"), places: [kitchen], searches: searches, nearby: nearby,
            locationAccess: access(.authorizedAlways), device: FakeLocation(device))
        #expect(editor.list == .nearby)
        await editor.start()
        try await eventually { nearby.asked.first?.center == kitchen.point }
        #expect(editor.distance(to: close) != nil)
        editor.query = "globe bar"
        await editor.refresh()
        #expect(searches.asked == [kitchen.point])
        #expect(editor.pinStart == kitchen.point)
    }

    @Test func aRecordingsOwnPointBeatsItsSavedLocationForNearby() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let (_, editor) = try await openEditor(
            store, placedRecording(at: galax.coordinate, placeID: "p1"), places: [saved("p1", "Kitchen", at: brooklyn)],
            nearby: nearby)
        await editor.start()
        #expect(nearby.asked.first?.center == galax.coordinate)
    }

    @Test func noPointAndNoFixOpensOnSaved() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(
            store, placedRecording(), nearby: FakeNearbySearch(), locationAccess: access(.authorizedAlways),
            device: FakeLocation())
        await editor.start()
        #expect(editor.nearby.isEmpty)
        #expect(editor.list == .saved)
    }

    @Test func nearbyRowsShowDistance() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let close = north(brooklyn, 12)
        nearby.found = [NearbyPlace(name: "Globe Bar", address: nil, lat: close.lat, lon: close.lon, applePlaceID: "g")]
        let (_, editor) = try await openEditor(
            store, placedRecording(at: brooklyn), places: [saved("p1", "The barn", at: north(brooklyn, 100))],
            nearby: nearby)
        await editor.start()
        try await eventually { editor.nearby.count == 2 }
        #expect(editor.nearby.map(\.distance) == ["40 ft", "330 ft"])
    }

    @Test func matchingSavedLocationsShowUnderResults() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["barn"] = [FakePlaceSearch.completion("Barn Theater")]
        let places = [
            saved("p1", "The barn", at: north(brooklyn, 300)), saved("p2", "Cafe", at: brooklyn),
            saved("p3", "Barnyard", at: north(brooklyn, 3_000)),
        ]
        let (_, editor) = try await openEditor(store, placedRecording(at: brooklyn), places: places, searches: searches)
        try await eventually { editor.edit.savedPlaces.count == 3 }
        editor.query = "barn"
        await editor.refresh()
        #expect(searchRows(editor) == ["Barn Theater", "saved Barnyard", "saved The barn", "pin"])
        #expect(editor.distance(to: places[0].point) == "0.2 mi")
        #expect(editor.distance(to: places[2].point) == "1.9 mi")
    }

    @Test func everySearchEndsWithThePinRow() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["Ga"] = [FakePlaceSearch.completion("Galax")]
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        #expect(searchRows(editor).isEmpty)

        editor.query = "G"
        await editor.refresh()
        #expect(searchRows(editor) == ["pin"])

        editor.query = "Ga"
        await editor.refresh()
        #expect(searchRows(editor) == ["Galax", "pin"])

        editor.query = "Gx"
        await editor.refresh()
        #expect(searchRows(editor) == ["pin"])
        #expect(PlaceSearchText.dropAPin == "Can’t find it? Drop a pin on the map")
    }

    @Test func escapeAfterAPickWritesNothing() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let searches = FakePlaceSearches()
        searches.search.places["Rex Theater"] = galax
        searches.search.saving["Rex Theater"] = SavedPlaceDraft(
            name: "Rex Theater", address: "113 E Grayson St, Galax, VA", lat: galax.coordinate.lat,
            lon: galax.coordinate.lon, applePlaceID: "rex")
        let (edit, editor) = try await openEditor(
            store, placedRecording(name: ennis.name, at: ennis.coordinate), searches: searches, analytics: sink.client)
        #expect(await editor.pick(FakePlaceSearch.completion("Rex Theater")))
        #expect(edit.isEdited)

        editor.discard()
        #expect(await editor.leave() == nil)
        #expect(try await stored(store).placeName == ennis.name)
        #expect(try await store.read { db in try SavedPlace.fetchCount(db) } == 0)
        #expect(sink.captures.isEmpty)
    }

    @Test func escapeAfterNamingWritesNothing() async throws {
        let store = try root.open()
        let (edit, editor) = try await openEditor(store, placedRecording(at: brooklyn))
        #expect(editor.name("Kitchen"))
        #expect(edit.isEdited)

        editor.discard()
        #expect(await editor.leave() == nil)
        #expect(try await stored(store).placeID == nil)
        #expect(try await store.read { db in try SavedPlace.fetchCount(db) } == 0)
    }

    @Test func leavingWaitsForAPickStillResolving() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Galax"] = galax
        searches.search.held = ["Galax"]
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        let result = FakePlaceSearch.completion("Galax")
        editor.startPick(result)
        try await eventually { editor.picking == result }

        let left = Task { await editor.leave() }
        searches.search.release("Galax")
        #expect(await left.value == nil)
        #expect(try await stored(store).placeName == galax.name)
    }

    @Test func escapeDuringAPickStillResolvingWritesNothing() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Galax"] = galax
        searches.search.held = ["Galax"]
        let (edit, editor) = try await openEditor(store, placedRecording(), searches: searches)
        let result = FakePlaceSearch.completion("Galax")
        editor.startPick(result)
        try await eventually { editor.picking == result }

        editor.discard()
        let left = Task { await editor.leave() }
        searches.search.release("Galax")
        #expect(await left.value == nil)
        #expect(edit.isEdited == false)
        #expect(try await stored(store).placeName == nil)
    }

    @Test func noFixSaysTheLocationWasNotFound() async throws {
        let store = try root.open()
        let (edit, editor) = try await openEditor(
            store, placedRecording(), locationAccess: access(.authorizedAlways), device: FakeLocation())
        #expect((await editor.useCurrentLocation()) == false)
        #expect(editor.failure == PlaceSearchText.noCurrentLocation)
        #expect(PlaceSearchText.noCurrentLocation == "Couldn’t find your location.")
        #expect(edit.isEdited == false)
    }

    @Test func theTopResultsShowTheirDistance() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let titles = ["Globe Bar", "Nowhere", "Craft Society", "Fourth"]
        searches.search.results["bar"] = titles.map { FakePlaceSearch.completion($0) }
        searches.search.places["Globe Bar"] = RecordingPlace(name: "Globe Bar", coordinate: north(brooklyn, 12))
        searches.search.places["Craft Society"] = RecordingPlace(
            name: "Craft Society", coordinate: north(brooklyn, 300))
        searches.search.places["Fourth"] = RecordingPlace(name: "Fourth", coordinate: north(brooklyn, 50))
        let (edit, editor) = try await openEditor(store, placedRecording(at: brooklyn), searches: searches)
        editor.query = "bar"
        await editor.refresh()
        #expect(
            editor.completions.map { editor.distance(to: editor.point(of: $0)) } == ["40 ft", nil, "0.2 mi", nil])
        #expect(searches.search.resolves == ["Globe Bar", "Nowhere", "Craft Society"])

        // A pick of a resolved result looks nothing up again.
        #expect(await editor.pick(FakePlaceSearch.completion("Globe Bar")))
        #expect(searches.search.resolves.count == 3)
        #expect(edit.place?.name == "Globe Bar")
    }

    @Test func onlyTheSettledQueryResolvesItsTopResults() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let clock = ManualSleep()
        searches.search.results["gl"] = [FakePlaceSearch.completion("Glen")]
        searches.search.results["globe"] = [FakePlaceSearch.completion("Globe Bar")]
        searches.search.places["Glen"] = RecordingPlace(name: "Glen", coordinate: north(brooklyn, 50))
        searches.search.places["Globe Bar"] = RecordingPlace(name: "Globe Bar", coordinate: north(brooklyn, 12))
        let (_, editor) = try await openEditor(
            store, placedRecording(at: brooklyn), searches: searches, sleep: { try await clock.sleep($0) })

        // Each keystroke cancels the last refresh, as the view's task does.
        editor.query = "gl"
        let typing = Task { await editor.refresh() }
        try await eventually { clock.pending == [LocationEditorModel.settleDelay] }
        typing.cancel()
        await typing.value
        editor.query = "globe"
        let settled = Task { await editor.refresh() }
        try await eventually { clock.pending == [LocationEditorModel.settleDelay] }
        #expect(searches.search.resolves.isEmpty)

        clock.wake()
        await settled.value
        #expect(searches.search.resolves == ["Globe Bar"])
        #expect(searches.search.localQueries == ["globe"])
        #expect(editor.completions.map { editor.distance(to: editor.point(of: $0)) } == ["40 ft"])
        #expect(LocationEditorModel.settleDelay == .milliseconds(400))
    }

    @Test func localPlacesComeFirstWithDistancesAndDropTheirSuggestions() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["globe bar"] = [
            FakePlaceSearch.completion("Globe Bar", "Spokane, WA, United States"),
            FakePlaceSearch.completion("the globe", "158 E 23rd St, New York, NY  10010, United States"),
        ]
        searches.search.local["globe bar"] = [
            FakePlaceSearch.local("The Globe", "158 E 23rd St, New York, NY 10010", at: north(brooklyn, 12))
        ]
        let (edit, editor) = try await openEditor(store, placedRecording(at: brooklyn), searches: searches)
        editor.query = "globe bar"
        await editor.refresh()
        #expect(editor.completions.map(\.title) == ["The Globe", "Globe Bar"])
        #expect(editor.completions.map { editor.distance(to: editor.point(of: $0)) } == ["40 ft", nil])
        // A local place needs no lookup; only the suggestion among the top rows resolves.
        #expect(searches.search.resolves == ["Globe Bar"])

        #expect(await editor.pick(editor.completions[0]))
        #expect(searches.search.resolves == ["Globe Bar"])
        #expect(edit.place?.name == "The Globe")
    }

    @Test func localPlacesStayWhileTheTextGrowsFromTheirQuery() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let clock = ManualSleep()
        searches.search.results["globe"] = [FakePlaceSearch.completion("Globe Theatre", "London")]
        searches.search.results["globe b"] = [FakePlaceSearch.completion("Globe Bar", "Spokane, WA")]
        searches.search.results["glo"] = [FakePlaceSearch.completion("Gloucester", "England")]
        searches.search.local["globe"] = [FakePlaceSearch.local("The Globe", "158 E 23rd St", at: north(brooklyn, 12))]
        let (_, editor) = try await openEditor(
            store, placedRecording(at: brooklyn), searches: searches, sleep: { try await clock.sleep($0) })

        editor.query = "globe"
        let first = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        clock.wake()
        await first.value
        #expect(editor.completions.map(\.title) == ["The Globe", "Globe Theatre"])

        // Until the settled search answers, the longer text keeps the nearby place first.
        editor.query = "globe b"
        let typing = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        #expect(editor.completions.map(\.title) == ["The Globe", "Globe Bar"])
        #expect(editor.completions.map { editor.distance(to: editor.point(of: $0)) }.first == "40 ft")
        clock.wake()
        await typing.value
        // The settled search found nothing for the longer text, so its answer replaces them.
        #expect(editor.completions.map(\.title) == ["Globe Bar"])

        editor.query = "globe"
        let again = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        clock.wake()
        await again.value
        editor.query = "glo"
        let shorter = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        #expect(editor.completions.map(\.title) == ["Gloucester"])
        shorter.cancel()
        await shorter.value

        editor.query = "globe"
        let third = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        clock.wake()
        await third.value
        editor.query = ""
        await editor.refresh()
        editor.query = "globe"
        let cleared = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        #expect(editor.completions.map(\.title) == ["Globe Theatre"])
        cleared.cancel()
        await cleared.value
    }

    @Test func localPlacesClearWhenTheHintMoves() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        let clock = ManualSleep()
        let device = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 10)
        searches.search.results["globe"] = [FakePlaceSearch.completion("Globe Theatre", "London")]
        searches.search.results["globe b"] = [FakePlaceSearch.completion("Globe Bar", "Spokane, WA")]
        searches.search.local["globe"] = [FakePlaceSearch.local("The Globe", "158 E 23rd St", at: brooklyn)]
        let others = [placedRecording("r2", name: "Brooklyn, NY", at: brooklyn, minutes: 1)]
        let (_, editor) = try await openEditor(
            store, placedRecording(), others: others, searches: searches, locationAccess: access(.authorizedAlways),
            device: FakeLocation(device), sleep: { try await clock.sleep($0) })

        // Found near the latest placed recording, before the device's position arrives.
        editor.query = "globe"
        let first = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        clock.wake()
        await first.value
        #expect(editor.completions.map(\.title) == ["The Globe", "Globe Theatre"])

        await editor.start()
        editor.query = "globe b"
        let typing = Task { await editor.refresh() }
        try await eventually { !clock.pending.isEmpty }
        #expect(editor.completions.map(\.title) == ["Globe Bar"])
        #expect(searches.asked == [Coordinate(lat: brooklyn.lat, lon: brooklyn.lon), device])
        typing.cancel()
        await typing.value
    }

    @Test func aFailedLocalSearchLeavesTheSuggestions() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["craft soc"] = [FakePlaceSearch.completion("Craft Society", "569 Union St")]
        let (_, editor) = try await openEditor(store, placedRecording(at: brooklyn), searches: searches)
        editor.query = "craft soc"
        await editor.refresh()
        #expect(searches.search.localQueries == ["craft soc"])
        #expect(editor.completions.map(\.title) == ["Craft Society"])
    }

    @Test func noHintMeansNoLocalSearch() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["globe bar"] = [FakePlaceSearch.completion("Globe Bar")]
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        editor.query = "globe bar"
        await editor.refresh()
        #expect(searches.asked == [nil])
        #expect(searches.search.localQueries.isEmpty)
        #expect(editor.completions.map(\.title) == ["Globe Bar"])
    }

    @Test func twoResultsAreTheSamePlaceByTitleAndFirstAddressLine() {
        let local = FakePlaceSearch.completion("The Globe", "158 E 23rd St, New York")
        #expect(LocationEditorModel.isSame(local, FakePlaceSearch.completion("the globe ", "158 E 23rd St, NY")))
        #expect(LocationEditorModel.isSame(local, FakePlaceSearch.completion("The Globe")))
        #expect(LocationEditorModel.isSame(local, FakePlaceSearch.completion("The Globe", "Spokane, WA")) == false)
        #expect(LocationEditorModel.isSame(local, FakePlaceSearch.completion("Globe Bar", "158 E 23rd St")) == false)
    }

    @Test func aSecondStartWhileAPickRunsIsDropped() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Galax"] = galax
        searches.search.places["Ennis"] = ennis
        searches.search.held = ["Galax"]
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        editor.startPick(FakePlaceSearch.completion("Galax"))
        editor.startPick(FakePlaceSearch.completion("Ennis"))

        let left = Task { await editor.leave() }
        try await eventually { searches.search.resolves == ["Galax"] }
        searches.search.release("Galax")
        #expect(await left.value == nil)
        #expect(try await stored(store).placeName == galax.name)
    }

    @Test func everyOtherDismissalWritesThePick() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Rex Theater"] = galax
        searches.search.saving["Rex Theater"] = SavedPlaceDraft(
            name: "Rex Theater", address: nil, lat: galax.coordinate.lat, lon: galax.coordinate.lon,
            applePlaceID: "rex")
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        #expect(await editor.pick(FakePlaceSearch.completion("Rex Theater")))
        #expect(await editor.leave() == nil)
        #expect(try await stored(store).placeName == galax.name)
        #expect(try await store.read { db in try SavedPlace.fetchCount(db) } == 1)
    }
}

@Suite struct LocationNameEndTests {
    @Test func everyEndButEscapeCommitsATypedName() {
        #expect(LocationNameEnd.result(.commit, draft: " Kitchen ", stored: nil) == "Kitchen")
        #expect(LocationNameEnd.result(.commit, draft: "Barn", stored: "Kitchen") == "Barn")
        #expect(LocationNameEnd.result(.cancel, draft: "Kitchen", stored: nil) == nil)
    }

    @Test func anEmptyOrUnchangedNameWritesNothing() {
        #expect(LocationNameEnd.result(.commit, draft: "  ", stored: nil) == nil)
        #expect(LocationNameEnd.result(.commit, draft: "Kitchen", stored: "Kitchen") == nil)
    }

    @Test func theSheetsNeverBlockADismissalThatCommits() throws {
        for file in ["Recordings/NameLocationSheet.swift", "Recordings/RenameLocationSheet.swift"] {
            let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: file)))
            #expect(text.contains("interactiveDismissDisabled(!name.isEmpty)") == false, "\(file)")
            #expect(text.contains("interactiveDismissDisabled(name != current") == false, "\(file)")
            #expect(text.contains("LocationNameEnd.result"), "\(file)")
        }
    }
}

@Suite struct SearchHintTests {
    private let recorded = Coordinate(lat: 1, lon: 1)
    private let device = Coordinate(lat: 2, lon: 2, accuracyM: 10)
    private let latest = Coordinate(lat: 3, lon: 3)
    private let country = Coordinate(lat: 4, lon: 4)

    @Test func theRecordingComesFirst() {
        #expect(
            SearchHint.pick(recording: recorded, device: device, latestPlaced: latest, countryCenter: country)
                == recorded)
    }

    @Test func thenTheDevice() {
        #expect(
            SearchHint.pick(recording: nil, device: device, latestPlaced: latest, countryCenter: country) == device)
    }

    @Test func thenTheLatestPlacedRecording() {
        #expect(SearchHint.pick(recording: nil, device: nil, latestPlaced: latest, countryCenter: country) == latest)
    }

    @Test func thenTheCountryCenter() {
        #expect(SearchHint.pick(recording: nil, device: nil, latestPlaced: nil, countryCenter: country) == country)
    }

    @Test func elseNoHint() {
        #expect(SearchHint.pick(recording: nil, device: nil, latestPlaced: nil, countryCenter: nil) == nil)
    }
}

@Suite struct DistanceTextTests {
    private let us = Locale(identifier: "en_US")
    private let france = Locale(identifier: "fr_FR")

    @Test func feetUnderATenthOfAMile() {
        #expect(DistanceText.format(meters: 12, locale: us) == "40 ft")
        #expect(DistanceText.format(meters: 160, locale: us) == "520 ft")
    }

    @Test func milesWithOneDecimalFromATenth() {
        #expect(DistanceText.format(meters: 300, locale: us) == "0.2 mi")
        #expect(DistanceText.format(meters: 16_093, locale: us) == "10.0 mi")
    }

    @Test func metersUnderAKilometer() {
        #expect(DistanceText.format(meters: 450, locale: france) == "450 m")
        #expect(DistanceText.format(meters: 12, locale: france) == "10 m")
    }

    @Test func kilometersWithOneDecimalFromOne() {
        #expect(DistanceText.format(meters: 1_260, locale: france) == "1,3 km")
    }

    @Test func theUKCountsInMilesAndFeet() {
        #expect(DistanceText.format(meters: 300, locale: Locale(identifier: "en_GB")) == "0.2 mi")
        #expect(DistanceText.format(meters: 12, locale: Locale(identifier: "en_GB")) == "40 ft")
    }

    @Test func germanyCountsInKilometersWithADecimalComma() {
        let germany = Locale(identifier: "de_DE")
        #expect(DistanceText.format(meters: 1_200, locale: germany) == "1,2 km")
        #expect(DistanceText.format(meters: 450, locale: germany) == "450 m")
    }

    @Test func neverReadsBelowTen() {
        #expect(DistanceText.format(meters: 1, locale: us) == "10 ft")
        #expect(DistanceText.format(meters: 3, locale: france) == "10 m")
    }

    @Test func roundsToAKilometerBeforeChoosingTheUnit() {
        #expect(DistanceText.format(meters: 997, locale: france) == "1,0 km")
    }
}

@MainActor
@Suite struct LocationEditorPickTests {
    private let root = TemporaryRoot()

    @Test func listsTheRecentPlacesUntilTextIsTyped() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["Ga"] = [FakePlaceSearch.completion("Galax")]
        let older = placedRecording("r2", name: ennis.name, at: ennis.coordinate)
        let newer = placedRecording("r3", name: galax.name, at: galax.coordinate, minutes: 1)
        let (_, editor) = try await openEditor(store, placedRecording(), others: [older, newer], searches: searches)
        #expect(editor.showsResults == false)
        #expect(editor.edit.recentPlaces == [galax, ennis])

        editor.query = "G"
        await editor.refresh()
        #expect(editor.showsResults)
        #expect(searches.search.queries.isEmpty)

        editor.query = "Ga"
        await editor.refresh()
        #expect(searches.search.queries == ["Ga"])
        #expect(editor.completions.map(\.title) == ["Galax"])

        editor.query = "Gx"
        await editor.refresh()
        #expect(editor.completions.isEmpty)
        #expect(searchRows(editor) == ["pin"])
    }

    @Test func dropsAnAnswerToAQueryNoLongerTyped() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.results["Ga"] = [FakePlaceSearch.completion("Gainesville")]
        searches.search.results["Gal"] = [FakePlaceSearch.completion("Galax")]
        searches.search.held = ["Ga"]
        let (_, editor) = try await openEditor(store, placedRecording(), searches: searches)
        editor.query = "Ga"
        let first = Task { await editor.refresh() }
        try await eventually { searches.search.queries == ["Ga"] }

        editor.query = "Gal"
        await editor.refresh()
        searches.search.release("Ga")
        await first.value
        #expect(editor.completions.map(\.title) == ["Galax"])
    }

    @Test func aResolvedResultIsASearchPickAndEndsTheSearch() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Galax"] = galax
        let (edit, editor) = try await openEditor(store, placedRecording(), searches: searches)
        editor.query = "Galax"
        #expect(await editor.pick(FakePlaceSearch.completion("Galax", "Virginia, United States")))
        #expect(edit.place == galax)
        #expect(edit.placeMethod == .search)
        #expect(editor.query.isEmpty)
        #expect(editor.showsResults == false)
        #expect(editor.edit.place == galax)
    }

    @Test func aRecentPlaceIsASuggestionPick() async throws {
        let store = try root.open()
        let (edit, editor) = try await openEditor(
            store, placedRecording(), others: [placedRecording("r2", name: galax.name, at: galax.coordinate)])
        #expect(editor.pickRecent(galax))
        #expect(edit.place == galax)
        #expect(edit.placeMethod == .suggestion)
    }

    @Test func clearAsksToClearThePlace() async throws {
        let store = try root.open()
        let (edit, editor) = try await openEditor(store, placedRecording(name: galax.name, at: galax.coordinate))
        #expect(editor.edit.place == galax)
        #expect(editor.clear())
        #expect(edit.place == nil)
        #expect(edit.canClearPlace == false)
    }

    @Test func marksTheRecentPlaceThatIsTheCurrentOne() async throws {
        let store = try root.open()
        let captured = Coordinate(lat: galax.coordinate.lat, lon: galax.coordinate.lon, accuracyM: 14)
        let others = [placedRecording("r2", name: ennis.name, at: ennis.coordinate)]
        let (_, editor) = try await openEditor(store, placedRecording(name: galax.name, at: captured), others: others)
        #expect(editor.isCurrent(galax))
        #expect(editor.isCurrent(ennis) == false)
    }

    @Test func ignoresEveryOtherPickWhileOneResolves() async throws {
        let store = try root.open()
        let searches = FakePlaceSearches()
        searches.search.places["Galax"] = galax
        searches.search.held = ["Galax"]
        let others = [placedRecording("r2", name: ennis.name, at: ennis.coordinate)]
        let (edit, editor) = try await openEditor(store, placedRecording(), others: others, searches: searches)
        let galaxResult = FakePlaceSearch.completion("Galax")
        let first = Task { await editor.pick(galaxResult) }
        try await eventually { editor.picking == galaxResult }

        #expect((await editor.pick(FakePlaceSearch.completion("Ennis"))) == false)
        #expect(editor.pickRecent(ennis) == false)
        #expect(editor.clear() == false)
        searches.search.release("Galax")
        #expect(await first.value)
        #expect(editor.picking == nil)
        #expect(searches.search.resolves == ["Galax"])
        #expect(edit.place == galax)

        // A later pick replaces the one staged.
        #expect(editor.pickRecent(ennis))
        #expect(edit.place == ennis)
    }

    @Test func aResultThatFailsToResolveLeavesThePlaceAlone() async throws {
        let store = try root.open()
        let (edit, editor) = try await openEditor(store, placedRecording(name: galax.name, at: galax.coordinate))
        #expect((await editor.pick(FakePlaceSearch.completion("Nowhere"))) == false)
        #expect(edit.place == galax)
        #expect(edit.isEdited == false)
        #expect(editor.failure == PlaceSearchText.pickFailed)

        editor.query = "Ga"
        #expect(editor.failure == nil)
    }
}

@MainActor
@Suite struct LocationEditorPlaceTests {
    private let root = TemporaryRoot()
    private let spot = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)

    @Test func showsTheMapOnlyWithCoordinates() async throws {
        let store = try root.open()
        let (_, bare) = try await openEditor(store, placedRecording("r1"))
        #expect(bare.edit.placeCoordinate == nil)
        let (_, unnamed) = try await openEditor(store, placedRecording("r2", at: spot))
        #expect(unnamed.edit.placeCoordinate == spot)
        #expect(unnamed.edit.place == nil)
        #expect(unnamed.edit.canClearPlace)
    }

    @Test func nearbyListsSavedPlacesAndVenuesByDistance() async throws {
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
        let (_, editor) = try await openEditor(store, placedRecording(at: spot), places: places, nearby: nearby)
        await editor.start()
        try await eventually { editor.nearby.count == 4 }
        #expect(editor.nearby.map(\.name) == ["The barn", "Close Bar", "Tom’s kitchen", "Far Cafe"])
        let asked = try #require(nearby.asked.first)
        #expect(asked.center == spot)
        #expect(asked.radiusM == 150)
        #expect(asked.limit == 7)
    }

    @Test func nearbyDropsAVenueSavedAlreadyAndListsAtMostSeven() async throws {
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
        let (_, editor) = try await openEditor(store, placedRecording(at: spot), places: [barn], nearby: nearby)
        await editor.start()
        try await eventually { editor.nearby.first?.name == "The barn" }
        #expect(editor.nearby.count == 7)
        #expect(editor.nearby.map(\.name).contains("Barn venue") == false)
        #expect(editor.nearby.dropFirst().map(\.name) == (1...6).map { "Venue \($0)" })
    }

    @Test func nearbyDropsAVenueSavedUnderItsNameWithin30m() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        let hall = north(spot, 60)
        let venue = north(hall, 10)
        let cafe = north(hall, 5)
        nearby.found = [
            NearbyPlace(name: " grange HALL", address: nil, lat: venue.lat, lon: venue.lon, applePlaceID: "v-hall"),
            NearbyPlace(name: "Cafe", address: nil, lat: cafe.lat, lon: cafe.lon, applePlaceID: "v-cafe"),
        ]
        let (_, editor) = try await openEditor(
            store, placedRecording(at: spot), places: [saved("p1", "Grange hall", at: hall)], nearby: nearby)
        await editor.start()
        try await eventually { editor.nearby.first?.name == "Grange hall" }
        #expect(editor.nearby.map(\.name) == ["Grange hall", "Cafe"])
    }

    @Test func nearbyFailureHidesTheListOnly() async throws {
        let store = try root.open()
        let nearby = FakeNearbySearch()
        nearby.failure = URLError(.notConnectedToInternet)
        let places = [saved("p1", "The barn", at: north(spot, 20))]
        let others = [placedRecording("r2", name: galax.name, at: galax.coordinate, minutes: 1)]
        let (_, editor) = try await openEditor(
            store, placedRecording(name: "1 Main St, Galax, VA", at: spot), others: others, places: places,
            nearby: nearby)
        await editor.start()
        #expect(editor.nearby.isEmpty)
        #expect(editor.edit.place?.name == "1 Main St, Galax, VA")
        #expect(editor.edit.placeCoordinate == spot)
        try await eventually { editor.edit.savedPlaces.map(\.name) == ["The barn"] }
        #expect(editor.edit.recentPlaces.map(\.name) == [galax.name, "1 Main St, Galax, VA"])
        #expect(editor.edit.canClearPlace)
    }

    @Test func nameThisLocationHiddenForALooseFix() async throws {
        let store = try root.open()
        let loose = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 120)
        let edge = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 50)
        #expect((try await openEditor(store, placedRecording("r1", at: loose)).1.edit.canNamePlace) == false)
        #expect(try await openEditor(store, placedRecording("r2", at: edge)).1.edit.canNamePlace)
        #expect(
            try await openEditor(store, placedRecording("r3", name: "Galax, VA", at: galax.coordinate)).1.edit
                .canNamePlace)
        #expect((try await openEditor(store, placedRecording("r4")).1.edit.canNamePlace) == false)
    }

    @Test func unsavedPlaceOffersNameNotRename() async throws {
        let store = try root.open()
        let (edit, _) = try await openEditor(store, placedRecording("r1", at: brooklyn))
        #expect(edit.canNamePlace)
        #expect(edit.canRenamePlace == false)
    }

    @Test func savedPlaceOffersRenameNotName() async throws {
        let store = try root.open()
        let barn = saved("p1", "The barn", at: spot)
        let (edit, _) = try await openEditor(store, placedRecording("r1", at: spot, placeID: "p1"), places: [barn])
        try await eventually { edit.linkedPlace?.name == "The barn" }
        #expect(edit.canRenamePlace)
        #expect(edit.canNamePlace == false)
    }

    @Test func renamingASavedPlaceRenamesItForEveryRecording() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let barn = saved("p1", "The barn", at: spot)
        let other = placedRecording("r2", at: spot, placeID: "p1")
        let (edit, editor) = try await openEditor(
            store, placedRecording("r1", at: spot, placeID: "p1"), others: [other], places: [barn],
            analytics: sink.client)
        try await eventually { edit.linkedPlace != nil }
        #expect(await editor.renameLinked("Grandpa’s barn"))
        let place = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: "p1") })
        #expect(place.name == "Grandpa’s barn")
        try await eventually { edit.place?.name == "Grandpa’s barn" }
        #expect(try await stored(store, "r2").placeID == "p1")
        #expect(sink.captures == [.init(name: "saved_location_renamed", properties: [:], set: [:])])
    }

    @Test func renameDoesNothingWithoutASavedPlace() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(store, placedRecording("r1", at: brooklyn))
        #expect((await editor.renameLinked("Anything")) == false)
    }

    @Test func namingOffersSavedPlacesWithin30mFirst() async throws {
        let store = try root.open()
        let places = [
            saved("p1", "Upstairs flat", at: north(spot, 25)),
            saved("p2", "The bar", at: north(spot, 10)),
            saved("p3", "Next door", at: north(spot, 40)),
        ]
        let (edit, editor) = try await openEditor(store, placedRecording(at: spot), places: places)
        try await eventually { editor.namingCandidates.map(\.name) == ["The bar", "Upstairs flat"] }
        let bar = try #require(editor.namingCandidates.first)
        #expect(editor.pickCandidate(bar))
        #expect(edit.place?.name == "The bar")
        #expect(edit.placeMethod == .saved)
    }

    @Test func namingTheCurrentLocationKeepsTheDevicePoint() async throws {
        let store = try root.open()
        let fix = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)
        let (_, editor) = try await openEditor(
            store, placedRecording(name: ennis.name, at: ennis.coordinate), locationAccess: access(.authorizedAlways),
            device: FakeLocation(fix))
        #expect(await editor.useCurrentLocation())
        #expect(editor.name("Kitchen"))
        #expect(editor.edit.place?.name == "Kitchen")

        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        let place = try #require(try await store.read { db in try SavedPlace.fetchAll(db) }.first)
        #expect(place.name == "Kitchen")
        #expect(written.placeID == place.id)
        #expect(written.placeLat == fix.lat)
        #expect(written.placeAccuracyM == 12)
        #expect(written.placeOrigin == PlaceOrigin.device.rawValue)
    }

    @Test func currentFollowsARenameWhileOpen() async throws {
        let store = try root.open()
        let barn = saved("p1", "The barn", at: spot, address: "1 Main St, Galax, VA")
        let (_, editor) = try await openEditor(
            store, placedRecording(name: "1 Main St, Galax, VA", at: spot, placeID: "p1"), places: [barn])
        try await eventually { editor.edit.place?.name == "The barn" }
        #expect(editor.edit.placeAddress == "1 Main St, Galax, VA")
        try await store.write { writer in try writer.renameSavedPlace("p1", name: "Grandpa’s barn", at: later(1_000)) }
        try await eventually { editor.edit.place?.name == "Grandpa’s barn" }
    }

    @Test func openInMapsSendsNoLocationInAnalytics() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let maps = MapsOpened()
        let venue = north(spot, 20)
        let barn = saved("p1", "The barn", at: venue)
        let (_, editor) = try await openEditor(
            store, placedRecording(name: "1 Main St, Galax, VA", at: spot, placeID: "p1"), places: [barn],
            analytics: sink.client, maps: maps)
        try await eventually { editor.edit.place?.name == "The barn" }
        editor.openInMaps()
        #expect(maps.calls.map(\.name) == ["The barn"])
        #expect(maps.calls.map(\.coordinate) == [Coordinate(lat: venue.lat, lon: venue.lon)])
        #expect(sink.captures == [.init(name: "location_opened_in_maps", properties: [:])])
    }
}
