import CrosstuneAnalytics
import Foundation

/// The part of the app a reported error came from, kept as a tag so errors group by it.
public enum DiagnosticArea: String, Sendable, CaseIterable {
    case sync
    case transfer
    case upload
    case export
    case purchase
    case restore
}

/// A moment worth noting before a crash: the app moving between foreground and background, and
/// the player's recording coming and going. Carries no user content, only which moment it was.
public enum DiagnosticEvent: String, Sendable, CaseIterable {
    case sceneActive = "scene active"
    case sceneInactive = "scene inactive"
    case sceneBackground = "scene background"
    case recordingLoaded = "recording loaded"
    case playbackEnded = "playback ended"
    case recordingScreenClosed = "recording screen closed"
    case playerClosed = "player closed"

    /// The Sentry breadcrumb category it files under.
    var category: String {
        switch self {
        case .sceneActive, .sceneInactive, .sceneBackground: "app.lifecycle"
        case .recordingLoaded, .playbackEnded, .recordingScreenClosed, .playerClosed: "player"
        }
    }
}

/// Where diagnostics go. Sentry in the app; a recording double in tests. Behind SPI so features
/// reach Sentry through `DiagnosticsClient` alone.
@_spi(Testing) public protocol DiagnosticsSink: Sendable {
    func report(_ error: any Error, area: DiagnosticArea)
    /// Notes the screen the musician is on, so a later crash shows where it happened.
    func breadcrumb(screen: Screen)
    /// Notes `event`, so a later crash shows what led up to it.
    func breadcrumb(event: DiagnosticEvent)
}

/// Drops every call.
struct NoopDiagnosticsSink: DiagnosticsSink {
    func report(_ error: any Error, area: DiagnosticArea) {}
    func breadcrumb(screen: Screen) {}
    func breadcrumb(event: DiagnosticEvent) {}
}

/// The app's one way to report an error that left a feature failed. The app makes one with
/// `Diagnostics.start` and hands it to each model that reports; everything else holds `noop`.
public struct DiagnosticsClient: Sendable {
    private let sink: any DiagnosticsSink

    @_spi(Testing) public init(sink: any DiagnosticsSink) {
        self.sink = sink
    }

    /// Reports nothing.
    public static let noop = DiagnosticsClient(sink: NoopDiagnosticsSink())

    public func report(_ error: any Error, area: DiagnosticArea) {
        sink.report(error, area: area)
    }

    public func screen(_ screen: Screen) {
        sink.breadcrumb(screen: screen)
    }

    public func note(_ event: DiagnosticEvent) {
        sink.breadcrumb(event: event)
    }

    /// Whether this client reports nothing, for tests of `Diagnostics.start`.
    var isNoop: Bool { sink is NoopDiagnosticsSink }
}

public enum Diagnostics {
    /// A client that reports crashes, app hangs, and the errors it is handed to Sentry at `dsn`.
    /// A missing or blank DSN returns `noop` and never touches the SDK, so a build without one
    /// sends nothing.
    @MainActor public static func start(dsn: String?) -> DiagnosticsClient {
        guard let dsn = dsn?.trimmingCharacters(in: .whitespacesAndNewlines), !dsn.isEmpty else { return .noop }
        return DiagnosticsClient(sink: SentrySink.start(dsn: dsn))
    }
}
