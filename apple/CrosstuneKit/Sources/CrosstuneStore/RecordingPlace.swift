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

/// Where a recording was played: a name to show and the point it stands for.
public struct RecordingPlace: Hashable, Sendable {
    public let name: String
    public let coordinate: Coordinate

    public init(name: String, coordinate: Coordinate) {
        self.name = name
        self.coordinate = coordinate
    }
}
