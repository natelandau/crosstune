#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

/// Whether the musician is typing: a text field or text view holds the keyboard. A screen's
/// own keys check it before acting, so Space, letters, and arrows always reach the text, rather
/// than trusting the field to take each key before a handler further up hears it.
@MainActor
enum TextEntry {
    static var isActive: Bool {
        #if os(macOS)
            // A field being edited hands its keys to the window's field editor, an `NSText`.
            // Selectable text that is not editable is an `NSText` too, and leaves the keys free.
            (NSApp.keyWindow?.firstResponder as? NSText)?.isEditable == true
        #else
            guard let input = FirstResponder.current as? UITextInput else { return false }
            return (input as? UITextView)?.isEditable ?? true
        #endif
    }
}

#if os(iOS)
    /// UIKit has no public way to read the first responder, so an action sent to no target
    /// lands on it and notes it.
    @MainActor
    private enum FirstResponder {
        static weak var found: UIResponder?

        static var current: UIResponder? {
            found = nil
            UIApplication.shared.sendAction(#selector(UIResponder.noteFirstResponder), to: nil, from: nil, for: nil)
            return found
        }
    }

    extension UIResponder {
        @objc fileprivate func noteFirstResponder() {
            FirstResponder.found = self
        }
    }
#endif
