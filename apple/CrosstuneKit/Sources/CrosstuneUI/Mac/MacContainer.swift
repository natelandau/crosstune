#if os(macOS)
    import SwiftUI

    /// What a Mac control sits on, so its fill contrasts with it: `field` on the `pageBackground`
    /// of a column or sheet, `surfaceRaised` on a `surface` card or footer.
    enum MacContainer: CaseIterable, Sendable {
        case pageBackground
        case surface

        /// The fill of a field, a secondary button, and a hover here.
        var controlFill: Palette.Token {
            switch self {
            case .pageBackground: .field
            case .surface: .surfaceRaised
            }
        }

        /// The container's own fill.
        var fill: Palette.Token {
            switch self {
            case .pageBackground: .pageBackground
            case .surface: .surface
            }
        }

        /// Whether a filled control here draws a hairline edge: on a light surface, where the
        /// raised fill sits close to the card and an empty field would otherwise vanish.
        func strokesControls(_ scheme: ColorScheme) -> Bool {
            self == .surface && scheme == .light
        }

        var controlColor: Color {
            switch self {
            case .pageBackground: Palette.field
            case .surface: Palette.surfaceRaised
            }
        }
    }

    extension EnvironmentValues {
        @Entry var macContainer: MacContainer = .pageBackground
    }

    extension View {
        /// The hairline edge a filled control takes in `container`, if any.
        func macControlEdge(_ container: MacContainer, scheme: ColorScheme, cornerRadius: CGFloat) -> some View {
            overlay {
                if container.strokesControls(scheme) {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .strokeBorder(Palette.border, lineWidth: 1)
                        .allowsHitTesting(false)
                }
            }
        }

        /// Marks a `surface` card or footer, so the fields and buttons in it take the raised fill.
        func macSurfaceContainer() -> some View {
            environment(\.macContainer, .surface)
        }
    }
#endif
