import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands

@Suite struct SavedPlacesTests {
    private let root = TemporaryRoot()

    private func recording(_ store: CrosstuneStore, _ id: String) async throws -> Recording {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
    }

    private func seededRecording(_ store: CrosstuneStore) async throws {
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: "r1", tuneID: nil, source: "microphone", addedAt: .now, placeLat: 1.5, placeLon: 2.5,
                    placeAccuracyM: 9, placeOrigin: "device"))
        }
    }

    @Test func createSavedPlaceQueuesAPush() async throws {
        let store = try root.open()
        let commands = Commands(store: store)

        let place = try await commands.createSavedPlace(
            name: "  The Down Home ", lat: 36.3, lon: -82.4, address: "300 W Main St", applePlaceID: "I63802885")

        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: place.id) })
        #expect(row.name == "The Down Home")
        #expect(row.lat == 36.3)
        #expect(row.lon == -82.4)
        #expect(row.address == "300 W Main St")
        #expect(row.applePlaceID == "I63802885")
        let queued = try await store.pendingChanges(limit: 10).filter { $0.rowID == place.id }
        #expect(queued.count == 1)
        #expect(queued.first?.tableName == .places)
        #expect(queued.first?.op == .upsert)
        #expect(queued.first?.data?["name"] == .string("The Down Home"))
        #expect(queued.first?.data?["apple_place_id"] == .string("I63802885"))
        #expect(queued.first?.data?["server_seq"] == nil)
    }

    @Test func refusesABlankNameAndClipsALongOne() async throws {
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.placeNameRequired) {
            try await commands.createSavedPlace(name: "   ", lat: 1, lon: 2, address: nil, applePlaceID: nil)
        }
        let long = String(repeating: "a", count: 300)
        let place = try await commands.createSavedPlace(name: long, lat: 1, lon: 2, address: nil, applePlaceID: nil)
        #expect(place.name.count == 200)
        // A thumbs-up with a skin tone is two scalars, so 150 of them overflow 200 scalars.
        let emoji = String(repeating: "\u{1F44D}\u{1F3FD}", count: 150)
        let clipped = try await commands.createSavedPlace(name: emoji, lat: 1, lon: 2, address: nil, applePlaceID: nil)
        #expect(clipped.name.unicodeScalars.count == 200)
        #expect(clipped.name.count == 100)
    }

    @Test func renameAndDeleteQueuePushes() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let place = try await commands.createSavedPlace(name: "Old", lat: 1, lon: 2, address: nil, applePlaceID: nil)

        try await commands.renameSavedPlace(place.id, name: " New ")
        var queued = try await store.pendingChanges(limit: 10).filter { $0.rowID == place.id }
        #expect(queued.count == 1)
        #expect(queued.first?.data?["name"] == .string("New"))

        try await commands.deleteSavedPlace(place.id)
        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: place.id) })
        #expect(row.deletedAt != nil)
        queued = try await store.pendingChanges(limit: 10).filter { $0.rowID == place.id }
        #expect(queued.count == 1)
        #expect(queued.first?.op == .delete)

        await #expect(throws: CommandError.placeNotFound) {
            try await commands.renameSavedPlace(place.id, name: "Again")
        }
        await #expect(throws: CommandError.placeNotFound) { try await commands.deleteSavedPlace(place.id) }
        await #expect(throws: CommandError.placeNotFound) { try await commands.deleteSavedPlace("missing") }
    }

    @Test func nearbyPickKeepsTheRecordingsCoordinatesAndLinks() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await seededRecording(store)
        let place = try await commands.createSavedPlace(
            name: "The Down Home", lat: 36.3, lon: -82.4, address: nil, applePlaceID: nil)

        try await commands.setRecordingPlace("r1", pick: .nearby(place))

        let row = try await recording(store, "r1")
        #expect(row.placeLat == 1.5)
        #expect(row.placeLon == 2.5)
        #expect(row.placeAccuracyM == 9)
        #expect(row.placeID == place.id)
        #expect(row.placeOrigin == "picked")
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == "r1" })
        #expect(queued.data?["place_id"] == .string(place.id))
        #expect(queued.data?["place_origin"] == .string("picked"))
    }

    @Test func aSavedPickOnARecordingWithNoCoordinatesTakesThePlacesPoint() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(Recording(id: "r1", tuneID: nil, source: "upload", addedAt: .now))
        }
        let place = try await commands.createSavedPlace(
            name: "The Down Home", lat: 36.3, lon: -82.4, address: nil, applePlaceID: nil)

        try await commands.setRecordingPlace("r1", pick: .saved(place))

        let row = try await recording(store, "r1")
        #expect(row.placeLat == 36.3)
        #expect(row.placeLon == -82.4)
        #expect(row.placeAccuracyM == nil)
        #expect(row.placeID == place.id)
        #expect(row.placeOrigin == "picked")
    }

    @Test func searchPickReplacesCoordinatesAndUnlinks() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: "r1", tuneID: nil, source: "microphone", addedAt: .now, placeLat: 1.5, placeLon: 2.5,
                    placeAccuracyM: 9, placeID: "old", placeOrigin: "device"))
        }
        let found = RecordingPlace(name: "Denver, CO", coordinate: Coordinate(lat: 39.7, lon: -104.9))

        try await commands.setRecordingPlace("r1", pick: .search(found, savedPlaceID: nil))

        var row = try await recording(store, "r1")
        #expect(row.placeName == "Denver, CO")
        #expect(row.placeLat == 39.7)
        #expect(row.placeLon == -104.9)
        #expect(row.placeAccuracyM == nil)
        #expect(row.placeID == nil)
        #expect(row.placeOrigin == "picked")

        let saved = try await commands.createSavedPlace(
            name: "Denver", lat: 39.7, lon: -104.9, address: nil, applePlaceID: nil)
        try await commands.setRecordingPlace("r1", pick: .search(found, savedPlaceID: saved.id))
        row = try await recording(store, "r1")
        #expect(row.placeID == saved.id)
        #expect(row.placeOrigin == "picked")

        await #expect(throws: CommandError.placeNotFound) {
            try await commands.setRecordingPlace("r1", pick: .search(found, savedPlaceID: "unknown"))
        }
    }

    @Test func refusesAPickOfAMissingOrDeletedPlaceOrRecording() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        try await seededRecording(store)
        let place = try await commands.createSavedPlace(name: "Gone", lat: 1, lon: 2, address: nil, applePlaceID: nil)
        try await commands.deleteSavedPlace(place.id)
        let deleted = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: place.id) })

        await #expect(throws: CommandError.placeNotFound) {
            try await commands.setRecordingPlace("r1", pick: .saved(deleted))
        }
        await #expect(throws: CommandError.recordingNotFound) {
            try await commands.setRecordingPlace("missing", pick: .saved(deleted))
        }
        let row = try await recording(store, "r1")
        #expect(row.placeID == nil)
    }

    @Test func shownNameUsesTheLiveSavedPlace() {
        let place = SavedPlace(id: "p1", name: "The Down Home", lat: 1, lon: 2)
        let linked = Recording(
            id: "r1", tuneID: nil, source: "microphone", placeName: "Old name", placeLat: 1, placeLon: 2,
            placeID: "p1", placeOrigin: "picked")
        let unnamed = Recording(
            id: "r2", tuneID: nil, source: "microphone", placeLat: 1, placeLon: 2, placeID: "p1",
            placeOrigin: "picked")

        #expect(shownPlaceName(linked, places: ["p1": place]) == "The Down Home")
        #expect(shownPlaceName(unnamed, places: ["p1": place]) == "The Down Home")
    }

    @Test func shownNameFallsBackWhenThePlaceIsDeleted() {
        var place = SavedPlace(id: "p1", name: "The Down Home", lat: 1, lon: 2)
        place.deletedAt = .now
        let linked = Recording(
            id: "r1", tuneID: nil, source: "microphone", placeName: "Old name", placeLat: 1, placeLon: 2,
            placeID: "p1", placeOrigin: "picked")
        let unnamed = Recording(
            id: "r2", tuneID: nil, source: "microphone", placeLat: 1, placeLon: 2, placeID: "p1",
            placeOrigin: "picked")
        let unlinked = Recording(id: "r3", tuneID: nil, source: "microphone", placeName: "Denver, CO")

        #expect(shownPlaceName(linked, places: ["p1": place]) == "Old name")
        #expect(shownPlaceName(linked, places: [:]) == "Old name")
        #expect(shownPlaceName(unnamed, places: ["p1": place]) == nil)
        #expect(shownPlaceName(unlinked, places: ["p1": place]) == "Denver, CO")
    }
}
