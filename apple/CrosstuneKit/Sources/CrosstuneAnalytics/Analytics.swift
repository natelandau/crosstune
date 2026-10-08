import Foundation

#if os(iOS)
    import UIKit
#endif

/// Where analytics calls go. PostHog in the app; a recording double in tests. Behind SPI so
/// features reach PostHog through `AnalyticsClient`'s typed events alone.
@_spi(Testing) public protocol AnalyticsSink: Sendable {
    /// Captures an event, setting `set` on the person as it goes.
    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue])
    func screen(_ screen: Screen)
    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue])
    func reset()
    func setEnabled(_ enabled: Bool, rememberedUserID: String?)
    func flush()
}

/// Drops every call.
struct NoopAnalyticsSink: AnalyticsSink {
    func capture(_ name: String, _ properties: [String: AnalyticsValue], set: [String: AnalyticsValue]) {}
    func screen(_ screen: Screen) {}
    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {}
    func reset() {}
    func setEnabled(_ enabled: Bool, rememberedUserID: String?) {}
    func flush() {}
}

/// The app's one way to send product analytics. The app makes one with `Analytics.start` and
/// hands it to each model and view that reports; everything else holds `noop`.
public struct AnalyticsClient: Sendable {
    private let sink: any AnalyticsSink

    @_spi(Testing) public init(sink: any AnalyticsSink) {
        self.sink = sink
    }

    /// Sends nothing.
    public static let noop = AnalyticsClient(sink: NoopAnalyticsSink())

    public func send(_ event: AnalyticsEvent) {
        sink.capture(event.name, event.properties, set: event.personProperties)
    }

    public func screen(_ screen: Screen) {
        sink.screen(screen)
    }

    /// Ties later events to the signed-in user. The sign-up day is set once; the catalog and
    /// storage buckets, the fields in use, and each of `settings` are set on every call so they
    /// stay current. A value not known yet is left out rather than sent empty.
    public func identify(
        userID: String, signedUpAt: Date?, catalogSize: Int?, storageUsed: Int64?, fieldsUsed: [TuneField]?,
        settings: [SettingChange]
    ) {
        var set: [String: AnalyticsValue] = [:]
        if let catalogSize { set["catalog_size"] = .string(Bucket.count(catalogSize)) }
        if let storageUsed { set["storage_used"] = .string(Bucket.bytes(storageUsed)) }
        if let fieldsUsed { set["fields_used"] = .strings(fieldsUsed.map(\.rawValue)) }
        for setting in settings { set[setting.personProperty] = setting.value }
        var setOnce: [String: AnalyticsValue] = [:]
        if let signedUpAt { setOnce["signed_up_at"] = .string(signedUpAt.formatted(.iso8601)) }
        sink.identify(userID, set: set, setOnce: setOnce)
    }

    /// Forgets the signed-in user, so the next events are anonymous.
    public func reset() {
        sink.reset()
    }

    /// Turns sending on or off, as the musician's preference says. `rememberedUserID` is the user
    /// the app remembers as signed in, which stands in for the session's user until it reports
    /// one, so a person the SDK still holds is kept or forgotten correctly.
    public func setEnabled(_ enabled: Bool, rememberedUserID: String?) {
        sink.setEnabled(enabled, rememberedUserID: rememberedUserID)
    }

    /// Stops sending at the musician's word. The event saying so is sent and flushed first, since
    /// nothing leaves the device once sharing is off.
    public func disableSharing(rememberedUserID: String?) {
        send(.usageSharingDisabled)
        flush()
        setEnabled(false, rememberedUserID: rememberedUserID)
    }

    /// Sends every queued event now rather than on the next batch.
    public func flush() {
        sink.flush()
    }

    /// Whether this client sends nothing, for tests of `Analytics.start`.
    var isNoop: Bool { sink is NoopAnalyticsSink }
}

public enum Analytics {
    /// A client for PostHog through the relay at `host`. It sets the SDK up only once
    /// `setEnabled(true)` says the musician shares usage data. A missing or blank token returns
    /// `noop` and never touches the SDK, so a build without a token sends nothing.
    @MainActor public static func start(token: String?, host: URL) -> AnalyticsClient {
        guard let token = token?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else { return .noop }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return AnalyticsClient(
            sink: PostHogSink(
                backend: LivePostHog(token: token, host: host),
                superProperties: superProperties(device: .current, appVersion: version)))
    }

    enum Device {
        case phone
        case pad
        case mac

        @MainActor static var current: Device {
            #if os(macOS)
                .mac
            #else
                UIDevice.current.userInterfaceIdiom == .pad ? .pad : .phone
            #endif
        }
    }

    /// The properties every event carries, as the tracking plan names them.
    static func superProperties(device: Device, appVersion: String?) -> [String: String] {
        var properties =
            switch device {
            case .phone: ["platform": "ios", "form_factor": "phone"]
            case .pad: ["platform": "ipados", "form_factor": "tablet"]
            case .mac: ["platform": "macos", "form_factor": "desktop"]
            }
        properties["product"] = "app"
        properties["app_version"] = appVersion
        return properties
    }
}
