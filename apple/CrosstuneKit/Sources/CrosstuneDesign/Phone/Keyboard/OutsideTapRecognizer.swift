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
            // A field in another window, as in a second iPad scene, keeps its keyboard.
            guard let field = TextEntry.editingInput, (field as? UIView)?.window === touch.window,
                let view = touch.view,
                !sequence(first: view, next: \.superview).contains(where: TextEntry.isEditableText),
                !FieldAreaView.contains(touch)
            else { return false }
            editing = field
            return true
        }

        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
#endif
