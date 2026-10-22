import CoreLocation
import CrosstuneStore
import Foundation
import MapKit

/// The distances the location page works to, the same on every client.
enum PlaceDistances {
    /// How far from a take the page looks for places near it.
    static let nearbyRadiusM = 150.0
    /// The most places the page lists as near a take.
    static let nearbyLimit = 10
    /// How close a saved location sits to count as the same spot.
    static let matchRadiusM = 30.0
    /// The loosest fix that is precise enough to name or match a spot.
    static let preciseAccuracyM = 50

    /// The distance between two points in meters, along the Earth's surface.
    static func meters(_ from: Coordinate, _ toLat: Double, _ toLon: Double) -> Double {
        CLLocation(latitude: from.lat, longitude: from.lon).distance(
            from: CLLocation(latitude: toLat, longitude: toLon))
    }

    /// Whether a point with `accuracyM` is precise: a fix of at most 50 m, or a point with no
    /// accuracy, as a file location and a pick have.
    static func isPrecise(accuracyM: Int?) -> Bool {
        accuracyM.map { $0 <= preciseAccuracyM } ?? true
    }
}

extension SavedPlace {
    /// The live saved location a pick stands for, so a repeat pick links rather than saves twice:
    /// the one with its Apple Maps id, else one of its name, trimmed and in any case, within 30 m.
    /// The name match also covers an id, since a place saved from a search with no id has none.
    /// The same rule as the web client's `savedPlaceFor`.
    static func existing(
        name: String, lat: Double, lon: Double, applePlaceID: String?, in places: [SavedPlace]
    ) -> SavedPlace? {
        let live = places.filter { $0.deletedAt == nil }
        let key = { (text: String) in text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let appleID = applePlaceID?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let appleID, !appleID.isEmpty, let match = live.first(where: { $0.applePlaceID == appleID }) {
            return match
        }
        let point = Coordinate(lat: lat, lon: lon)
        return live.first {
            key($0.name) == key(name) && PlaceDistances.meters(point, $0.lat, $0.lon) <= PlaceDistances.matchRadiusM
        }
    }

    /// The live saved location `draft` stands for, by ``existing(name:lat:lon:applePlaceID:in:)``.
    static func existing(for draft: SavedPlaceDraft, in places: [SavedPlace]) -> SavedPlace? {
        existing(name: draft.name, lat: draft.lat, lon: draft.lon, applePlaceID: draft.applePlaceID, in: places)
    }
}

/// A place of interest near a take, which picking saves as a location at its own point.
public struct NearbyPlace: Hashable, Sendable {
    public let name: String
    /// The street address line shown under the name.
    public let address: String?
    public let lat: Double
    public let lon: Double
    public let applePlaceID: String?

    public init(name: String, address: String?, lat: Double, lon: Double, applePlaceID: String?) {
        self.name = name
        self.address = address
        self.lat = lat
        self.lon = lon
        self.applePlaceID = applePlaceID
    }

    var draft: SavedPlaceDraft {
        SavedPlaceDraft(name: name, address: address, lat: lat, lon: lon, applePlaceID: applePlaceID)
    }
}

/// Finds the venues near a point, nearest first.
@MainActor
public protocol NearbySearch: AnyObject {
    init()
    func places(near center: Coordinate, radiusM: Double, limit: Int) async throws -> [NearbyPlace]
}

/// One row of the location page's Nearby list: a saved location or a venue not yet saved.
enum NearbyRow: Hashable {
    case saved(SavedPlace)
    case venue(NearbyPlace)

    var name: String {
        switch self {
        case .saved(let place): place.name
        case .venue(let place): place.name
        }
    }

    var address: String? {
        switch self {
        case .saved(let place): place.address
        case .venue(let place): place.address
        }
    }
}

/// Nearby venues on the device through MapKit, which needs no key and spends no server quota.
@MainActor
public final class MapKitNearbySearch: NearbySearch {
    /// The kinds of place people play music in: bars, venues, theaters, cafes, restaurants, and
    /// community spaces.
    private static let venues: [MKPointOfInterestCategory] = [
        .musicVenue, .nightlife, .theater, .movieTheater, .cafe, .restaurant, .brewery, .winery, .distillery,
        .library, .museum, .school, .university, .conventionCenter, .fairground, .park, .campground, .stadium,
    ]

    public required init() {}

    // Only the deprecated placemark carries the US state code the name rule needs, and the
    // street on its own; nothing that replaces it does.
    @diagnose(DeprecatedDeclaration, as: ignored)
    public func places(near center: Coordinate, radiusM: Double, limit: Int) async throws -> [NearbyPlace] {
        let request = MKLocalPointsOfInterestRequest(
            center: CLLocationCoordinate2D(latitude: center.lat, longitude: center.lon), radius: radiusM)
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: Self.venues)
        let items = try await MKLocalSearch(request: request).start().mapItems
        let found = items.compactMap { item -> (NearbyPlace, Double)? in
            let placemark = item.placemark
            let street = placemark.postalAddress?.street.replacingOccurrences(of: "\n", with: ", ")
            guard
                let saved = PlaceNames.savedLocation(
                    name: item.name, isPointOfInterest: true, street: street, locality: placemark.locality,
                    subLocality: placemark.subLocality, formattedAddress: item.address?.fullAddress,
                    administrativeAreaCode: placemark.administrativeArea, countryCode: placemark.isoCountryCode,
                    country: placemark.country)
            else { return nil }
            let point = item.location.coordinate
            let place = NearbyPlace(
                name: saved.name, address: saved.address, lat: point.latitude, lon: point.longitude,
                applePlaceID: item.identifier?.rawValue)
            return (place, PlaceDistances.meters(center, point.latitude, point.longitude))
        }
        return found.filter { $0.1 <= radiusM }.sorted { $0.1 < $1.1 }.prefix(limit).map(\.0)
    }
}
