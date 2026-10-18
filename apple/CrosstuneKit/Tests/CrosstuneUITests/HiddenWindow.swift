#if os(macOS)
    import AppKit

    /// A see-through window below every other app's windows, so a test run never covers the
    /// developer's screen. An offscreen origin does not hold: AppKit moves a titled window, and a
    /// window presenting a sheet, back onto a screen. A sheet takes its parent's level.
    @MainActor
    func hiddenWindow(size: CGSize, styleMask: NSWindow.StyleMask, appearance: NSAppearance.Name) -> NSWindow {
        let window = NSWindow(
            contentRect: CGRect(origin: .zero, size: size), styleMask: styleMask, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: appearance)
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        return window
    }
#endif
