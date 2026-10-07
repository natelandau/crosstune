#if os(macOS)
    import AppKit
    import SwiftUI

    extension View {
        /// Runs `action` as the Mac app quits. Quitting skips the background scene phase, so work
        /// the app does on leaving the foreground must also run here.
        func onAppQuit(center: NotificationCenter = .default, perform action: @escaping () -> Void) -> some View {
            onReceive(center.publisher(for: NSApplication.willTerminateNotification)) { _ in action() }
        }
    }
#endif
