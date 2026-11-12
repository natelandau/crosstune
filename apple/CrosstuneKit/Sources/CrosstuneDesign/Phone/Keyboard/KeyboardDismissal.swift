import SwiftUI

#if os(iOS)
    import UIKit
#endif

extension View {
    /// Closes the keyboard on iPhone and iPad when a tap lands outside the field being edited,
    /// and lets a drag down through the keyboard pull it closed. Applied once at the window's
    /// root, so every screen, sheet, and popover in the window shares it. A screen that sets its
    /// own `scrollDismissesKeyboard` changes only how its scrolling closes the keyboard.
    public func keyboardDismissal() -> some View {
        #if os(iOS)
            scrollDismissesKeyboard(.interactively)
                .background { WindowTapInstaller().accessibilityHidden(true) }
        #else
            self
        #endif
    }
}

#if os(iOS)
    /// SwiftUI has no gesture that sees every touch in a window, sheets and popovers included,
    /// nor which view a touch landed on, so the tap is a UIKit recognizer on the window itself.
    private struct WindowTapInstaller: UIViewRepresentable {
        func makeUIView(context: Context) -> WindowAttachment {
            WindowAttachment()
        }

        func updateUIView(_ view: WindowAttachment, context: Context) {}
    }

    /// Keeps the recognizer on whichever window holds this view.
    private final class WindowAttachment: UIView {
        private let recognizer = OutsideTapRecognizer()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            recognizer.view?.removeGestureRecognizer(recognizer)
            window?.addGestureRecognizer(recognizer)
        }
    }
#endif
