import CoreLocation
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Observation

#if canImport(UIKit)
    import UIKit
#endif

/// Where the device is, asked for once as a recording starts.
@MainActor
public protocol LocationProvider: AnyObject {
    /// The device's position with its reported accuracy, or nil when location is refused,
    /// restricted, or fails.
    func currentLocation() async -> Coordinate?
}

/// The parts of `CLLocationManager` the provider uses, so tests can replace it.
protocol LocationManaging: AnyObject {
    var authorizationStatus: CLAuthorizationStatus { get }
    var delegate: (any CLLocationManagerDelegate)? { get set }
    var desiredAccuracy: CLLocationAccuracy { get set }
    /// The last fix the system holds, which can be from before this app asked.
    var location: CLLocation? { get }
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
    /// prompt does not count, so a slow answer to it does not cost the recording its place.
    static let fixTimeout: Duration = .seconds(30)
    /// The oldest fix the system holds that a request takes instead of asking anew, matching
    /// the web's `maximumAge`. A fix takes seconds to settle, so a short recording would otherwise
    /// end before one does.
    static let heldFixMaximumAge: TimeInterval = 60
    /// A wider fix is stored as this, the widest accuracy the API takes.
    private static let widestAccuracyM = Vocabulary.Ranges.Recording.placeAccuracyM.upperBound

    private let manager: any LocationManaging
    private let sleep: Sleep
    private let now: () -> Date
    private let servicesEnabled: @Sendable () async -> Bool
    /// Every caller waiting on the one request in flight, by a key their cancellation names.
    private var waiting: [(key: Int, continuation: CheckedContinuation<Coordinate?, Never>)] = []
    private var nextKey = 0
    private var awaitingAuthorization = false
    private var deadline: Task<Void, Never>?

    override public convenience init() {
        self.init(manager: CLLocationManager(), servicesEnabled: LocationServices.enabled)
    }

    init(
        manager: any LocationManaging, sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { .now }, servicesEnabled: @escaping @Sendable () async -> Bool = { true }
    ) {
        self.manager = manager
        self.sleep = sleep
        self.now = now
        self.servicesEnabled = servicesEnabled
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// A cancelled caller gets nil at once, so one waiting on an unanswered prompt is not left
    /// parked. With Location Services off for the whole device nothing is asked, since asking
    /// shows the system's own alert to turn it on.
    public func currentLocation() async -> Coordinate? {
        guard await servicesEnabled(), !Task.isCancelled else { return nil }
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
        settle(Self.coordinate(location))
    }

    /// `location` as stored, or nil when it is invalid.
    private static func coordinate(_ location: CLLocation) -> Coordinate? {
        let accuracy = location.horizontalAccuracy
        // A negative accuracy marks the fix as invalid.
        guard accuracy >= 0, accuracy.isFinite else { return nil }
        return Coordinate(
            lat: location.coordinate.latitude, lon: location.coordinate.longitude,
            accuracyM: Int(min(accuracy, Double(Self.widestAccuracyM)).rounded()))
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
        if let held = manager.location, now().timeIntervalSince(held.timestamp) <= Self.heldFixMaximumAge,
            let coordinate = Self.coordinate(held)
        {
            return settle(coordinate)
        }
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
        // With no one left waiting, the next request starts afresh rather than inheriting this
        // one's deadline.
        if waiting.isEmpty {
            deadline?.cancel()
            deadline = nil
            awaitingAuthorization = false
        }
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

/// The device-wide Location Services switch.
enum LocationServices {
    /// Read off the main actor, where Core Location warns it can stall the interface.
    @Sendable static func enabled() async -> Bool {
        await Task.detached { CLLocationManager.locationServicesEnabled() }.value
    }
}

/// Whether Crosstune may read where the device is, kept current as the musician answers the
/// prompt or changes it in Settings.
@MainActor
@Observable
public final class LocationAccess {
    public enum Status: Equatable, Sendable {
        /// Never asked, so the next request shows the system prompt.
        case notDetermined
        case allowed
        /// Refused, restricted by the device's owner, or Location Services is off for the whole
        /// device.
        case off
    }

    public private(set) var status: Status

    /// Where the musician turns location access back on.
    public static var settingsURL: URL? {
        #if os(iOS)
            URL(string: UIApplication.openSettingsURLString)
        #else
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")
        #endif
    }

    @ObservationIgnored private let manager: any LocationManaging
    @ObservationIgnored private let servicesEnabled: @Sendable () async -> Bool
    /// The device-wide switch as last read. While it is off, no prompt shows and nothing is
    /// located, whatever the app's own authorization says.
    @ObservationIgnored private var servicesOff = false
    /// Held here, since the manager holds its delegate weakly.
    @ObservationIgnored private var delegate: AuthorizationDelegate?
    @ObservationIgnored private var waiting: [CheckedContinuation<Void, Never>] = []

    public convenience init() {
        self.init(manager: CLLocationManager(), servicesEnabled: LocationServices.enabled)
        Task { await refresh() }
    }

    init(manager: any LocationManaging, servicesEnabled: @escaping @Sendable () async -> Bool = { true }) {
        self.manager = manager
        self.servicesEnabled = servicesEnabled
        status = Self.status(manager.authorizationStatus, servicesOff: false)
        let delegate = AuthorizationDelegate { [weak self] in self?.authorizationChanged() }
        self.delegate = delegate
        manager.delegate = delegate
    }

    /// Reads the device-wide Location Services switch again, and the status with it.
    public func refresh() async {
        servicesOff = !(await servicesEnabled())
        status = Self.status(manager.authorizationStatus, servicesOff: servicesOff)
        // Location Services turned off for the whole device shows no prompt to wait on.
        if servicesOff { resumeWaiting() }
    }

    public var isOff: Bool { status == .off }

    /// Shows the system prompt for access while the app is in use, and returns once it is
    /// answered. Returns at once when it already was.
    public func requestAccess() async {
        guard status == .notDetermined else { return }
        await withCheckedContinuation { continuation in
            waiting.append(continuation)
            if waiting.count == 1 { manager.requestWhenInUseAuthorization() }
        }
    }

    /// Also called when the device-wide switch changes, so that is read again too.
    func authorizationChanged() {
        status = Self.status(manager.authorizationStatus, servicesOff: servicesOff)
        Task { await refresh() }
        // Also called as the delegate is set, before anyone has answered the prompt.
        guard manager.authorizationStatus != .notDetermined else { return }
        resumeWaiting()
    }

    private func resumeWaiting() {
        let answered = waiting
        waiting = []
        for waiter in answered { waiter.resume() }
    }

    private static func status(_ reported: CLAuthorizationStatus, servicesOff: Bool) -> Status {
        if servicesOff { return .off }
        return switch reported {
        case .notDetermined: .notDetermined
        case .denied, .restricted: .off
        default: .allowed
        }
    }
}

/// Passes the manager's authorization changes on to ``LocationAccess``.
@MainActor
private final class AuthorizationDelegate: NSObject, CLLocationManagerDelegate {
    private let changed: @MainActor () -> Void

    init(changed: @escaping @MainActor () -> Void) {
        self.changed = changed
    }

    // The manager calls back on the run loop it was made on, which is the main one.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { changed() }
    }
}
