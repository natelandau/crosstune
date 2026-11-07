import CrosstuneStore
import CrosstuneSync
import Foundation
import Observation

/// The spot a pin marks, as Use this spot hands it to the location editor, with no accuracy.
struct DroppedPin: Hashable, Sendable {
    let coordinate: Coordinate
    /// The street address the server named the spot by; nil when the lookup found none or
    /// failed, so the server names the spot once the edit syncs.
    let name: String?
    /// The whole address the server gave the spot, which a saved location keeps; nil when it
    /// gave none.
    let address: String?
    /// The name typed for a new saved location, trimmed; nil when none was.
    let savedName: String?
}

/// The pin map's state: the spot under the pin once the map settles, the place the server names
/// there, and the name typed for it.
@MainActor
@Observable
final class DropPinModel {
    typealias Lookup = @MainActor (Coordinate) async -> ReversedPlace?

    /// Closer than this, two settled points are the same spot, so a map that settles where it
    /// started looks nothing up again.
    static let sameSpotM = 1.0

    /// The spot under the pin; nil while a map opened on the whole world has not settled.
    private(set) var center: Coordinate?
    /// The place the server named at ``center``; nil until it answers, and for good when the
    /// lookup finds none or fails.
    private(set) var found: ReversedPlace?
    /// Set while the lookup for ``center`` runs.
    private(set) var isLookingUp = false
    var savedName = ""

    @ObservationIgnored private let lookup: Lookup
    /// The lookup for ``center``, owned here so a settle on the same spot never cancels it.
    @ObservationIgnored private var running: Task<Void, Never>?
    /// Set once the lookup for ``center`` has answered, a place or none.
    @ObservationIgnored private var isAnswered = false
    /// Set once the map goes, after which no settle looks anything up.
    @ObservationIgnored private var isClosed = false

    /// - Parameter start: Where the map opens, with any accuracy dropped; nil opens on the
    ///   whole world.
    init(start: Coordinate?, lookup: @escaping Lookup) {
        center = start.map { Coordinate(lat: $0.lat, lon: $0.lon) }
        self.lookup = lookup
    }

    /// The spot Use this spot stages; nil until the map has a point.
    var pin: DroppedPin? {
        guard let center else { return nil }
        let typed = savedName.trimmingCharacters(in: .whitespacesAndNewlines)
        return DroppedPin(
            coordinate: center, name: found?.name, address: found?.address, savedName: typed.isEmpty ? nil : typed)
    }

    /// Looks up the place at `point`, where the map settled, and returns once the lookup for
    /// that spot ends. A spot already looked up, or being looked up, asks nothing more. A new spot
    /// cancels the lookup it replaces, whose answer is dropped. On a map opened on the whole world,
    /// a settle the musician did not cause sets nothing, so the world's center is never a pin.
    func settle(at point: Coordinate, movedByUser: Bool = true) async {
        guard !isClosed, movedByUser || center != nil else { return }
        let point = Coordinate(lat: point.lat, lon: point.lon)
        if let center, Self.isSameSpot(center, point), running != nil || isAnswered {
            await running?.value
            return
        }
        running?.cancel()
        center = point
        found = nil
        isAnswered = false
        isLookingUp = true
        let lookup = lookup
        let task = Task {
            let place = await lookup(point)
            // A cancelled lookup was replaced, so its nil is not "nothing here".
            guard !Task.isCancelled, center == point else { return }
            isLookingUp = false
            found = place
            isAnswered = true
            running = nil
        }
        running = task
        await task.value
    }

    /// Stops the lookup running and every settle after it, as the map goes.
    func cancel() {
        isClosed = true
        running?.cancel()
        running = nil
        isLookingUp = false
    }

    private static func isSameSpot(_ one: Coordinate, _ other: Coordinate) -> Bool {
        PlaceDistances.meters(one, other.lat, other.lon) < sameSpotM
    }
}
