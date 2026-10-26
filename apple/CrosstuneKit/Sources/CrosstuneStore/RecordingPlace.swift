/// A point on Earth, at the precision the device or the search reported.
public struct Coordinate: Hashable, Sendable {
    public let lat: Double
    public let lon: Double
    /// The reported accuracy in whole meters, nil for a place picked by hand.
    public let accuracyM: Int?

    public init(lat: Double, lon: Double, accuracyM: Int? = nil) {
        self.lat = lat
        self.lon = lon
        self.accuracyM = accuracyM
    }
}

/// Where a recording was played: a name to show and the point it names.
public struct RecordingPlace: Hashable, Sendable {
    public let name: String
    public let coordinate: Coordinate

    public init(name: String, coordinate: Coordinate) {
        self.name = name
        self.coordinate = coordinate
    }
}

/// How a recording's coordinates were obtained, as the API stores it.
public enum PlaceOrigin: String, CaseIterable, Sendable {
    /// Read from the device while recording.
    case device
    /// Read from the audio file's own metadata.
    case file
    /// Chosen by the user.
    case picked
}

/// The name to show for a recording's place: its saved location's name while that location
/// is live, else the name the recording carries itself.
public func shownPlaceName(_ recording: Recording, places: [String: SavedPlace]) -> String? {
    if let id = recording.placeID, let place = places[id], place.deletedAt == nil { return place.name }
    return recording.placeName
}
