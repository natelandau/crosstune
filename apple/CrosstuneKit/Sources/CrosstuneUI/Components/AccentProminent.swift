import SwiftUI

/// A prominent button on the accent fill whose label takes the label-on-accent color. The
/// system's prominent styles fill with the tint, which is not the accent fill. Every
/// accent-filled prominent button uses this style, never the system's directly. On the Mac it
/// draws the Mac primary, which keeps its fill in an inactive window.
struct AccentProminentButtonStyle: PrimitiveButtonStyle {
    /// Draws the glass prominent style in place of the bordered one.
    var glass = false

    func makeBody(configuration: Configuration) -> some View {
        AccentProminentButton(configuration: configuration, glass: glass)
    }
}

extension PrimitiveButtonStyle where Self == AccentProminentButtonStyle {
    /// The bordered prominent style with a legible label on the accent fill.
    static var accentProminent: Self { AccentProminentButtonStyle() }
    /// The glass prominent style with a legible label on the accent fill.
    static var accentGlassProminent: Self { AccentProminentButtonStyle(glass: true) }
}

private struct AccentProminentButton: View {
    let configuration: PrimitiveButtonStyleConfiguration
    let glass: Bool

    #if os(macOS)
        @Environment(\.controlSize) private var controlSize

        /// Glass never draws on a Mac content button, so both styles take the one primary.
        var body: some View {
            Button(role: configuration.role, action: configuration.trigger) { configuration.label }
                .buttonStyle(.mac(.primary, size: size))
        }

        private var size: MacButtonStyle.Size {
            switch controlSize {
            case .mini, .small: .small
            case .large, .extraLarge: .large
            default: .regular
            }
        }
    #else
        @Environment(\.isEnabled) private var isEnabled

        /// A disabled button drops its fill for a ring and a faint label, so it reads as off and
        /// never as another filled button.
        var body: some View {
            let button = Button(role: configuration.role, action: configuration.trigger) {
                configuration.label.foregroundStyle(isEnabled ? Palette.onAccentFill : Palette.onDisabled)
            }
            .buttonBorderShape(isEnabled ? .automatic : .capsule)
            .overlay {
                if !isEnabled {
                    Capsule().strokeBorder(Palette.disabledBorder, lineWidth: 1).allowsHitTesting(false)
                }
            }
            if glass {
                button.buttonStyle(.glassProminent).tint(isEnabled ? Palette.accentFill : .clear)
            } else {
                button.buttonStyle(.borderedProminent).tint(isEnabled ? Palette.accentFill : .clear)
            }
        }
    #endif
}

extension View {
    /// Colors this label for an accent fill.
    func onAccentLabel() -> some View {
        foregroundStyle(Palette.onAccentFill)
    }
}
