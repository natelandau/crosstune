import CoreLocation
import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// Where the device is, asked for once as a take starts.
@MainActor
public protocol LocationProvider: AnyObject {
    /// The device's position with its reported accuracy, or nil when location is refused,
    /// restricted, or fails.
    func currentLocation() async -> Coordinate?
}

/// The parts of `CLLocationManager` the provider uses, so tests can stand in for it.
protocol LocationManaging: AnyObject {
    var authorizationStatus: CLAuthorizationStatus { get }
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var desiredAccuracy: CLLocationAccuracy { get set }
    func requestWhenInUseAuthorization()
    func requestLocation()
}

extension CLLocationManager: LocationManaging {}

/// The device's position from Core Location, at the best accuracy it gives. With Precise
/// Location off, this is the reduced fix and its larger accuracy.
@MainActor
public final class DeviceLocationProvider: NSObject, LocationProvider {
    typealias Sleep = @MainActor (Duration) async throws -> Void

    /// How long a granted request waits for a fix, matching the web. Time on the permission
    /// prompt does not count, so a slow answer to it does not cost the take its place.
    static let fixTimeout: Duration = .seconds(30)
    /// A wider fix is stored as this, the widest accuracy the API takes.
    private static let widestAccuracyM = Vocabulary.Ranges.Recording.placeAccuracyM.upperBound

    private let manager: any LocationManaging
    private let sleep: Sleep
    /// Every caller waiting on the one request in flight, by a key their cancellation names.
    private var waiting: [(key: Int, continuation: CheckedContinuation<Coordinate?, Never>)] = []
    private var nextKey = 0
    private var awaitingAuthorization = false
    private var deadline: Task<Void, Never>?

    override public convenience init() {
        self.init(manager: CLLocationManager())
    }

    init(manager: any LocationManaging, sleep: @escaping Sleep = { try await Task.sleep(for: $0) }) {
        self.manager = manager
        self.sleep = sleep
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// A cancelled caller gets nil at once, so one waiting on an unanswered prompt is not left
    /// parked.
    public func currentLocation() async -> Coordinate? {
        guard !Task.isCancelled else { return nil }
        let key = nextKey
        nextKey += 1
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                waiting.append((key, continuation))
                if waiting.count == 1 { proceed() }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel(key) }
        }
    }

    func authorizationChanged() {
        // Also called as the delegate is set, before anyone has answered the prompt.
        guard awaitingAuthorization, manager.authorizationStatus != .notDetermined else { return }
        awaitingAuthorization = false
        guard !waiting.isEmpty else { return }
        proceed()
    }

    func received(_ locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let accuracy = location.horizontalAccuracy
        // A negative accuracy marks the fix as invalid.
        guard accuracy >= 0, accuracy.isFinite else { return settle(nil) }
        settle(
            Coordinate(
                lat: location.coordinate.latitude, lon: location.coordinate.longitude,
                accuracyM: Int(min(accuracy, Double(Self.widestAccuracyM)).rounded())))
    }

    func failed() {
        settle(nil)
    }

    private func proceed() {
        switch manager.authorizationStatus {
        case .notDetermined:
            awaitingAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            settle(nil)
        default:
            requestFix()
        }
    }

    private func requestFix() {
        manager.requestLocation()
        deadline?.cancel()
        deadline = Task { [weak self, sleep] in
            do { try await sleep(Self.fixTimeout) } catch { return }
            guard !Task.isCancelled else { return }
            self?.settle(nil)
        }
    }

    private func cancel(_ key: Int) {
        guard let index = waiting.firstIndex(where: { $0.key == key }) else { return }
        waiting.remove(at: index).continuation.resume(returning: nil)
    }

    private func settle(_ coordinate: Coordinate?) {
        deadline?.cancel()
        deadline = nil
        awaitingAuthorization = false
        let settled = waiting
        waiting = []
        for waiter in settled { waiter.continuation.resume(returning: coordinate) }
    }
}

extension DeviceLocationProvider: CLLocationManagerDelegate {
    // The manager calls back on the run loop it was made on, which is the main one.

    nonisolated public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { authorizationChanged() }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated { received(locations) }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        MainActor.assumeIsolated { failed() }
    }
}
