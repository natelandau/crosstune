import SwiftUI

/// A prominent button on the accent fill whose label takes the label-on-accent color. The
/// system's prominent styles fill with the tint, which is not the accent fill. Every
/// accent-filled prominent button uses this style or the action button row's, never the
/// system's directly. On the Mac it draws the Mac primary, which keeps its fill in an inactive
/// window.
package struct AccentProminentButtonStyle: PrimitiveButtonStyle {
    /// Draws the glass prominent style in place of the bordered one.
    package var glass = false

    package func makeBody(configuration: Configuration) -> some View {
        AccentProminentButton(configuration: configuration, glass: glass)
    }
}

extension PrimitiveButtonStyle where Self == AccentProminentButtonStyle {
    /// The bordered prominent style with a legible label on the accent fill.
    package static var accentProminent: Self { AccentProminentButtonStyle() }
    /// The glass prominent style with a legible label on the accent fill.
    package static var accentGlassProminent: Self { AccentProminentButtonStyle(glass: true) }
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

        var body: some View {
            let button = Button(role: configuration.role, action: configuration.trigger) {
                configuration.label.foregroundStyle(isEnabled ? Palette.onAccentFill : Palette.onDisabled)
            }
            .buttonBorderShape(isEnabled ? .automatic : .capsule)
            .disabledCapsuleRing(!isEnabled)
            if glass {
                button.buttonStyle(.glassProminent).tint(isEnabled ? Palette.accentFill : .clear)
            } else {
                button.buttonStyle(.borderedProminent).tint(isEnabled ? Palette.accentFill : .clear)
            }
        }
    #endif
}

extension View {
    /// The ring a disabled capsule button draws in place of its fill, beside an `onDisabled`
    /// label, so it reads as off and never as another filled button.
    package func disabledCapsuleRing(_ disabled: Bool) -> some View {
        overlay {
            if disabled {
                Capsule().strokeBorder(Palette.disabledBorder, lineWidth: 1).allowsHitTesting(false)
            }
        }
    }

    /// Colors this label for an accent fill.
    package func onAccentLabel() -> some View {
        foregroundStyle(Palette.onAccentFill)
    }
}
