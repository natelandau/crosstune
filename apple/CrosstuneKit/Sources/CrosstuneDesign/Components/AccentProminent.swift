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
    /// The glass prominent style with a legible label on the accent fill. Disabled, it draws the
    /// system's own dimmed look, not the ring.
    package static var accentGlassProminent: Self { AccentProminentButtonStyle(glass: true) }
}

private struct AccentProminentButton: View {
    let configuration: PrimitiveButtonStyleConfiguration
    let glass: Bool

    #if os(macOS)
        @Environment(\.controlSize) private var controlSize

        /// Glass never draws on a Mac content button, so both styles take the one primary.
        var body: some View {
            Button(configuration)
                .buttonStyle(.mac(.primary, size: MacButtonStyle.Size(controlSize)))
        }
    #else
        var body: some View {
            if glass {
                // The system dims a disabled glass prominent button itself, accent tint included.
                Button(role: configuration.role, action: configuration.trigger) {
                    configuration.label.foregroundStyle(Palette.onAccentFill)
                }
                .buttonStyle(.glassProminent).tint(Palette.accentFill)
            } else {
                Button(configuration)
                    .buttonStyle(.filled)
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
}
