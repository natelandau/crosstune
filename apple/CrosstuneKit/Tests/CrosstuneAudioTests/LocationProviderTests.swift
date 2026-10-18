import CoreLocation
import CrosstuneStore
import CrosstuneVocabulary
import Testing

@testable import CrosstuneAudio

/// Core Location as a test sets it: the status it reports and what it was asked to do.
final class FakeLocationManager: LocationManaging {
    var authorizationStatus: CLAuthorizationStatus
    weak var delegate: (any CLLocationManagerDelegate)?
    var desiredAccuracy: CLLocationAccuracy = 0
    private(set) var prompts = 0
    private(set) var fixRequests = 0

    init(status: CLAuthorizationStatus) {
        authorizationStatus = status
    }

    func requestWhenInUseAuthorization() { prompts += 1 }
    func requestLocation() { fixRequests += 1 }
}

/// A sleep that ends only when the test says so, recording each one asked for.
@MainActor
final class HeldSleep {
    private(set) var requested: [Duration] = []
    private var pending: CheckedContinuation<Void, Never>?

    func sleep(_ duration: Duration) async {
        requested.append(duration)
        await withCheckedContinuation { pending = $0 }
    }

    func isHeld() async {
        while pending == nil { await Task.yield() }
    }

    /// Ends the held sleep, as when its time is up.
    func elapse() async {
        await isHeld()
        pending?.resume()
        pending = nil
    }
}

@MainActor
@Suite struct LocationProviderTests {
    let clock = HeldSleep()

    private func provider(_ manager: FakeLocationManager) -> DeviceLocationProvider {
        DeviceLocationProvider(manager: manager, sleep: { [clock] in await clock.sleep($0) })
    }

    private func fix(accuracy: CLLocationAccuracy = 14.4) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 39.7392364, longitude: -104.984862), altitude: 0,
            horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: .now)
    }

    /// Waits until the provider has asked the manager for a fix `count` times.
    private func fixRequested(_ manager: FakeLocationManager, count: Int = 1) async {
        while manager.fixRequests < count { await Task.yield() }
    }

    @Test func setsItselfUpForTheBestAccuracy() {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        #expect(manager.delegate === provider)
        #expect(manager.desiredAccuracy == kCLLocationAccuracyBest)
    }

    @Test func anAllowedRequestReturnsTheFixWithItsAccuracyInWholeMeters() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.received([fix(accuracy: 14.4)])

        #expect(await request.value == Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 14))
        #expect(manager.prompts == 0)
        #expect(manager.fixRequests == 1)
    }

    @Test func storesAnAccuracyWiderThanTheAPITakesAsItsWidest() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)
        let widest = Vocabulary.Ranges.Recording.placeAccuracyM.upperBound

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.received([fix(accuracy: Double(widest) * 3)])

        #expect(await request.value?.accuracyM == widest)
    }

    @Test(arguments: [CLAuthorizationStatus.denied, .restricted])
    func aRefusedOrRestrictedDeviceReturnsNothingWithoutPrompting(status: CLAuthorizationStatus) async {
        let manager = FakeLocationManager(status: status)

        #expect(await provider(manager).currentLocation() == nil)
        #expect(manager.prompts == 0)
        #expect(manager.fixRequests == 0)
    }

    @Test func promptsOnceThenAskForAFixWhenAllowed() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        while manager.prompts == 0 { await Task.yield() }
        // The call made as the delegate is set, before the prompt is answered.
        provider.authorizationChanged()
        #expect(manager.fixRequests == 0)

        manager.authorizationStatus = .authorizedAlways
        provider.authorizationChanged()
        await fixRequested(manager)
        provider.received([fix()])

        #expect(await request.value?.accuracyM == 14)
        #expect(manager.prompts == 1)
    }

    @Test func aDeniedPromptReturnsNothing() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        while manager.prompts == 0 { await Task.yield() }
        manager.authorizationStatus = .denied
        provider.authorizationChanged()

        #expect(await request.value == nil)
        #expect(manager.fixRequests == 0)
    }

    @Test func aFailedFixReturnsNothing() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.failed()

        #expect(await request.value == nil)
    }

    @Test func anInvalidFixReturnsNothing() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.received([fix(accuracy: -1)])

        #expect(await request.value == nil)
    }

    @Test func aSecondCallerJoinsTheRequestInFlight() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        let first = Task { await provider.currentLocation() }
        await fixRequested(manager)
        let second = Task { await provider.currentLocation() }
        await clock.isHeld()
        for _ in 0..<10 { await Task.yield() }
        provider.received([fix()])
        // A late duplicate callback resumes no one twice.
        provider.received([fix()])

        #expect(await first.value?.accuracyM == 14)
        #expect(await second.value?.accuracyM == 14)
        #expect(manager.fixRequests == 1)
    }

    @Test func noFixWithinTheTimeoutReturnsNothing() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await clock.elapse()

        #expect(await request.value == nil)
        #expect(clock.requested == [DeviceLocationProvider.fixTimeout])
        // A fix after the timeout finds no one waiting.
        provider.received([fix()])
    }

    @Test func thePermissionPromptDoesNotCountAgainstTheTimeout() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        while manager.prompts == 0 { await Task.yield() }
        for _ in 0..<10 { await Task.yield() }
        #expect(clock.requested.isEmpty)

        manager.authorizationStatus = .authorizedAlways
        provider.authorizationChanged()
        await clock.isHeld()
        #expect(clock.requested == [DeviceLocationProvider.fixTimeout])
        provider.received([fix()])

        #expect(await request.value?.accuracyM == 14)
    }

    @Test func aCallerCancelledBeforeAskingNeitherPromptsNorRequests() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let provider = provider(manager)

        let request = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return await provider.currentLocation()
        }

        #expect(await request.value == nil)
        #expect(manager.prompts == 0)
        #expect(manager.fixRequests == 0)
    }

    @Test func aCancelledCallerOnAnUnansweredPromptGetsNothing() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        while manager.prompts == 0 { await Task.yield() }
        request.cancel()

        #expect(await request.value == nil)
    }
}
