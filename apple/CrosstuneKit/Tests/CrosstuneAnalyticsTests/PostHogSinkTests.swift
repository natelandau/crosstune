import CrosstuneTestSupport
import Foundation
@_spi(PostHogInternal) import PostHog
import Synchronization
import Testing

@testable import CrosstuneAnalytics

/// Stands in for the PostHog SDK: records each call, and each capture with the distinct ID it
/// goes out as. Like the SDK, it captures the app's update when its lifecycle integration
/// installs, at the first opt-in after setup.
final class FakePostHog: PostHogBackend {
    static let update = "Application Updated"

    enum Call: Equatable {
        case setup
        case capture(String, as: String)
        case screen(String)
        case identify(String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue])
        case reset
        case register
        case optIn
        case optOut
        case flush
    }

    private struct State {
        var calls: [Call] = []
        var distinctID: String
        var anonymousID: String
        var resets = 0
        var lifecycleInstalled = false
        var sets: [[String: AnalyticsValue]] = []
    }

    private let state: Mutex<State>

    /// - Parameter stored: The distinct ID the SDK kept from an earlier launch; nil for a fresh install.
    init(stored: String? = nil) {
        state = Mutex(State(distinctID: stored ?? "anon-0", anonymousID: "anon-0"))
    }

    var calls: [Call] { state.withLock { $0.calls } }
    var distinctID: String { state.withLock { $0.distinctID } }
    var anonymousID: String { state.withLock { $0.anonymousID } }
    /// The person properties each capture set, in order.
    var sets: [[String: AnalyticsValue]] { state.withLock { $0.sets } }

    /// Every capture, with the distinct ID it went out as.
    var captures: [(name: String, as: String)] {
        calls.compactMap { if case .capture(let name, let id) = $0 { (name, id) } else { nil } }
    }

    private func record(_ call: Call) { state.withLock { $0.calls.append(call) } }

    private func installLifecycle(_ state: inout State) {
        guard !state.lifecycleInstalled else { return }
        state.lifecycleInstalled = true
        state.calls.append(.capture(Self.update, as: state.distinctID))
    }

    func setup() { record(.setup) }

    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue]) {
        state.withLock {
            $0.calls.append(.capture(name, as: $0.distinctID))
            $0.sets.append(set)
        }
    }

    func screen(_ name: String, _ properties: [String: AnalyticsValue]) { record(.screen(name)) }

    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {
        state.withLock {
            $0.calls.append(.identify(distinctID, set: set, setOnce: setOnce))
            $0.distinctID = distinctID
        }
    }

    func reset() {
        state.withLock {
            $0.calls.append(.reset)
            $0.resets += 1
            $0.anonymousID = "anon-\($0.resets)"
            $0.distinctID = $0.anonymousID
        }
    }

    func register(_ properties: [String: String]) { record(.register) }

    func optIn() {
        state.withLock {
            $0.calls.append(.optIn)
            installLifecycle(&$0)
        }
    }

    func optOut() { record(.optOut) }
    func flush() { record(.flush) }
}

struct PostHogSinkTests {
    private let suite = TemporaryDefaults("PostHogSinkTests")
    private let update = FakePostHog.update

    /// A sink over a fake SDK that kept `stored` from an earlier launch, as the sink recorded it.
    private func make(stored: String? = nil) -> (PostHogSink, FakePostHog) {
        let backend = FakePostHog(stored: stored)
        if let stored { suite.defaults.set(stored, forKey: PostHogSink.identifiedKey) }
        return (PostHogSink(backend: backend, superProperties: ["platform": "ios"], defaults: suite.defaults), backend)
    }

    private let none: [String: AnalyticsValue] = [:]

    @Test func aLaunchWithSharingOffNeverSetsUpTheSDK() {
        let (sink, backend) = make(stored: "user_a")

        sink.setEnabled(false, rememberedUserID: "user_a")
        sink.capture("tune_created", [:], set: [:])
        sink.screen(.catalog)
        sink.identify("user_a", set: [:], setOnce: [:])
        sink.reset()
        sink.flush()

        #expect(backend.calls.isEmpty)
    }

    /// The SDK captures the app's install or update as its lifecycle integration installs, so
    /// the super properties must be registered before then or those events go without them.
    @Test(arguments: [(nil, nil), ("user_a", "user_a"), ("user_a", nil), ("user_a", "user_b")])
    func nothingIsCapturedBeforeTheSuperPropertiesAreRegistered(stored: String?, remembered: String?) throws {
        let (sink, backend) = make(stored: stored)

        sink.setEnabled(true, rememberedUserID: remembered)

        let registered = try #require(backend.calls.firstIndex(of: .register))
        let captured = try #require(backend.calls.firstIndex { if case .capture = $0 { true } else { false } })
        #expect(registered < captured)
    }

    // Remembered-user hint at setup, with no user reported yet.

    @Test func aRememberedUserTheSDKHoldsIsKept() {
        let (sink, backend) = make(stored: "user_a")

        sink.setEnabled(true, rememberedUserID: "user_a")
        sink.capture("tune_created", [:], set: [:])

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "user_a"),
                .capture("tune_created", as: "user_a"),
            ])
    }

    @Test func anOfflineLaunchThatNeverIdentifiesKeepsItsPerson() {
        let (sink, backend) = make(stored: "user_a")

        sink.setEnabled(true, rememberedUserID: "user_a")
        sink.capture("Application Opened", [:], set: [:])

        #expect(backend.captures.allSatisfy { $0.as == "user_a" })
        #expect(!backend.calls.contains(.reset))
    }

    @Test func nobodyRememberedForgetsTheStoredUserBeforeAnythingIsSent() {
        let (sink, backend) = make(stored: "user_a")

        sink.setEnabled(true, rememberedUserID: nil)
        sink.capture("tune_created", [:], set: [:])

        #expect(
            backend.calls == [
                .setup, .reset, .register, .optIn, .capture(update, as: "anon-1"),
                .capture("tune_created", as: "anon-1"),
            ])
        #expect(!backend.captures.contains { $0.as == "user_a" })
    }

    @Test func anotherRememberedUserForgetsTheStoredOne() {
        let (sink, backend) = make(stored: "user_a")

        sink.setEnabled(true, rememberedUserID: "user_b")

        #expect(backend.calls.contains(.reset))
        #expect(!backend.captures.contains { $0.as == "user_a" })
    }

    /// A deletion clears the remembered user, so after an update and a relaunch with sharing
    /// turned on, the update is never sent as the deleted person.
    @Test func aDeletedUserIsForgottenBeforeTheUpdateIsSent() {
        let (sink, backend) = make(stored: "user_deleted")
        sink.setEnabled(false, rememberedUserID: nil)

        sink.setEnabled(true, rememberedUserID: nil)

        #expect(backend.captures.map(\.name) == [update])
        #expect(!backend.captures.contains { $0.as == "user_deleted" })
    }

    @Test func aFreshInstallSetsUpAndOptsIn() {
        let (sink, backend) = make()

        sink.setEnabled(true, rememberedUserID: nil)

        #expect(backend.calls == [.setup, .register, .optIn, .capture(update, as: "anon-0")])
    }

    // Users reported while sharing was off.

    @Test func turningSharingOnIdentifiesTheUserSignedInMeanwhile() {
        let (sink, backend) = make(stored: "user_a")
        sink.setEnabled(false, rememberedUserID: "user_a")
        sink.identify("user_a", set: [:], setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")])
        sink.identify("user_a", set: ["catalog_size": .string("10-49")], setOnce: [:])

        sink.setEnabled(true, rememberedUserID: "user_a")

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "user_a"),
                .identify(
                    "user_a", set: ["catalog_size": .string("10-49")],
                    setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")]),
            ])
    }

    @Test func turningSharingOnForAnotherUserForgetsTheStoredOneFirst() {
        let (sink, backend) = make(stored: "user_old")
        sink.setEnabled(false, rememberedUserID: nil)
        sink.identify("user_b", set: [:], setOnce: [:])

        sink.setEnabled(true, rememberedUserID: "user_b")

        #expect(
            backend.calls == [
                .setup, .reset, .register, .optIn, .capture(update, as: "anon-1"),
                .identify("user_b", set: none, setOnce: none),
            ])
    }

    @Test func turningSharingOnAfterASignOutForgetsTheStoredUser() {
        let (sink, backend) = make(stored: "user_a")
        sink.setEnabled(false, rememberedUserID: "user_a")
        sink.reset()

        sink.setEnabled(true, rememberedUserID: nil)

        #expect(!backend.captures.contains { $0.as == "user_a" })
        #expect(backend.calls.contains(.reset))
    }

    @Test func offOnOffOnFollowsTheUserWhoSignedInBetween() {
        let (sink, backend) = make()

        sink.setEnabled(false, rememberedUserID: nil)
        sink.identify("user_a", set: [:], setOnce: [:])
        sink.setEnabled(true, rememberedUserID: "user_a")
        sink.setEnabled(false, rememberedUserID: "user_a")
        sink.capture("tune_created", [:], set: [:])
        sink.reset()
        sink.identify("user_b", set: [:], setOnce: [:])
        sink.setEnabled(true, rememberedUserID: "user_b")
        sink.capture("tune_created", [:], set: [:])

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "anon-0"),
                .identify("user_a", set: none, setOnce: none),
                .optOut,
                .reset, .register, .optIn, .identify("user_b", set: none, setOnce: none),
                .capture("tune_created", as: "user_b"),
            ])
    }

    @Test func turningSharingBackOnForTheSameUserOnlyIdentifiesAgain() {
        let (sink, backend) = make()
        sink.setEnabled(true, rememberedUserID: nil)
        sink.identify("user_a", set: [:], setOnce: [:])

        sink.setEnabled(false, rememberedUserID: "user_a")
        sink.setEnabled(true, rememberedUserID: "user_a")

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "anon-0"),
                .identify("user_a", set: none, setOnce: none),
                .optOut, .optIn, .identify("user_a", set: none, setOnce: none),
            ])
    }

    @Test func anIdentifyForAnotherUserThanTheSDKHoldsResetsFirst() {
        let (sink, backend) = make(stored: "user_old")
        sink.setEnabled(true, rememberedUserID: "user_old")

        sink.identify("user_b", set: [:], setOnce: [:])

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "user_old"), .reset, .register,
                .identify("user_b", set: none, setOnce: none),
            ])
    }

    @Test func aCaptureCarriesItsPersonPropertiesToTheSDK() {
        let (sink, backend) = make()
        sink.setEnabled(true, rememberedUserID: nil)

        sink.capture("setting_changed", [:], set: ["setting_appearance": .string("dark")])

        #expect(backend.sets.last == ["setting_appearance": .string("dark")])
    }

    @Test func aResetWhileSharingPutsTheSuperPropertiesBack() {
        let (sink, backend) = make()
        sink.setEnabled(true, rememberedUserID: nil)

        sink.reset()
        sink.flush()

        #expect(
            backend.calls == [
                .setup, .register, .optIn, .capture(update, as: "anon-0"), .reset, .register,
                .flush,
            ])
    }

    /// The sink's record of the identified user follows the SDK across launches.
    @Test func theIdentifiedUserIsRecordedAndClearedWithTheSDK() {
        let (sink, _) = make()
        sink.setEnabled(true, rememberedUserID: nil)

        sink.identify("user_a", set: [:], setOnce: [:])
        #expect(suite.defaults.string(forKey: PostHogSink.identifiedKey) == "user_a")

        sink.reset()
        #expect(suite.defaults.string(forKey: PostHogSink.identifiedKey) == nil)
    }
}

/// Only named events leave the app, so nothing the PostHog dashboard turns on can capture more.
@Test func theSDKCapturesNothingOnItsOwnButAppLifecycle() {
    let config = LivePostHog.config(token: "phc_test", host: URL(string: "https://relay.example.com")!)

    #expect(config.optOut)
    #expect(!config.persistOptOut)
    #expect(!config.captureScreenViews)
    #expect(config.captureApplicationLifecycleEvents)
    #expect(!config.preloadFeatureFlags)
    #expect(!config.capturePushNotificationSubscriptions)
    #expect(!config.capturePushNotificationOpened)
    #if os(iOS)
        #expect(!config.rageClickConfig.enabled)
        #expect(!config.captureAutocaptureElementText)
        #expect(!config.captureElementInteractions)
        #expect(!config.surveys)
    #endif
}
