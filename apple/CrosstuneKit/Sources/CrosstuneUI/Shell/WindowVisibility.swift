#if os(macOS)
    import AppKit
    import SwiftUI

    extension View {
        /// Reports whether this view's window can be seen: on screen, not wholly covered by other
        /// windows, and not minimized. Whether the window is key does not count, so a window
        /// beside the one in use still reads as visible.
        func windowVisibility(_ onChange: @escaping @MainActor (Bool) -> Void) -> some View {
            background(WindowVisibilityWatch(onChange: onChange))
        }
    }

    private struct WindowVisibilityWatch: NSViewRepresentable {
        let onChange: @MainActor (Bool) -> Void

        func makeNSView(context: Context) -> WatchView {
            WatchView(onChange: onChange)
        }

        func updateNSView(_ view: WatchView, context: Context) {
            view.onChange = onChange
        }

        final class WatchView: NSView {
            var onChange: @MainActor (Bool) -> Void
            private var observers: [NSObjectProtocol] = []
            private var reported: Bool?

            init(onChange: @escaping @MainActor (Bool) -> Void) {
                self.onChange = onChange
                super.init(frame: .zero)
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) {
                fatalError("init(coder:) is not supported")
            }

            isolated deinit {
                observers.forEach(NotificationCenter.default.removeObserver)
            }

            override func viewDidMoveToWindow() {
                super.viewDidMoveToWindow()
                observers.forEach(NotificationCenter.default.removeObserver)
                observers = []
                if let window {
                    let names: [Notification.Name] = [
                        NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
                        NSWindow.didDeminiaturizeNotification,
                    ]
                    observers = names.map { name in
                        NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) {
                            [weak self] _ in
                            MainActor.assumeIsolated { self?.report() }
                        }
                    }
                }
                report()
            }

            private func report() {
                let visible = window.map { $0.occlusionState.contains(.visible) && !$0.isMiniaturized } ?? false
                guard visible != reported else { return }
                reported = visible
                onChange(visible)
            }
        }
    }
#endif
