import SwiftUI

extension ControlMetrics {
    /// The keyboard focus ring's stroke, and how far outside its control the stroke is centered.
    package static let focusRingWidth: CGFloat = 3
    package static let focusRingOffset: CGFloat = 3
}

extension View {
    /// The library's keyboard focus ring for a control that turns the system's focus effect off:
    /// an accent stroke just outside `shape`, drawn while `isFocused`. It takes no presses.
    package func libraryFocusRing(_ isFocused: Bool, shape: some InsettableShape) -> some View {
        overlay {
            if isFocused {
                shape.inset(by: -ControlMetrics.focusRingOffset)
                    .stroke(Palette.accent, lineWidth: ControlMetrics.focusRingWidth)
                    .allowsHitTesting(false)
            }
        }
    }
}

extension View {
    /// Makes the view one focus stop bound to `focused`, with the library's ring in `shape` in
    /// place of the system's focus effect.
    package func libraryFocus(
        _ focused: FocusState<Bool>.Binding, isFocusable: Bool = true, shape: some InsettableShape
    ) -> some View {
        libraryFocusRing(focused.wrappedValue, shape: shape)
            .focusable(isFocusable)
            .focused(focused)
            .focusEffectDisabled()
    }

    /// The pointer's highlight in `shape` on iPad. The Mac draws its own hover.
    @ViewBuilder package func libraryHover(_ shape: some Shape, isEnabled: Bool = true) -> some View {
        #if os(macOS)
            self
        #else
            contentShape(.hoverEffect, shape).hoverEffect(.highlight, isEnabled: isEnabled)
        #endif
    }
}
