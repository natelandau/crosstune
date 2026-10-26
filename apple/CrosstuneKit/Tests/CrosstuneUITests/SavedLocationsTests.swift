import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneUI

/// Settings > Saved locations: the places the musician named, with how many recordings use each,
/// renamed and deleted from the page.
@MainActor
@Suite struct SavedLocationsTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func place(_ store: CrosstuneStore, _ name: String, address: String? = nil) async throws -> SavedPlace {
        try await Commands(store: store).createSavedPlace(
            name: name, lat: 36.3, lon: -82.4, address: address, applePlaceID: nil)
    }

    private func putRecording(_ store: CrosstuneStore, _ id: String, placeID: String?, deleted: Bool = false)
        async throws
    {
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: id, deletedAt: deleted ? .now : nil, tuneID: nil, source: "microphone", addedAt: .now,
                    placeLat: 36.3, placeLon: -82.4, placeAccuracyM: 9, placeID: placeID, placeOrigin: "device"))
        }
    }

    private func loaded(_ store: CrosstuneStore) async throws -> SavedLocationsModel {
        let model = SavedLocationsModel(store: store, analytics: sink.client)
        #expect(try await poll { model.rows != nil })
        return model
    }

    @Test func listsSavedPlacesByNameWithRecordingCounts() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall", address: "1 Main St")
        let barn = try await place(store, "barn")
        let gone = try await place(store, "Zed's")
        try await Commands(store: store).deleteSavedPlace(gone.id)
        try await putRecording(store, "r1", placeID: hall.id)
        try await putRecording(store, "r2", placeID: hall.id)
        try await putRecording(store, "r3", placeID: hall.id, deleted: true)
        try await putRecording(store, "r4", placeID: nil)

        let model = try await loaded(store)

        #expect(try await poll { model.rows?.map(\.place.id) == [barn.id, hall.id] })
        #expect(model.rows?.map(\.recordings) == [0, 2])
        #expect(SavedLocationsText.recordingsCount(0) == "0 recordings")
        #expect(SavedLocationsText.recordingsCount(1) == "1 recording")
        #expect(SavedLocationsText.recordingsCount(2) == "2 recordings")
    }

    @Test func emptyStateNamesWhatIsAbsentAndHowToSave() async throws {
        let store = try root.open()

        let model = try await loaded(store)

        #expect(model.rows?.isEmpty == true)
        #expect(SavedLocationsText.emptyHint.contains(NameLocationText.title))
        #expect(!SavedLocationsText.emptyHint.contains("\u{2014}"))
    }

    @Test func renameSavesAtOnce() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)

        let saved = await model.rename(hall.id, to: "  The Hall ")

        #expect(saved)
        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: hall.id) })
        #expect(row.name == "The Hall")
        #expect(try await poll { model.rows?.first?.place.name == "The Hall" })
        #expect(sink.captures == [.init(name: "saved_location_renamed", properties: [:], set: [:])])
    }

    @Test func renamingToTheSameNameOrBlankWritesAndReportsNothing() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)

        #expect(await model.rename(hall.id, to: " Town Hall "))
        #expect(await model.rename(hall.id, to: "   ") == false)

        #expect(model.failure == CommandError.placeNameRequiredMessage)
        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: hall.id) })
        #expect(row.name == "Town Hall")
        #expect(sink.captures.isEmpty)
    }

    @Test func deleteWaitsOnTheConfirmationAndSaysRecordingsKeepTheirLocation() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)
        #expect(try await poll { model.rows?.count == 1 })
        #expect(SavedLocationsText.deleteTitle("Town Hall") == "Delete \"Town Hall\"?")
        #expect(SavedLocationsText.delete == "Delete")
        #expect(SavedLocationsText.deleteMessage.contains("keep their location"))
        #expect(SavedLocationsText.deleteMessage.contains("street address"))

        // Confirming with nothing asked deletes nothing.
        #expect(await model.confirmDelete().value == false)
        model.askDelete(hall.id)
        #expect(model.pendingDelete == hall.id)
        model.cancelDelete()
        #expect(await model.confirmDelete().value == false)

        #expect(model.rows?.count == 1)
        #expect(sink.captures.isEmpty)
        model.askDelete(hall.id)
        #expect(model.rows?.count == 1)
        #expect(await model.confirmDelete().value)
        #expect(model.pendingDelete == nil)
        #expect(try await poll { model.rows?.isEmpty == true })
        #expect(sink.captures == [.init(name: "saved_location_deleted", properties: [:], set: [:])])
    }

    @Test func submitThenFocusLossRenamesOnceAndReportsOnce() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)

        // The field's submit and its focus loss both commit before the live query refreshes.
        async let submit = model.rename(hall.id, to: "The Hall")
        async let focusLoss = model.rename(hall.id, to: "The Hall")
        async let disappear = model.rename(hall.id, to: "The Hall")
        let results = await [submit, focusLoss, disappear]

        #expect(results == [true, true, true])
        #expect(sink.captures == [.init(name: "saved_location_renamed", properties: [:], set: [:])])
        let queued = try await store.pendingChanges(limit: 10).filter { $0.rowID == hall.id }
        #expect(queued.count == 1)
    }

    @Test func anOverLongNameCommittedTwiceRenamesOnceAndReportsOnce() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)
        let limit = Vocabulary.Limits.Place.name
        let long = String(repeating: "G", count: limit + 5)

        #expect(await model.rename(hall.id, to: long))
        #expect(await model.rename(hall.id, to: long))

        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: hall.id) })
        #expect(row.name == String(repeating: "G", count: limit))
        #expect(sink.captures == [.init(name: "saved_location_renamed", properties: [:], set: [:])])
    }

    @Test func aRenameBackToAnOlderNameStillSaves() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)

        #expect(await model.rename(hall.id, to: "The Hall"))
        try await Commands(store: store).renameSavedPlace(hall.id, name: "Elsewhere")
        #expect(await model.rename(hall.id, to: "The Hall"))

        let row = try #require(try await store.read { db in try SavedPlace.fetchOne(db, key: hall.id) })
        #expect(row.name == "The Hall")
        #expect(sink.captures.count == 2)
    }

    @Test func recordingCountsGroupLiveRecordingsInOneQuery() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        for index in 0..<3 { try await putRecording(store, "r\(index)", placeID: hall.id) }

        let model = try await loaded(store)

        #expect(try await poll { model.rows?.first?.recordings == 3 })
    }

    @Test func deletedPlaceLeavesTheList() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let barn = try await place(store, "Barn")
        try await putRecording(store, "r1", placeID: hall.id)
        let model = try await loaded(store)
        #expect(try await poll { model.rows?.count == 2 })

        let deleted = await model.delete(hall.id)

        #expect(deleted)
        #expect(try await poll { model.rows?.map(\.place.id) == [barn.id] })
        #expect(sink.captures == [.init(name: "saved_location_deleted", properties: [:], set: [:])])
        // The recording keeps its own coordinates.
        let recording = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(recording.placeLat == 36.3)
    }

    @Test func deletingAPlaceAnotherDeviceDeletedReportsAFailureAndNothingElse() async throws {
        let store = try root.open()
        let hall = try await place(store, "Town Hall")
        let model = try await loaded(store)
        try await Commands(store: store).deleteSavedPlace(hall.id)

        #expect(await model.delete(hall.id) == false)

        #expect(model.failure == CommandError.placeNotFoundMessage)
        #expect(sink.captures.isEmpty)
    }
}
