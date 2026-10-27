import Contacts
import CrosstuneDesign
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import MapKit

/// One suggestion while a place is typed, resolved to a place only once it is picked. Not
/// `Sendable`: its token is a MapKit object, which stays on the main actor.
public struct PlaceCompletion: Hashable {
    public let title: String
    public let subtitle: String
    /// What the search needs to resolve this suggestion.
    let token: AnyHashable
}

/// A saved location a pick makes once the edit is saved.
public struct SavedPlaceDraft: Hashable, Sendable {
    public let name: String
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
}

/// A search result once picked: the place it sets, and the saved location it makes when it is a
/// venue or a street address. A town makes none.
public struct PickedPlace: Hashable, Sendable {
    public let place: RecordingPlace
    public let saving: SavedPlaceDraft?

    public init(place: RecordingPlace, saving: SavedPlaceDraft?) {
        self.place = place
        self.saving = saving
    }
}

/// Searches for a venue, street address, or town, for a place picked by hand.
@MainActor
public protocol PlaceSearching: AnyObject {
    init()
    /// The suggestions for `query`, empty when there are none or the search fails.
    func completions(for query: String) async -> [PlaceCompletion]
    /// The place `completion` names, named as picked, nil when it cannot be found.
    func resolve(_ completion: PlaceCompletion) async -> PickedPlace?
}

/// What ``MapKitPlaceSearch`` asks of a completer, so its waiting can be tested without MapKit.
@MainActor
protocol PlaceCompleting: AnyObject {
    var queryFragment: String { get set }
    var completions: [PlaceCompletion] { get }
    /// Told each time the completer answers: the fragment it answers, and whether it found anything.
    var onAnswer: ((String, Bool) -> Void)? { get set }
}

/// Place search on the device through MapKit, which needs no key and spends no server quota.
/// Each search holds its own completer, so two windows searching at once never share one.
@MainActor
public final class MapKitPlaceSearch: PlaceSearching {
    private let completer: any PlaceCompleting
    /// Every search waiting on the completer's current fragment, by a key of its own.
    private var waiting: [UUID: CheckedContinuation<Void, Never>] = [:]
    /// The fragment ``answer`` answers. Nil while the current fragment has no answer yet.
    private var answeredFragment: String?
    private var answer: [PlaceCompletion] = []

    public required convenience init() {
        self.init(completer: MapKitCompleter())
    }

    init(completer: any PlaceCompleting) {
        self.completer = completer
        completer.onAnswer = { [weak self] fragment, found in self?.answered(fragment, found: found) }
    }

    public func completions(for query: String) async -> [PlaceCompletion] {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard typed.count >= PlaceSearchModel.minimumQuery else { return [] }
        if query == answeredFragment { return answer }
        let key = UUID()
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { return continuation.resume() }
                waiting[key] = continuation
                // A search for the fragment still running joins the wait rather than restart it.
                guard query != completer.queryFragment else { return }
                // A newer fragment takes over the completer, so every other search stops waiting.
                for (other, waiter) in waiting where other != key {
                    waiting[other] = nil
                    waiter.resume()
                }
                answeredFragment = nil
                completer.queryFragment = query
            }
        } onCancel: {
            Task { @MainActor in self.stopWaiting(key) }
        }
        return query == answeredFragment ? answer : []
    }

    // Only the deprecated placemark carries the US state code the name rule needs, and the
    // street on its own; nothing that replaces it does.
    @diagnose(DeprecatedDeclaration, as: ignored)
    public func resolve(_ completion: PlaceCompletion) async -> PickedPlace? {
        guard let picked = completion.token.base as? MKLocalSearchCompletion else { return nil }
        let response = try? await MKLocalSearch(request: MKLocalSearch.Request(completion: picked)).start()
        guard let item = response?.mapItems.first else { return nil }
        let placemark = item.placemark
        // The postal street is the street line in the country's own order, as the API's
        // `fullThoroughfare` is.
        let street = placemark.postalAddress?.street.replacingOccurrences(of: "\n", with: ", ")
        let isPointOfInterest = item.pointOfInterestCategory != nil
        guard
            let name = PlaceNames.picked(
                name: item.name, isPointOfInterest: isPointOfInterest, street: street,
                locality: placemark.locality, subLocality: placemark.subLocality,
                formattedAddress: item.address?.fullAddress, administrativeAreaCode: placemark.administrativeArea,
                countryCode: placemark.isoCountryCode, country: placemark.country)
        else { return nil }
        let point = item.location.coordinate
        let saving = PlaceNames.savedLocation(
            name: item.name, isPointOfInterest: isPointOfInterest, street: street, locality: placemark.locality,
            subLocality: placemark.subLocality, formattedAddress: item.address?.fullAddress,
            administrativeAreaCode: placemark.administrativeArea, countryCode: placemark.isoCountryCode,
            country: placemark.country)
        return PickedPlace(
            place: RecordingPlace(name: name, coordinate: Coordinate(lat: point.latitude, lon: point.longitude)),
            saving: saving.map {
                SavedPlaceDraft(
                    name: $0.name, address: $0.address, lat: point.latitude, lon: point.longitude,
                    applePlaceID: item.identifier?.rawValue)
            })
    }

    var waitingSearches: Int { waiting.count }

    private func answered(_ fragment: String, found: Bool) {
        guard fragment == completer.queryFragment else { return }
        answeredFragment = fragment
        answer = found ? completer.completions : []
        let waiters = waiting.values
        waiting = [:]
        for waiter in waiters { waiter.resume() }
    }

    private func stopWaiting(_ key: UUID) {
        waiting.removeValue(forKey: key)?.resume()
    }
}

/// `MKLocalSearchCompleter` for venues, addresses, and towns anywhere, answering through ``onAnswer``. Each fragment
/// gets a completer of its own, since MapKit does not say which fragment an answer is for, so an
/// answer from a replaced completer is known to be stale and dropped.
@MainActor
private final class MapKitCompleter: NSObject, PlaceCompleting, @preconcurrency MKLocalSearchCompleterDelegate {
    private var completer: MKLocalSearchCompleter?
    var onAnswer: ((String, Bool) -> Void)?

    var queryFragment: String {
        get { completer?.queryFragment ?? "" }
        set {
            completer?.delegate = nil
            completer?.cancel()
            let fresh = MKLocalSearchCompleter()
            // No region is set, so an address that repeats across states lists every match.
            // Query completions are left out: one names a category, not a place to pick.
            fresh.resultTypes = [.pointOfInterest, .address, .physicalFeature]
            fresh.delegate = self
            fresh.queryFragment = newValue
            completer = fresh
        }
    }

    var completions: [PlaceCompletion] {
        (completer?.results ?? []).map { PlaceCompletion(title: $0.title, subtitle: $0.subtitle, token: $0) }
    }

    func completerDidUpdateResults(_ sender: MKLocalSearchCompleter) {
        guard sender === completer else { return }
        onAnswer?(sender.queryFragment, true)
    }

    func completer(_ sender: MKLocalSearchCompleter, didFailWithError _: any Error) {
        guard sender === completer else { return }
        onAnswer?(sender.queryFragment, false)
    }
}

/// A place's display name, by the same rules as the API's `places/names.py`. A town is
/// `locality, ST` in the US, `locality, Country` elsewhere, and the result's own name when it has
/// no locality. The locality is the town the mailing address names. Cut to the length the server
/// stores, since a longer name would never sync.
enum PlaceNames {
    static func name(
        locality: String?, subLocality: String? = nil, formattedAddress: String? = nil, administrativeAreaCode: String?,
        countryCode: String?, country: String?, fallback: String?
    ) -> String? {
        let town = town(
            locality: mailingTown(locality: locality, subLocality: subLocality, formattedAddress: formattedAddress),
            administrativeAreaCode: administrativeAreaCode, countryCode: countryCode, country: country)
        return (town ?? text(fallback)).flatMap(stored)
    }

    /// The name a search result stores once picked: a named place is `Name, street, town`, a street
    /// address `street, town`, and a town as ``name(locality:administrativeAreaCode:countryCode:country:fallback:)``
    /// names it.
    static func picked(
        name: String?, isPointOfInterest: Bool, street: String?, locality: String?, subLocality: String? = nil,
        formattedAddress: String? = nil, administrativeAreaCode: String?, countryCode: String?, country: String?
    ) -> String? {
        let own = text(name)
        let street = text(street)
        let town = town(
            locality: mailingTown(locality: locality, subLocality: subLocality, formattedAddress: formattedAddress),
            administrativeAreaCode: administrativeAreaCode, countryCode: countryCode, country: country)
        if let own, isVenue(own, isPointOfInterest: isPointOfInterest, street: street) {
            return stored(joined(own, street, town))
        }
        if let street { return stored(joined(street, town)) }
        return Self.name(
            locality: locality, subLocality: subLocality, formattedAddress: formattedAddress,
            administrativeAreaCode: administrativeAreaCode, countryCode: countryCode, country: country, fallback: name)
    }

    /// The saved location a picked search result or nearby venue makes: a venue keeps its own name
    /// with `street, town` as the address, and a street address is named `street, town` with no
    /// address. A town makes none, nil.
    static func savedLocation(
        name: String?, isPointOfInterest: Bool, street: String?, locality: String?, subLocality: String? = nil,
        formattedAddress: String? = nil, administrativeAreaCode: String?, countryCode: String?, country: String?
    ) -> (name: String, address: String?)? {
        let own = text(name)
        let street = text(street)
        let town = town(
            locality: mailingTown(locality: locality, subLocality: subLocality, formattedAddress: formattedAddress),
            administrativeAreaCode: administrativeAreaCode, countryCode: countryCode, country: country)
        if let own, isVenue(own, isPointOfInterest: isPointOfInterest, street: street) {
            guard let saved = capped(own, Vocabulary.Limits.Place.name) else { return nil }
            let line = street.map { joined($0, town) } ?? town
            return (saved, line.flatMap { capped($0, Vocabulary.Limits.Place.address) })
        }
        guard let street, let saved = capped(joined(street, town), Vocabulary.Limits.Place.name) else { return nil }
        return (saved, nil)
    }

    /// Whether a result named `own` is a venue rather than a street address: it has a category, or
    /// a name other than its street.
    private static func isVenue(_ own: String, isPointOfInterest: Bool, street: String?) -> Bool {
        isPointOfInterest || street.map { own.caseInsensitiveCompare($0) != .orderedSame } == true
    }

    /// The sub-locality when the formatted address names it, else the locality. Apple Maps sets every
    /// New York City borough's locality to New York and puts the borough, the town on its mail, in
    /// the sub-locality. Elsewhere a sub-locality is a neighborhood the address leaves out. The
    /// placemark's postal city is no help: it says New York for Brooklyn too.
    private static func mailingTown(locality: String?, subLocality: String?, formattedAddress: String?) -> String? {
        guard let sub = text(subLocality), let address = formattedAddress else { return locality }
        let parts = address.split(whereSeparator: { $0 == "," || $0.isNewline })
        let named = parts.contains {
            $0.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(sub) == .orderedSame
        }
        return named ? sub : locality
    }

    /// `locality, ST` in the US, `locality, Country` elsewhere, nil without a locality.
    private static func town(
        locality: String?, administrativeAreaCode: String?, countryCode: String?, country: String?
    ) -> String? {
        guard let locality = text(locality) else { return nil }
        let qualifier = countryCode == "US" ? text(administrativeAreaCode) : text(country)
        return qualifier.map { "\(locality), \($0)" } ?? locality
    }

    private static func joined(_ parts: String?...) -> String {
        parts.compactMap(\.self).joined(separator: ", ")
    }

    /// `name` cut to the stored length, without the separator a cut can leave dangling. Nil when
    /// nothing else is left.
    private static func stored(_ name: String) -> String? {
        capped(name, Vocabulary.Limits.Recording.placeName)
    }

    /// `text` cut to `limit` code points, without the separator a cut can leave dangling. Nil when
    /// nothing else is left.
    private static func capped(_ text: String, _ limit: Int) -> String? {
        var capped = Substring(text.cappedCodePoints(limit))
        while let last = capped.last, last == "," || last.isWhitespace { capped.removeLast() }
        return capped.isEmpty ? nil : String(capped)
    }

    private static func text(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
