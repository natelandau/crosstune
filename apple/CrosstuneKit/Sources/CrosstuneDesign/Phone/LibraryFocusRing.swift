import SwiftUI

extension ControlMetrics {
    /// The keyboard focus ring's stroke, and how far outside its control the stroke is centered.
    package static let focusRingWidth: CGFloat = 3
    package static let focusRingOffset: CGFloat = 3
}

extension View {
    /// The library's keyboard focus ring for a control that turns the system's focus effect off:
    /// an accent stroke just outside `shape`, drawn while `isFocused`. It takes no presses.
    /// On the Mac it is the Mac ring, drawn only after keyboard focus.
    package func libraryFocusRing(_ isFocused: Bool, shape: some InsettableShape) -> some View {
        #if os(macOS)
            macFocusRing(isFocused, shape: shape)
        #else
            overlay {
                if isFocused {
                    shape.inset(by: -ControlMetrics.focusRingOffset)
                        .stroke(Palette.accent, lineWidth: ControlMetrics.focusRingWidth)
                        .allowsHitTesting(false)
                }
            }
        #endif
    }
}

extension View {
    /// Makes the view one focus stop bound to `focused`, with the library's ring in `shape` in
    /// place of the system's focus effect. On the Mac it joins the Tab order as every Mac
    /// library control does.
    package func libraryFocus(
        _ focused: FocusState<Bool>.Binding, isFocusable: Bool = true, shape: some InsettableShape
    ) -> some View {
        #if os(macOS)
            libraryFocusRing(focused.wrappedValue, shape: shape)
                .macFocusable(isEnabled: isFocusable)
                .focused(focused)
        #else
            libraryFocusRing(focused.wrappedValue, shape: shape)
                .focusable(isFocusable)
                .focused(focused)
                .focusEffectDisabled()
        #endif
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

extension View {
    /// Makes this view the one that takes a screen's keys while no control holds focus: it is
    /// focused as the screen opens, draws no ring, and takes focus back whenever `focused` is set.
    package func keySurface(_ focused: FocusState<Bool>.Binding) -> some View {
        focusable()
            .focusEffectDisabled()
            .focused(focused)
            .defaultFocus(focused, true)
    }

    /// ``keySurface(_:)`` for a screen that never moves focus back to it.
    package func keySurface() -> some View {
        modifier(KeySurface())
    }

    /// Opens this view with focus in the text field bound to `field`.
    package func opensFocused(on field: FocusState<Bool>.Binding) -> some View {
        defaultFocus(field, true)
            .onAppear { field.wrappedValue = true }
    }

    /// Binds a control to its view's opening focus. iPhone and iPad give any control focus as the
    /// view opens. On the Mac only a text field opens focused, so another control waits for Tab
    /// and opens with no ring. `isTextField` marks a control the Mac edits as a field, such as a
    /// date picker.
    @ViewBuilder package func openingFocus(_ field: FocusState<Bool>.Binding, isTextField: Bool = false) -> some View {
        #if os(macOS)
            if isTextField { focused(field) } else { self }
        #else
            focused(field)
        #endif
    }

    /// A control that Tab never reaches and whose press leaves keyboard focus where it was, such
    /// as a suggestion under the field it fills, or a row's open target when the row holds focus.
    package func leavesFocusOnPress() -> some View {
        focusable(false)
    }
}

private struct KeySurface: ViewModifier {
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content.keySurface($focused)
    }
}
