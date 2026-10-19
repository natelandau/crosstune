#if os(macOS)
    import AppKit
    @_spi(Testing) import CrosstuneDiagnostics
    @_spi(Testing) import CrosstuneTestSupport
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite(.enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct ScreenViewDiagnosticsTests {
        @Test func screenViewSendsBreadcrumbWithAnalyticsNoop() async throws {
            let sink = RecordingDiagnosticsSink()
            let window = hiddenWindow(
                size: CGSize(width: 200, height: 100), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(
                rootView: Text(verbatim: "Tune").screenView(.tune).environment(\.diagnostics, sink.client))
            window.orderFrontRegardless()
            defer { window.close() }

            #expect(try await poll { !sink.screens.isEmpty })
            #expect(sink.screens == [.tune])
        }
    }
#endif
