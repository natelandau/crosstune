#if os(macOS)
    import AppKit
    import SwiftUI

    /// One scroll wheel or trackpad scroll over a ``ScrollWheelMonitor``'s view.
    struct ScrollWheel {
        /// The scroll in points; a mouse wheel's lines are counted as 10 points each.
        let deltaX: Double
        let deltaY: Double
        let control: Bool
        /// The pointer's x from the view's leading edge.
        let x: Double
    }

    /// Hands each scroll over the view it backs to `onScroll`, which says whether it used it; a
    /// used scroll goes no further, so the page does not scroll too. SwiftUI has no scroll wheel
    /// event, so this watches the window's own.
    struct ScrollWheelMonitor: NSViewRepresentable {
        /// The monitor sees events whatever SwiftUI has disabled, so it is told directly.
        let isEnabled: Bool
        let onScroll: @MainActor (ScrollWheel) -> Bool

        func makeNSView(context: Context) -> ScrollWheelMonitorView {
            let view = ScrollWheelMonitorView()
            view.isEnabled = isEnabled
            view.onScroll = onScroll
            return view
        }

        func updateNSView(_ view: ScrollWheelMonitorView, context: Context) {
            view.isEnabled = isEnabled
            view.onScroll = onScroll
        }

        static func dismantleNSView(_ view: ScrollWheelMonitorView, coordinator: ()) {
            view.stopWatching()
        }
    }

    final class ScrollWheelMonitorView: NSView {
        var onScroll: (@MainActor (ScrollWheel) -> Bool)?
        var isEnabled = false
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopWatching()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                MainActor.assumeIsolated { self?.scroll(event) ?? false } ? nil : event
            }
        }

        func stopWatching() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        private func scroll(_ event: NSEvent) -> Bool {
            let location = convert(event.locationInWindow, from: nil)
            guard isEnabled, let window, event.window === window, bounds.contains(location), let onScroll else {
                return false
            }
            // A mouse wheel reports lines rather than points.
            let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 10
            return onScroll(
                ScrollWheel(
                    deltaX: Double(event.scrollingDeltaX * scale), deltaY: Double(event.scrollingDeltaY * scale),
                    control: event.modifierFlags.contains(.control), x: Double(location.x)))
        }
    }

    /// Zooms by Control and the scroll wheel over the view it backs, as maps and editors do on
    /// a Mac.
    struct ControlScrollZoom: View {
        let isEnabled: Bool
        /// Takes how many times to zoom in (under 1 zooms out) and the pointer's x from the
        /// view's leading edge.
        let onZoom: @MainActor (Double, Double) -> Void

        /// How far one point of scrolling zooms; a trackpad reports many small points.
        private static let rate = 0.01

        var body: some View {
            ScrollWheelMonitor(isEnabled: isEnabled) { wheel in
                guard wheel.control else { return false }
                onZoom(exp(wheel.deltaY * Self.rate), wheel.x)
                return true
            }
        }
    }
#endif
