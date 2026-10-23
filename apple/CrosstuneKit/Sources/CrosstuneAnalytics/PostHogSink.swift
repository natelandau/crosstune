import Foundation
@_spi(PostHogInternal) @preconcurrency import PostHog
import Synchronization

/// What `PostHogSink` needs from the PostHog SDK, so its consent rules run in tests without it.
protocol PostHogBackend: Sendable {
    /// Sets the SDK up opted out, so it installs no integrations and captures nothing until
    /// `optIn`, which installs the app lifecycle integration and can capture at once.
    func setup()
    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue])
    func screen(_ name: String, _ properties: [String: AnalyticsValue])
    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue])
    func reset()
    func register(_ properties: [String: String])
    func optIn()
    func optOut()
    func flush()
    var distinctID: String { get }
    var anonymousID: String { get }
}

/// Sends analytics to PostHog while the musician shares usage data. The app's stored choice is
/// the only consent store: with sharing off at launch the SDK is never set up, so nothing at all
/// leaves the device. Opted out is not enough, since setup stores a device ID and fetches the
/// project's remote config either way. Meanwhile the sink keeps who is signed in, so turning sharing on sends as
/// the right person.
final class PostHogSink: AnalyticsSink {
    /// The user the SDK was last identified as, kept so the sink can tell before setup whether
    /// the SDK's stored person must be forgotten. The SDK's own storage is unreadable until then.
    static let identifiedKey = "analyticsIdentifiedUserID"

    private enum Phase {
        /// Never set up this launch.
        case dormant
        /// Never set up, with no choice yet: events wait in memory for the regional default.
        case pending
        case sharing
        /// Set up, then opted out.
        case stopped
    }

    private struct Identity {
        var userID: String?
        var set: [String: AnalyticsValue] = [:]
        var setOnce: [String: AnalyticsValue] = [:]
    }

    private struct State {
        var phase = Phase.dormant
        /// Nil until the session reports who is signed in, which an offline or signed-out launch
        /// may never do.
        var identity: Identity?
        /// A sign-out or deletion the SDK has not heard about.
        var resetPending = false
        /// The user the app remembers as signed in, which every sign-out and deletion clears.
        var rememberedUserID: String?
        /// Events made while pending, oldest first, capped at `heldLimit`.
        var held: [HeldCall] = []
    }

    private enum HeldCall {
        case capture(String, [String: AnalyticsValue], set: [String: AnalyticsValue])
        case screen(Screen)
    }

    private static let heldLimit = 100

    private let backend: any PostHogBackend
    private let superProperties: [String: String]
    nonisolated(unsafe) private let defaults: UserDefaults
    private let state = Mutex(State())

    init(backend: any PostHogBackend, superProperties: [String: String], defaults: UserDefaults = .standard) {
        self.backend = backend
        self.superProperties = superProperties
        self.defaults = defaults
    }

    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue]) {
        state.withLock { state in
            switch state.phase {
            case .sharing: backend.capture(name, properties, set: set)
            case .pending: hold(.capture(name, properties, set: set), in: &state)
            case .dormant, .stopped: break
            }
        }
    }

    func screen(_ screen: Screen) {
        state.withLock { state in
            switch state.phase {
            case .sharing: backend.screen(screen.rawValue, Self.screenProperties(for: screen))
            case .pending: hold(.screen(screen), in: &state)
            case .dormant, .stopped: break
            }
        }
    }

    func deferDecision() {
        state.withLock { state in
            if state.phase == .dormant { state.phase = .pending }
        }
    }

    private func hold(_ call: HeldCall, in state: inout State) {
        state.held.append(call)
        if state.held.count > Self.heldLimit { state.held.removeFirst(state.held.count - Self.heldLimit) }
    }

    private func sendHeld(_ state: inout State) {
        let held = state.held
        state.held = []
        for call in held {
            switch call {
            case .capture(let name, let properties, let set): backend.capture(name, properties, set: set)
            case .screen(let screen): backend.screen(screen.rawValue, Self.screenProperties(for: screen))
            }
        }
    }

    /// The screen's name as its own property, beside PostHog's `$screen_name`, so the app and the
    /// web client break down by one shared key.
    static func screenProperties(for screen: Screen) -> [String: AnalyticsValue] {
        ["screen": .string(screen.rawValue)]
    }

    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {
        state.withLock { state in
            var identity =
                state.identity.flatMap { $0.userID == distinctID ? $0 : nil } ?? Identity(userID: distinctID)
            identity.set.merge(set) { _, new in new }
            identity.setOnce.merge(setOnce) { old, _ in old }
            state.identity = identity
            guard state.phase == .sharing else { return }
            // PostHog ignores an identify for anyone but the person it holds, so a person kept
            // from before sharing stopped is forgotten first.
            if let held = heldUser(state), held != distinctID { resetBackend() }
            identifyBackend(distinctID, set: set, setOnce: setOnce)
        }
    }

    func reset() {
        state.withLock { state in
            state.identity = Identity()
            // Events held for the person signing out must never go out once the default lands.
            if state.phase == .pending { state.held = [] }
            guard state.phase == .sharing else {
                state.resetPending = true
                return
            }
            resetBackend()
        }
    }

    func setEnabled(_ enabled: Bool, rememberedUserID: String?) {
        state.withLock { state in
            state.rememberedUserID = rememberedUserID
            switch (state.phase, enabled) {
            case (.dormant, true), (.pending, true):
                // Set up opted out, because opting in installs the lifecycle integration, which
                // captures an install or update at once. By then the super properties are on and
                // a person to forget is forgotten, so nothing goes out without them or as them.
                let resets = needsReset(state)
                backend.setup()
                if resets {
                    // The reset registers the super properties, which it would otherwise clear.
                    resetBackend()
                } else {
                    backend.register(superProperties)
                }
                backend.optIn()
                state.phase = .sharing
                caughtUp(&state)
                sendHeld(&state)
            case (.stopped, true):
                if needsReset(state) { resetBackend() }
                backend.optIn()
                state.phase = .sharing
                caughtUp(&state)
            case (.pending, false):
                state.held = []
                state.phase = .dormant
            case (.sharing, false):
                backend.optOut()
                state.phase = .stopped
            default:
                break
            }
        }
    }

    func flush() {
        state.withLock { state in
            guard state.phase == .sharing else { return }
            backend.flush()
        }
    }

    /// The identified user the SDK holds: read from the SDK once it is set up, else from the
    /// sink's own record of its last identify.
    private func heldUser(_ state: State) -> String? {
        guard state.phase != .dormant, state.phase != .pending else {
            return defaults.string(forKey: Self.identifiedKey)
        }
        let held = backend.distinctID
        return held == backend.anonymousID ? nil : held
    }

    /// Whether the SDK's person must be forgotten before it sends: someone signed out or in
    /// while it was not sharing. With no user reported yet, the remembered user stands in, so an
    /// offline launch keeps its person while one that signed out or deleted the account does not.
    private func needsReset(_ state: State) -> Bool {
        guard let held = heldUser(state) else { return false }
        if state.resetPending { return true }
        guard let identity = state.identity else { return held != state.rememberedUserID }
        return held != identity.userID
    }

    /// Identifies whoever signed in while the SDK was not sharing.
    private func caughtUp(_ state: inout State) {
        state.resetPending = false
        guard let identity = state.identity, let userID = identity.userID else { return }
        identifyBackend(userID, set: identity.set, setOnce: identity.setOnce)
    }

    private func identifyBackend(_ userID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {
        backend.identify(userID, set: set, setOnce: setOnce)
        defaults.set(userID, forKey: Self.identifiedKey)
    }

    /// `reset` also clears registered properties, so they go back on for the next anonymous events.
    private func resetBackend() {
        backend.reset()
        defaults.removeObject(forKey: Self.identifiedKey)
        backend.register(superProperties)
    }
}

/// The PostHog SDK itself. With `ContentMask.swift`, the only code that imports it.
struct LivePostHog: PostHogBackend {
    let token: String
    let host: URL

    /// The SDK's settings, built apart from `setup` so a test can read them.
    static func config(token: String, host: URL) -> PostHogConfig {
        let config = PostHogConfig(projectToken: token, host: host.absoluteString)
        // The app's stored choice decides; the SDK neither keeps one of its own nor lets a reset
        // clear it. It starts opted out so nothing is captured before the sink opts it in.
        config.optOut = true
        config.persistOptOut = false
        // Screens are sent by name from each destination, never from view controller titles.
        config.captureScreenViews = false
        config.captureApplicationLifecycleEvents = true
        config.personProfiles = .identifiedOnly
        // Feature flags and surveys are unused, so no flags are fetched and no survey can show.
        // Setup still fetches the remote config, which the SDK always loads.
        config.preloadFeatureFlags = false
        // Autocapture reads control text, which here is the musician's own, so only named events
        // are sent, whatever the PostHog dashboard enables.
        config.capturePushNotificationSubscriptions = false
        config.capturePushNotificationOpened = false
        #if os(iOS)
            config.captureElementInteractions = false
            config.captureAutocaptureElementText = false
            config.rageClickConfig.enabled = false
            config.surveys = false
            config.sessionReplay = false
        #endif
        return config
    }

    func setup() {
        PostHogSDK.shared.setup(Self.config(token: token, host: host))
    }

    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue]) {
        PostHogSDK.shared.capture(
            name, properties: Self.sdkProperties(properties),
            userProperties: set.isEmpty ? nil : Self.sdkProperties(set))
    }

    func screen(_ name: String, _ properties: [String: AnalyticsValue]) {
        PostHogSDK.shared.screen(name, properties: Self.sdkProperties(properties))
    }

    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {
        PostHogSDK.shared.identify(
            distinctID, userProperties: Self.sdkProperties(set), userPropertiesSetOnce: Self.sdkProperties(setOnce))
    }

    func reset() {
        PostHogSDK.shared.reset()
    }

    func register(_ properties: [String: String]) {
        PostHogSDK.shared.register(properties)
    }

    func optIn() {
        PostHogSDK.shared.optIn()
    }

    func optOut() {
        PostHogSDK.shared.optOut()
    }

    func flush() {
        PostHogSDK.shared.flush()
    }

    var distinctID: String { PostHogSDK.shared.getDistinctId() }
    var anonymousID: String { PostHogSDK.shared.getAnonymousId() }

    private static func sdkProperties(_ properties: [String: AnalyticsValue]) -> [String: Any] {
        properties.mapValues { value -> Any in
            switch value {
            case .string(let string): string
            case .int(let int): int
            case .bool(let bool): bool
            case .strings(let strings): strings
            }
        }
    }
}
