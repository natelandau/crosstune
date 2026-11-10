import CoreLocation
import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneRecording
@testable import CrosstuneUI

private let galax = Coordinate(lat: 36.661_2, lon: -80.923_4)
private let ennis = RecordingPlace(name: "Ennis, Ireland", coordinate: Coordinate(lat: 52.843_1, lon: -8.986_4))
private let rex = ReversedPlace(name: "113 E Grayson St, Galax", address: "113 E Grayson St, Galax, VA")

/// About 1 m of latitude, in degrees.
private let meter = 1.0 / 111_195

/// A reverse lookup that answers from what a test sets. A point in `held` waits for
/// ``release(_:)``, so a test can land an older answer after a newer one. A cancelled lookup
/// answers nil at once, as a cancelled request through the sync engine does.
@MainActor private final class FakeReverseLookup {
    var places: [Coordinate: ReversedPlace] = [:]
    var held: Set<Coordinate> = []
    private(set) var asked: [Coordinate] = []
    private(set) var cancelled: [Coordinate] = []
    private var waiting: [Coordinate: CheckedContinuation<Void, Never>] = [:]

    func lookup(_ point: Coordinate) async -> ReversedPlace? {
        asked.append(point)
        if held.contains(point) {
            await withTaskCancellationHandler {
                await withCheckedContinuation { waiting[point] = $0 }
            } onCancel: {
                Task { @MainActor in self.cancel(point) }
            }
        }
        return Task.isCancelled ? nil : places[point]
    }

    private func cancel(_ point: Coordinate) {
        cancelled.append(point)
        waiting.removeValue(forKey: point)?.resume()
    }

    func release(_ point: Coordinate) {
        held.remove(point)
        waiting.removeValue(forKey: point)?.resume()
    }
}

@MainActor private func pinModel(start: Coordinate?, _ lookup: FakeReverseLookup) -> DropPinModel {
    DropPinModel(start: start) { await lookup.lookup($0) }
}

/// The location editor over the edit of `opened`, after the store holds it.
@MainActor
private func openEditor(
    _ store: CrosstuneStore, _ opened: Recording, analytics: AnalyticsClient = .noop
) async throws -> (RecordingLocationEdit, LocationEditorModel) {
    try await store.write { writer in try writer.put(opened, at: noon) }
    let edit = RecordingLocationEdit(store: store, recording: opened, analytics: analytics)
    await edit.load()
    let searches = FakePlaceSearches()
    let editor = LocationEditorModel(edit: edit, search: { searches.make(near: $0) }, sleep: { _ in })
    return (edit, editor)
}

@MainActor
private func stored(_ store: CrosstuneStore) async throws -> Recording {
    try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
}

@MainActor
@Suite struct DropPinTests {
    private let root = TemporaryRoot()

    @Test func theAddressFollowsTheMapWhenItSettles() async throws {
        let lookup = FakeReverseLookup()
        let elsewhere = Coordinate(lat: 36.7, lon: -80.9)
        lookup.places[galax] = rex
        lookup.places[elsewhere] = ReversedPlace(name: "Main St, Galax")
        lookup.held = [galax]
        let model = pinModel(start: galax, lookup)
        #expect(model.found == nil)

        let first = Task { await model.settle(at: galax) }
        #expect(try await poll { lookup.asked == [galax] })

        // The map moved on before the first answer came; that lookup is cancelled and dropped.
        await model.settle(at: elsewhere)
        #expect(model.found?.name == "Main St, Galax")
        await first.value
        #expect(lookup.cancelled == [galax])
        #expect(model.found?.name == "Main St, Galax")
        #expect(model.pin?.coordinate == elsewhere)

        lookup.held = []
        await model.settle(at: galax)
        #expect(model.found == rex)
        #expect(model.pin?.name == rex.name)
    }

    @Test func aSettleOnTheSameSpotKeepsTheLookupRunning() async throws {
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        lookup.held = [galax]
        let model = pinModel(start: galax, lookup)
        let first = Task { await model.settle(at: galax) }
        #expect(try await poll { lookup.asked == [galax] })

        // The map settles again half a meter away, and the caller that started the first
        // settle is cancelled; neither stops the lookup or asks again.
        let again = Task { await model.settle(at: Coordinate(lat: galax.lat + meter / 2, lon: galax.lon)) }
        first.cancel()
        lookup.release(galax)
        await again.value
        await first.value
        #expect(lookup.asked == [galax])
        #expect(lookup.cancelled.isEmpty)
        #expect(model.found == rex)
        #expect(model.pin?.name == rex.name)
    }

    @Test func aSpotWithNoPlaceIsNotLookedUpAgain() async {
        let lookup = FakeReverseLookup()
        let model = pinModel(start: galax, lookup)
        await model.settle(at: galax)
        await model.settle(at: Coordinate(lat: galax.lat + meter / 2, lon: galax.lon))
        #expect(lookup.asked == [galax])
        #expect(model.found == nil)
        #expect(model.isLookingUp == false)
    }

    @Test func useIsOffUntilTheMapHasAPoint() async throws {
        let lookup = FakeReverseLookup()
        let model = pinModel(start: nil, lookup)
        #expect(model.pin == nil)
        // A map opened on the whole world settles on its own first; that sets no pin.
        await model.settle(at: Coordinate(lat: 0, lon: 0), movedByUser: false)
        #expect(model.pin == nil)
        #expect(lookup.asked.isEmpty)

        await model.settle(at: galax, movedByUser: true)
        #expect(model.pin?.coordinate == galax)
    }

    @Test func renamingANamedPinSavesItsStreetAddress() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let (edit, editor) = try await openEditor(store, placedRecording(), analytics: sink.client)
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        let pin = pinModel(start: galax, lookup)
        await pin.settle(at: galax)
        #expect(editor.usePin(try #require(pin.pin)))
        #expect(editor.name("Kitchen"))
        // Naming keeps the pin's point, so the place is still set by a pin.
        #expect(edit.placeMethod == .pin)
        #expect(await editor.leave() == nil)

        let place = try #require(try await store.read { db in try SavedPlace.fetchOne(db) })
        #expect(place.name == "Kitchen")
        #expect(place.address == rex.name)
        #expect(place.lat == galax.lat)
        #expect(try await stored(store).placeID == place.id)
        #expect(sink.captures.first?.properties["method"] == .string("pin"))
    }

    @Test func noSettleLooksUpOnceTheMapHasGone() async throws {
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        let model = pinModel(start: galax, lookup)
        model.cancel()

        await model.settle(at: galax)
        await model.settle(at: Coordinate(lat: 36.7, lon: -80.9))
        #expect(lookup.asked.isEmpty)
        #expect(model.found == nil)
        #expect(model.isLookingUp == false)
    }

    @Test func useThisSpotStagesThePlace() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let (edit, editor) = try await openEditor(
            store, placedRecording(name: ennis.name, at: ennis.coordinate), analytics: sink.client)
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        let pin = pinModel(start: ennis.coordinate, lookup)
        await pin.settle(at: galax)

        #expect(editor.usePin(try #require(pin.pin)))
        #expect(edit.isEdited)
        #expect(edit.placeMethod == .pin)
        #expect(editor.edit.place?.name == rex.name)
        #expect(editor.edit.placeCoordinate == galax)
        // Staged only: nothing is written until the editor leaves.
        #expect(try await stored(store).placeName == ennis.name)

        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        #expect(written.placeName == rex.name)
        #expect(written.placeLat == galax.lat)
        #expect(written.placeLon == galax.lon)
        #expect(written.placeAccuracyM == nil)
        #expect(written.placeOrigin == PlaceOrigin.picked.rawValue)
        #expect(written.placeID == nil)
        #expect(try await store.read { db in try SavedPlace.fetchCount(db) } == 0)
        #expect(sink.captures.map(\.name) == ["recording_place_set"])
        #expect(sink.captures.first?.properties["method"] == .string("pin"))
    }

    @Test func aNameCreatesASavedLocation() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let (_, editor) = try await openEditor(store, placedRecording(), analytics: sink.client)
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        let pin = pinModel(start: nil, lookup)
        await pin.settle(at: galax)
        pin.savedName = "  Rex Theater "

        #expect(editor.usePin(try #require(pin.pin)))
        #expect(editor.edit.place?.name == "Rex Theater")
        #expect(await editor.leave() == nil)

        let places = try await store.read { db in try SavedPlace.fetchAll(db) }
        let place = try #require(places.first)
        #expect(places.count == 1)
        #expect(place.name == "Rex Theater")
        #expect(place.address == rex.address)
        #expect(place.lat == galax.lat)
        #expect(place.lon == galax.lon)
        let written = try await stored(store)
        #expect(written.placeID == place.id)
        #expect(written.placeName == rex.name)
        #expect(written.placeLat == galax.lat)
        #expect(written.placeOrigin == PlaceOrigin.picked.rawValue)
        #expect(sink.captures.map(\.name) == ["recording_place_set", "saved_location_created"])
        #expect(sink.captures.first?.properties["method"] == .string("pin"))
    }

    @Test func escapeAfterNamingWritesNothing() async throws {
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let (edit, editor) = try await openEditor(
            store, placedRecording(name: ennis.name, at: ennis.coordinate), analytics: sink.client)
        let lookup = FakeReverseLookup()
        lookup.places[galax] = rex
        let pin = pinModel(start: ennis.coordinate, lookup)
        await pin.settle(at: galax)
        pin.savedName = "Rex Theater"
        #expect(editor.usePin(try #require(pin.pin)))
        #expect(edit.isEdited)

        editor.discard()
        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        #expect(written.placeName == ennis.name)
        #expect(written.placeLat == ennis.coordinate.lat)
        #expect(written.placeID == nil)
        #expect(try await store.read { db in try SavedPlace.fetchCount(db) } == 0)
        #expect(sink.captures.isEmpty)
    }

    @Test func aFailedLookupStillAllowsUse() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(store, placedRecording(name: ennis.name, at: ennis.coordinate))
        let lookup = FakeReverseLookup()
        let pin = pinModel(start: ennis.coordinate, lookup)
        await pin.settle(at: galax)
        #expect(pin.found == nil)
        let dropped = try #require(pin.pin)
        #expect(dropped.name == nil)

        #expect(editor.usePin(dropped))
        // The server names the spot, so the editor shows no name for it yet.
        #expect(editor.edit.place == nil)
        #expect(editor.edit.placeCoordinate == galax)
        #expect(await editor.leave() == nil)
        let written = try await stored(store)
        #expect(written.placeName == nil)
        #expect(written.placeLat == galax.lat)
        #expect(written.placeLon == galax.lon)
        #expect(written.placeAccuracyM == nil)
        #expect(written.placeOrigin == PlaceOrigin.picked.rawValue)
        #expect(written.placeID == nil)
    }

    @Test func aNamedPinWithNoAddressSavesItsStreetName() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(store, placedRecording())
        let lookup = FakeReverseLookup()
        lookup.places[galax] = ReversedPlace(name: rex.name)
        let pin = pinModel(start: nil, lookup)
        await pin.settle(at: galax)
        pin.savedName = "Rex Theater"

        #expect(editor.usePin(try #require(pin.pin)))
        #expect(await editor.leave() == nil)
        let place = try #require(try await store.read { db in try SavedPlace.fetchOne(db) })
        #expect(place.address == rex.name)
    }

    @Test func aFailedLookupWithANameSavesTheLocationWithNoAddress() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(store, placedRecording())
        let pin = pinModel(start: nil, FakeReverseLookup())
        await pin.settle(at: galax)
        pin.savedName = "The barn"

        #expect(editor.usePin(try #require(pin.pin)))
        #expect(editor.edit.place?.name == "The barn")
        #expect(await editor.leave() == nil)
        let place = try #require(try await store.read { db in try SavedPlace.fetchOne(db) })
        #expect(place.name == "The barn")
        #expect(place.address == nil)
        let written = try await stored(store)
        #expect(written.placeID == place.id)
        #expect(written.placeName == nil)
        #expect(written.placeLat == galax.lat)
        #expect(written.placeOrigin == PlaceOrigin.picked.rawValue)
    }

    @Test func theCopyIsSet() {
        #expect(DropPinText.useThisSpot == "Use this spot")
        #expect(DropPinText.hint == "Move the map to place the pin.")
    }

    @Test func thePinStartsAtTheAreaOfTheTypedSearch() async throws {
        let store = try root.open()
        let latest = placedRecording("r2", name: ennis.name, at: ennis.coordinate)
        try await store.write { writer in
            try writer.put(latest, at: noon)
            try writer.put(placedRecording(), at: noon)
        }
        let edit = RecordingLocationEdit(store: store, recording: placedRecording())
        await edit.load()
        let searches = FakePlaceSearches()
        searches.search.local["galax"] = [FakePlaceSearch.local("Galax", "VA", at: galax)]
        let editor = LocationEditorModel(edit: edit, search: { searches.make(near: $0) }, sleep: { _ in })
        #expect(editor.pinStart == ennis.coordinate)

        editor.query = "galax"
        await editor.refresh()
        #expect(editor.pinStart == galax)
    }

    @Test func thePinAndTheSearchStartAtTheCountryCenterWithNothingPlaced() async throws {
        let store = try root.open()
        let center = Coordinate(lat: 39.5, lon: -98.5)
        try await store.setMeta(.countryCenter, to: center)
        try await store.write { writer in try writer.put(placedRecording(), at: noon) }
        let edit = RecordingLocationEdit(store: store, recording: placedRecording())
        await edit.load()
        let searches = FakePlaceSearches()
        let editor = LocationEditorModel(edit: edit, search: { searches.make(near: $0) }, sleep: { _ in })
        #expect(editor.pinStart == center)

        editor.query = "galax"
        await editor.refresh()
        #expect(searches.asked.last == center)
    }

    @Test func thePinStartsAtTheRecording() async throws {
        let store = try root.open()
        let (_, editor) = try await openEditor(store, placedRecording(name: ennis.name, at: ennis.coordinate))
        #expect(editor.pinStart == ennis.coordinate)
    }
}

@Suite struct PinStartTests {
    private let recorded = Coordinate(lat: 1, lon: 1)
    private let device = Coordinate(lat: 2, lon: 2, accuracyM: 10)
    private let area = Coordinate(lat: 3, lon: 3)
    private let latest = Coordinate(lat: 4, lon: 4)
    private let country = Coordinate(lat: 5, lon: 5)

    @Test func theRecordingComesFirst() {
        #expect(
            PinStart.pick(
                recording: recorded, device: device, searchArea: area, latestPlaced: latest, countryCenter: country)
                == recorded)
    }

    @Test func thenTheDevice() {
        #expect(
            PinStart.pick(
                recording: nil, device: device, searchArea: area, latestPlaced: latest, countryCenter: country)
                == device)
    }

    @Test func thenTheAreaOfTheSearch() {
        #expect(
            PinStart.pick(
                recording: nil, device: nil, searchArea: area, latestPlaced: latest, countryCenter: country) == area)
    }

    @Test func thenTheLatestPlacedRecording() {
        #expect(
            PinStart.pick(
                recording: nil, device: nil, searchArea: nil, latestPlaced: latest, countryCenter: country) == latest)
    }

    @Test func thenTheCountryCenter() {
        #expect(
            PinStart.pick(recording: nil, device: nil, searchArea: nil, latestPlaced: nil, countryCenter: country)
                == country)
    }

    @Test func elseTheWholeWorld() {
        #expect(
            PinStart.pick(recording: nil, device: nil, searchArea: nil, latestPlaced: nil, countryCenter: nil) == nil)
    }
}
