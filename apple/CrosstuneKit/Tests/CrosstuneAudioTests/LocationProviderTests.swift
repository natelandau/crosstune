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
    /// The last fix the system holds, which a fresh request can answer from.
    var location: CLLocation?
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

    func hasText() async {
        while pending == nil { await Task.yield() }
    }

    /// Ends the held sleep, as when its time is up.
    func elapse() async {
        await hasText()
        pending?.resume()
        pending = nil
    }
}

@MainActor
@Suite struct LocationProviderTests {
    let clock = HeldSleep()
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func provider(_ manager: FakeLocationManager) -> DeviceLocationProvider {
        DeviceLocationProvider(manager: manager, sleep: { [clock] in await clock.sleep($0) }, now: { [now] in now })
    }

    private func fix(accuracy: CLLocationAccuracy = 14.4, age: TimeInterval = 0) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 39.7392364, longitude: -104.984862), altitude: 0,
            horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: now.addingTimeInterval(-age))
    }

    @Test func aRecentHeldFixAnswersAtOnceWithoutARequest() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        manager.location = fix(accuracy: 20.4, age: DeviceLocationProvider.heldFixMaximumAge)

        let found = await provider(manager).currentLocation()

        #expect(found == Coordinate(lat: 39.7392364, lon: -104.984862, accuracyM: 20))
        #expect(manager.fixRequests == 0)
        #expect(clock.requested.isEmpty)
    }

    @Test func aHeldFixOlderThanAMinuteAsksForANewOne() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        manager.location = fix(age: DeviceLocationProvider.heldFixMaximumAge + 1)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.received([fix(accuracy: 5)])

        #expect(await request.value?.accuracyM == 5)
    }

    @Test func anInvalidHeldFixAsksForANewOne() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        manager.location = fix(accuracy: -1)
        let provider = provider(manager)

        let request = Task { await provider.currentLocation() }
        await fixRequested(manager)
        provider.received([fix(accuracy: 5)])

        #expect(await request.value?.accuracyM == 5)
    }

    @Test func aHeldFixNeverAnswersWhileLocationIsOff() async {
        let manager = FakeLocationManager(status: .denied)
        manager.location = fix()

        #expect(await provider(manager).currentLocation() == nil)
    }

    @Test func theHeldFixAgeMatchesTheWeb() {
        #expect(DeviceLocationProvider.heldFixMaximumAge == 60)
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
        await clock.hasText()
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
        await clock.hasText()
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

    @Test func theLastCallerCancelledLeavesNoDeadlineForTheNextRequest() async {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let provider = provider(manager)
        let first = Task { await provider.currentLocation() }
        await clock.hasText()
        first.cancel()
        #expect(await first.value == nil)

        manager.authorizationStatus = .notDetermined
        let second = Task { await provider.currentLocation() }
        while manager.prompts == 0 { await Task.yield() }
        // The first request's deadline running out must not answer the second.
        await clock.elapse()
        for _ in 0..<10 { await Task.yield() }
        manager.authorizationStatus = .authorizedAlways
        provider.authorizationChanged()
        await fixRequested(manager, count: 2)
        provider.received([fix()])

        #expect(await second.value?.accuracyM == 14)
    }

    @Test func locationServicesOffForTheDeviceAsksForNothing() async {
        let manager = FakeLocationManager(status: .notDetermined)
        manager.location = fix()
        let provider = DeviceLocationProvider(
            manager: manager, sleep: { [clock] in await clock.sleep($0) }, now: { [now] in now },
            servicesEnabled: { false })

        #expect(await provider.currentLocation() == nil)
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

@MainActor
@Suite struct LocationAccessTests {
    @Test(arguments: [
        (CLAuthorizationStatus.notDetermined, LocationAccess.Status.notDetermined),
        (.denied, .off), (.restricted, .off), (.authorizedAlways, .allowed),
    ])
    func readsTheStatusTheDeviceReports(reported: CLAuthorizationStatus, status: LocationAccess.Status) {
        let access = LocationAccess(manager: FakeLocationManager(status: reported))

        #expect(access.status == status)
        #expect(access.isOff == (status == .off))
    }

    @Test func followsAChangeMadeInSettings() {
        let manager = FakeLocationManager(status: .authorizedAlways)
        let access = LocationAccess(manager: manager)
        #expect(manager.delegate != nil)

        manager.authorizationStatus = .denied
        access.authorizationChanged()

        #expect(access.isOff)
    }

    @Test func asksOnceAndWaitsForTheAnswer() async {
        let manager = FakeLocationManager(status: .notDetermined)
        let access = LocationAccess(manager: manager)

        let first = Task { await access.requestAccess() }
        let second = Task { await access.requestAccess() }
        while manager.prompts == 0 { await Task.yield() }
        for _ in 0..<10 { await Task.yield() }
        // The call made as the delegate is set, before the prompt is answered.
        access.authorizationChanged()
        manager.authorizationStatus = .denied
        access.authorizationChanged()
        await first.value
        await second.value

        #expect(manager.prompts == 1)
        #expect(access.status == .off)
    }

    @Test func locationServicesOffForTheDeviceReadsAsOff() async {
        let services = ServicesSetting(enabled: false)
        let manager = FakeLocationManager(status: .notDetermined)
        let access = LocationAccess(manager: manager, servicesEnabled: { await services.enabled })

        await access.refresh()
        #expect(access.status == .off)
        await access.requestAccess()
        #expect(manager.prompts == 0)

        await services.set(true)
        await access.refresh()
        #expect(access.status == .notDetermined)
    }

    @Test func locationServicesTurnedOffWhileThePromptIsUpReleasesTheWaiters() async {
        let services = ServicesSetting(enabled: true)
        let manager = FakeLocationManager(status: .notDetermined)
        let access = LocationAccess(manager: manager, servicesEnabled: { await services.enabled })
        let first = Task { await access.requestAccess() }
        let second = Task { await access.requestAccess() }
        while manager.prompts == 0 { await Task.yield() }
        for _ in 0..<10 { await Task.yield() }

        await services.set(false)
        await access.refresh()
        await first.value
        await second.value

        #expect(access.status == .off)
        #expect(manager.prompts == 1)
    }

    @Test func aChangeReadsLocationServicesAgain() async throws {
        let services = ServicesSetting(enabled: true)
        let manager = FakeLocationManager(status: .authorizedAlways)
        let access = LocationAccess(manager: manager, servicesEnabled: { await services.enabled })
        await access.refresh()
        #expect(access.status == .allowed)

        await services.set(false)
        access.authorizationChanged()

        while access.status != .off { await Task.yield() }
    }

    @Test func anAnsweredDeviceIsNotAskedAgain() async {
        let manager = FakeLocationManager(status: .authorizedAlways)

        await LocationAccess(manager: manager).requestAccess()

        #expect(manager.prompts == 0)
    }
}

/// The device-wide Location Services switch as a test sets it.
actor ServicesSetting {
    private(set) var enabled: Bool

    init(enabled: Bool) {
        self.enabled = enabled
    }

    func set(_ enabled: Bool) {
        self.enabled = enabled
    }
}
