#if os(macOS)
    import AppKit
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor @Suite struct IsolatePanelTests {
        private func height(isAvailable: Bool) -> CGFloat {
            let panel = IsolatePanel(
                value: .standard, isMono: false, isAvailable: isAvailable, outline: { nil }, isLive: false,
                onChange: { _ in })
            let host = NSHostingView(rootView: panel.frame(width: 480))
            let window = hiddenWindow(size: CGSize(width: 480, height: 400), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentView = host
            host.layoutSubtreeIfNeeded()
            return host.fittingSize.height
        }

        /// Every control row is at least a press target tall, so a panel shorter than one holds
        /// no control: only the line saying the unit is unavailable.
        @Test func withoutTheIsolateUnitOnlyALineShows() {
            #expect(height(isAvailable: true) >= 3 * PracticeLayout.target)
            let unavailable = height(isAvailable: false)
            #expect(unavailable > 0 && unavailable < PracticeLayout.target)
        }
    }
#endif
