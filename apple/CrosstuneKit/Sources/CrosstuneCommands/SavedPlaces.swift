import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB

/// How a recording's place is chosen.
public enum PlacePick: Sendable {
    /// A search result. Replaces the coordinates, clears the accuracy, and links the saved
    /// location made from it, if one was.
    case search(RecordingPlace, savedPlaceID: String?)
    /// A saved location near the recording. Keeps the recording's own coordinates.
    case nearby(SavedPlace)
    /// A saved location chosen from the list. Keeps the recording's own coordinates.
    case saved(SavedPlace)
    /// The device's position with its accuracy, linked to the saved location at that spot, if
    /// any. Clears the name, so the server names the spot as it names a captured one.
    case current(Coordinate, savedPlaceID: String?)
    /// A point picked on a map, with no name and no accuracy, so the server names it, linked to
    /// the saved location made there, if one was.
    case point(Coordinate, savedPlaceID: String?)
}

/// `text` trimmed and cut to `limit` Unicode scalars, as the server counts them; nil when nothing is left.
private func cleaned(_ text: String?, limit: Int) -> String? {
    guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return String(String.UnicodeScalarView(trimmed.unicodeScalars.prefix(limit)))
}

/// A saved location's name as a rename stores it, to tell a rename from the name it already has.
public func savedPlaceName(_ name: String) -> String? {
    cleaned(name, limit: Vocabulary.Limits.Place.name)
}

private func liveSavedPlace(_ id: String, db: Database) throws -> SavedPlace {
    guard let place = try SavedPlace.fetchOne(db, key: id), place.deletedAt == nil else {
        throw CommandError.placeNotFound
    }
    return place
}

extension StoreWriter {
    /// Saves a location. Refuses a name that trims to nothing.
    @discardableResult
    public func createSavedPlace(
        name: String, lat: Double, lon: Double, address: String?, applePlaceID: String?, at time: Timestamp = .now
    ) throws -> SavedPlace {
        guard let name = cleaned(name, limit: Vocabulary.Limits.Place.name) else {
            throw CommandError.placeNameRequired
        }
        return try put(
            SavedPlace(
                id: newID(at: time), createdAt: time, name: name, lat: lat, lon: lon,
                address: cleaned(address, limit: Vocabulary.Limits.Place.address),
                applePlaceID: cleaned(applePlaceID, limit: Vocabulary.Limits.Place.applePlaceId)),
            at: time)
    }

    /// Renames a live saved location. Refuses a name that trims to nothing or a missing place.
    public func renameSavedPlace(_ placeID: String, name: String, at time: Timestamp = .now) throws {
        guard let name = savedPlaceName(name) else {
            throw CommandError.placeNameRequired
        }
        var place = try liveSavedPlace(placeID, db: db)
        place.name = name
        try put(place, at: time)
    }

    /// Tombstones a live saved location; refuses a missing one. Recordings keep their link, which the
    /// server clears; each shows its own name meanwhile.
    public func deleteSavedPlace(_ placeID: String, at time: Timestamp = .now) throws {
        _ = try liveSavedPlace(placeID, db: db)
        try tombstone(SavedPlace.self, id: placeID, at: time)
    }

    /// Sets a live recording's place from a pick, and records where it came from: the device
    /// for the current location, else the user's choice. A saved location picked for a recording
    /// with no coordinates lends its own point.
    public func setRecordingPlace(_ recordingID: String, pick: PlacePick, at time: Timestamp = .now) throws {
        guard var recording = try Recording.fetchOne(db, key: recordingID), recording.deletedAt == nil else {
            throw CommandError.recordingNotFound
        }
        switch pick {
        case .search(let place, let savedPlaceID):
            recording.placeName = place.name
            recording.placeLat = place.coordinate.lat
            recording.placeLon = place.coordinate.lon
            recording.placeAccuracyM = nil
            recording.placeID = try savedPlaceID.map { try liveSavedPlace($0, db: db).id }
        case .nearby(let saved), .saved(let saved):
            let place = try liveSavedPlace(saved.id, db: db)
            if recording.placeLat == nil || recording.placeLon == nil {
                recording.placeLat = place.lat
                recording.placeLon = place.lon
                recording.placeAccuracyM = nil
            }
            recording.placeID = place.id
        case .current(let point, let savedPlaceID):
            recording.placeName = nil
            recording.placeLat = point.lat
            recording.placeLon = point.lon
            recording.placeAccuracyM = point.accuracyM
            // The link is only where the fix happens to be, so one deleted since leaves the fix
            // unlinked rather than refusing it, as the server's place job would.
            recording.placeID = try savedPlaceID.flatMap { id in
                try SavedPlace.fetchOne(db, key: id).flatMap { $0.deletedAt == nil ? $0.id : nil }
            }
        case .point(let point, let savedPlaceID):
            recording.placeName = nil
            recording.placeLat = point.lat
            recording.placeLon = point.lon
            recording.placeAccuracyM = nil
            recording.placeID = try savedPlaceID.map { try liveSavedPlace($0, db: db).id }
        }
        if case .current = pick {
            recording.placeOrigin = PlaceOrigin.device.rawValue
        } else {
            recording.placeOrigin = PlaceOrigin.picked.rawValue
        }
        try put(recording, at: time)
        try requeueFailedUpload(recordingID, at: time)
    }
}

extension Commands {
    @discardableResult
    public func createSavedPlace(
        name: String, lat: Double, lon: Double, address: String?, applePlaceID: String?, at time: Timestamp = .now
    ) async throws -> SavedPlace {
        try await store.write { writer in
            try writer.createSavedPlace(
                name: name, lat: lat, lon: lon, address: address, applePlaceID: applePlaceID, at: time)
        }
    }

    public func renameSavedPlace(_ placeID: String, name: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.renameSavedPlace(placeID, name: name, at: time) }
    }

    public func deleteSavedPlace(_ placeID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.deleteSavedPlace(placeID, at: time) }
    }

    public func setRecordingPlace(_ recordingID: String, pick: PlacePick, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.setRecordingPlace(recordingID, pick: pick, at: time) }
    }
}
