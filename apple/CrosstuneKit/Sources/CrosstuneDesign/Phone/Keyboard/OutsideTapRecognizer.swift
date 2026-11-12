#if os(iOS)
    import UIKit

    /// Ends the edit when a tap lands outside every text field. It never holds or cancels the
    /// tap, so a tapped button both closes the keyboard and runs, and a tapped field takes the
    /// keyboard as it would without it.
    final class OutsideTapRecognizer: UITapGestureRecognizer, UIGestureRecognizerDelegate {
        /// The field that held the keyboard when the tap began.
        private weak var editing: UIResponder?

        init() {
            super.init(target: nil, action: nil)
            addTarget(self, action: #selector(tapped))
            cancelsTouchesInView = false
            delaysTouchesEnded = false
            delegate = self
        }

        @objc private func tapped() {
            guard state == .ended, let field = editing else { return }
            // Waits for the tapped control's own action, which may end the edit itself or move
            // the keyboard to another field; that field then keeps it.
            Task { @MainActor in
                if field.isFirstResponder { field.resignFirstResponder() }
            }
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let field = TextEntry.editingInput, let view = touch.view, !Self.isInTextInput(view) else {
                return false
            }
            editing = field
            return true
        }

        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool {
            true
        }

        /// Whether `view` is part of a text field or an editable text view, its clear button
        /// included.
        private static func isInTextInput(_ view: UIView) -> Bool {
            sequence(first: view, next: \.superview).contains { view in
                if let textView = view as? UITextView { return textView.isEditable }
                return view is UITextField
            }
        }
    }
#endif
