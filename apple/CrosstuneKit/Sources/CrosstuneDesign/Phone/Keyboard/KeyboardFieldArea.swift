import SwiftUI

#if os(iOS)
    import UIKit
#endif

extension View {
    /// Counts this view's frame as part of the text field it holds or focuses, such as a filled
    /// field's padding or a page that starts typing on a tap, so a tap there never ends the edit
    /// as a tap outside the field.
    package func keyboardFieldArea() -> some View {
        #if os(iOS)
            background { FieldAreaMarker().accessibilityHidden(true) }
        #else
            self
        #endif
    }
}

#if os(iOS)
    private struct FieldAreaMarker: UIViewRepresentable {
        func makeUIView(context: Context) -> FieldAreaView {
            FieldAreaView()
        }

        func updateUIView(_ view: FieldAreaView, context: Context) {}
    }

    /// A field's area, for ``OutsideTapRecognizer``. It takes no touches, so the views over it
    /// keep theirs.
    final class FieldAreaView: UIView {
        private static let inWindow = NSHashTable<FieldAreaView>.weakObjects()

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
            if window == nil { Self.inWindow.remove(self) } else { Self.inWindow.add(self) }
        }

        /// Whether `touch` lands in a field's area. The area must sit under the touched view, so
        /// a field on a screen behind a sheet never claims a tap on the sheet.
        static func contains(_ touch: UITouch) -> Bool {
            guard let view = touch.view else { return false }
            return inWindow.allObjects.contains { area in
                area.isDescendant(of: view) && area.bounds.contains(touch.location(in: area))
            }
        }
    }
#endif
