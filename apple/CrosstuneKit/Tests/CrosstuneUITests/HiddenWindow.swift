#if os(macOS)
    import AppKit

    /// A see-through window below every other app's windows, so a test run never covers the
    /// developer's screen. An offscreen origin does not hold: AppKit moves a titled window, and a
    /// window presenting a sheet, back onto a screen. A sheet takes its parent's level.
    /// `reportsKey` makes the window claim key, so SwiftUI gives focus inside it while the
    /// developer's app keeps the real key window.
    @MainActor
    func hiddenWindow(
        size: CGSize, styleMask: NSWindow.StyleMask, appearance: NSAppearance.Name, reportsKey: Bool = false
    ) -> NSWindow {
        let rect = CGRect(origin: .zero, size: size)
        let window =
            reportsKey
            ? KeyReportingWindow(contentRect: rect, styleMask: styleMask, backing: .buffered, defer: false)
            : NSWindow(contentRect: rect, styleMask: styleMask, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: appearance)
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        return window
    }

    private final class KeyReportingWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var isKeyWindow: Bool { true }
    }
#endif
