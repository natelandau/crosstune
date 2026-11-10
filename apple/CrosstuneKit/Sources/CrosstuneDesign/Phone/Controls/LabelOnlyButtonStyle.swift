import SwiftUI

/// A button that draws only its label, dimmed while pressed: a whole-row tap, a row's action
/// slot, a tile, or a link out. In a `List` it keeps its own tap, where the system's default
/// style makes the whole row fire every button in it. `pressedOpacity` sets the dim for a label
/// that needs its own; nil takes the system's plain press on iPhone and iPad. `hoverShape` gives
/// a label that is a control's whole look, such as a toolbar disc, the pointer's highlight on the
/// label in that shape on iPad, and the library's pressed dim unless `pressedOpacity` sets one.
/// On the Mac every label dims to `pressedOpacity`, or the library's pressed dim, and draws the
/// library's keyboard focus ring in `hoverShape`, or at the control radius, with the system
/// focus effect off.
package struct LabelOnlyButtonStyle: PrimitiveButtonStyle {
    /// The shape the pointer's highlight takes over the label.
    package enum HoverShape: Equatable, Sendable {
        case circle, capsule
    }

    package let pressedOpacity: Double?
    package let hoverShape: HoverShape?

    package init(pressedOpacity: Double? = nil, hoverShape: HoverShape? = nil) {
        self.pressedOpacity = pressedOpacity
        self.hoverShape = hoverShape
    }

    @ViewBuilder package func makeBody(configuration: Configuration) -> some View {
        let button = Button(configuration)
        #if os(macOS)
            // The system focus effect is off on the button itself, which a plain style's body,
            // sitting inside the button, cannot reach.
            button
                .buttonStyle(MacLabelAppearance(pressedOpacity: pressedOpacity, hoverShape: hoverShape))
                .focusEffectDisabled()
                .macButtonFocus()
        #else
            if pressedOpacity == nil, hoverShape == nil {
                button.buttonStyle(.plain)
            } else {
                button.buttonStyle(
                    LabelAppearance(
                        opacity: pressedOpacity ?? ControlMetrics.pressedOpacity, hoverShape: hoverShape))
            }
        #endif
    }
}

extension PrimitiveButtonStyle where Self == LabelOnlyButtonStyle {
    /// The label alone, with the system's plain press on iPhone and iPad and the library's
    /// pressed dim on the Mac.
    package static var labelOnly: Self { LabelOnlyButtonStyle() }
    /// The label alone, at `pressedOpacity` while pressed.
    package static func labelOnly(pressedOpacity: Double) -> Self {
        LabelOnlyButtonStyle(pressedOpacity: pressedOpacity)
    }
    /// The label alone, dimmed while pressed, with the pointer's highlight in `hoverShape`.
    package static func labelOnly(hoverShape: LabelOnlyButtonStyle.HoverShape) -> Self {
        LabelOnlyButtonStyle(hoverShape: hoverShape)
    }
}

/// The label dimmed while pressed, with the pointer's highlight on the label itself.
private struct LabelAppearance: ButtonStyle {
    let opacity: Double
    let hoverShape: LabelOnlyButtonStyle.HoverShape?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? opacity : 1)
            .pointerHighlight(hoverShape)
    }
}

#if os(macOS)
    /// The label dimmed while pressed, with the Mac's keyboard focus ring in the hover shape, or
    /// at the control radius for a label with none.
    private struct MacLabelAppearance: ButtonStyle {
        let pressedOpacity: Double?
        let hoverShape: LabelOnlyButtonStyle.HoverShape?

        func makeBody(configuration: Configuration) -> some View {
            MacLabelBody(configuration: configuration, pressedOpacity: pressedOpacity, hoverShape: hoverShape)
        }
    }

    private struct MacLabelBody: View {
        let configuration: ButtonStyle.Configuration
        let pressedOpacity: Double?
        let hoverShape: LabelOnlyButtonStyle.HoverShape?

        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.macPreviewFocused) private var previewFocused

        @ViewBuilder var body: some View {
            let label = configuration.label
                .opacity(configuration.isPressed ? pressedOpacity ?? ControlMetrics.pressedOpacity : 1)
            let focused = isFocused || previewFocused
            switch hoverShape {
            case .circle: label.macFocusRing(focused, shape: Circle())
            case .capsule: label.macFocusRing(focused, shape: Capsule())
            case nil: label.macFocusRing(focused, cornerRadius: MacControl.radius)
            }
        }
    }
#endif

extension View {
    @ViewBuilder fileprivate func pointerHighlight(_ shape: LabelOnlyButtonStyle.HoverShape?) -> some View {
        switch shape {
        case .circle: libraryHover(.circle)
        case .capsule: libraryHover(.capsule)
        case nil: self
        }
    }
}

#Preview("Label-only buttons") {
    HStack {
        Button {
        } label: {
            Image(systemName: "play.circle").frame(width: 44, height: 44)
        }
        .buttonStyle(.labelOnly)
        Button {
        } label: {
            RoundedRectangle(cornerRadius: 12).fill(Palette.field).frame(width: 64, height: 64)
        }
        .buttonStyle(.labelOnly(pressedOpacity: ControlMetrics.tilePressedOpacity))
        Button {
        } label: {
            Circle().fill(Palette.field).frame(width: 32, height: 32)
        }
        .buttonStyle(.labelOnly(hoverShape: .circle))
    }
    .padding()
}
