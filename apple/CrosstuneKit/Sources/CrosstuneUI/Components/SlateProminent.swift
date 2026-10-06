import SwiftUI

/// A prominent button on the slate tint whose label takes the label-on-slate color where
/// `PageStyle.prominentLabelOnSlate` says so. The system's prominent styles draw a white
/// label, which dark mode's light slate leaves short of 4.5:1. Every slate-filled prominent
/// button uses this style, never the system's directly.
struct SlateProminentButtonStyle: PrimitiveButtonStyle {
    /// Draws the glass prominent style in place of the bordered one.
    var glass = false

    func makeBody(configuration: Configuration) -> some View {
        SlateProminentButton(configuration: configuration, glass: glass)
    }
}

extension PrimitiveButtonStyle where Self == SlateProminentButtonStyle {
    /// The bordered prominent style with a legible label on slate.
    static var slateProminent: Self { SlateProminentButtonStyle() }
    /// The glass prominent style with a legible label on slate.
    static var slateGlassProminent: Self { SlateProminentButtonStyle(glass: true) }
}

private struct SlateProminentButton: View {
    let configuration: PrimitiveButtonStyleConfiguration
    let glass: Bool

    var body: some View {
        let button = Button(role: configuration.role, action: configuration.trigger) {
            if PageStyle.prominentLabelOnSlate {
                configuration.label.onSlateLabel()
            } else {
                configuration.label
            }
        }
        if glass {
            button.buttonStyle(.glassProminent)
        } else {
            button.buttonStyle(.borderedProminent)
        }
    }
}

extension View {
    /// Colors this label for a slate fill in the current appearance.
    func onSlateLabel() -> some View {
        modifier(OnSlateLabel())
    }
}

private struct OnSlateLabel: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.foregroundStyle(BrandStyle.onAccent(colorScheme))
    }
}
