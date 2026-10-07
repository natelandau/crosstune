@_spi(Testing) import CrosstuneAnalytics
import Synchronization

/// Analytics that keeps every call it gets, in order, for a test to read back. A test
/// makes its own and hands `client` to the code under test, so it records only what that code
/// sends.
public final class RecordingAnalyticsSink: Sendable {
    public enum Call: Equatable, Sendable {
        case capture(String, [String: AnalyticsValue])
        case screen(Screen)
        case identify(String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue])
        case reset
        case setEnabled(Bool, rememberedUserID: String?)
        case flush
    }

    public struct Capture: Equatable, Sendable {
        public let name: String
        public let properties: [String: AnalyticsValue]

        public init(name: String, properties: [String: AnalyticsValue]) {
            self.name = name
            self.properties = properties
        }
    }

    private let recorded = Mutex<[Call]>([])

    public init() {}

    /// A client that sends to this recorder.
    public var client: AnalyticsClient { AnalyticsClient(sink: Forwarder(recorder: self)) }

    public var calls: [Call] { recorded.withLock { $0 } }

    /// The captured events alone, without screens, identity, or the opt-out.
    public var captures: [Capture] {
        calls.compactMap {
            guard case .capture(let name, let properties) = $0 else { return nil }
            return Capture(name: name, properties: properties)
        }
    }

    fileprivate func record(_ call: Call) {
        recorded.withLock { $0.append(call) }
    }
}

/// Hands each call to the recorder. Separate from the recorder because the sink protocol is SPI,
/// which a public type cannot conform to.
private struct Forwarder: AnalyticsSink {
    let recorder: RecordingAnalyticsSink

    func capture(_ name: String, _ properties: [String: AnalyticsValue]) {
        recorder.record(.capture(name, properties))
    }

    func screen(_ screen: Screen) {
        recorder.record(.screen(screen))
    }

    func identify(_ distinctID: String, set: [String: AnalyticsValue], setOnce: [String: AnalyticsValue]) {
        recorder.record(.identify(distinctID, set: set, setOnce: setOnce))
    }

    func reset() {
        recorder.record(.reset)
    }

    func setEnabled(_ enabled: Bool, rememberedUserID: String?) {
        recorder.record(.setEnabled(enabled, rememberedUserID: rememberedUserID))
    }

    func flush() {
        recorder.record(.flush)
    }
}
