import CrosstuneAnalytics
@_spi(Testing) import CrosstuneDiagnostics
import Synchronization

/// Diagnostics that keeps every report and screen it gets, in order, for a test to read back. A
/// test makes its own and hands `client` to the code under test.
@_spi(Testing) public final class RecordingDiagnosticsSink: DiagnosticsSink {
    private struct State {
        var reports: [(area: DiagnosticArea, error: any Error)] = []
        var screens: [Screen] = []
    }

    private let state = Mutex(State())

    public init() {}

    /// A client that sends to this recorder.
    public var client: DiagnosticsClient { DiagnosticsClient(sink: self) }

    public var reports: [(area: DiagnosticArea, error: any Error)] { state.withLock { $0.reports } }
    public var screens: [Screen] { state.withLock { $0.screens } }

    public func report(_ error: any Error, area: DiagnosticArea) {
        state.withLock { $0.reports.append((area, error)) }
    }

    public func breadcrumb(screen: Screen) {
        state.withLock { $0.screens.append(screen) }
    }
}
