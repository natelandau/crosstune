import SwiftUI

/// The fill of a capsule or pill with no color of its own. Off the Mac it follows its container,
/// as the web's controls do: `field` on the page background, `surfaceRaised` on a grouped
/// surface in dark mode, and `practiceFill` on the practice background. The Mac draws `field`,
/// and its own chips on a card.
package struct NeutralFill: ShapeStyle {
    /// Where a neutral fill sits.
    package enum Container: Equatable {
        case pageBackground, groupedSurface, practice
    }

    package func resolve(in environment: EnvironmentValues) -> Color {
        let container = Self.container(
            practice: environment.practiceBackground != nil, onGroupedSurface: environment.onGroupedSurface)
        if let token = Self.token(container, scheme: environment.colorScheme) { return Palette.color(token) }
        return Palette.practiceFill
    }

    package static func container(practice: Bool, onGroupedSurface: Bool) -> Container {
        #if os(macOS)
            return .pageBackground
        #else
            if practice { return .practice }
            return onGroupedSurface ? .groupedSurface : .pageBackground
        #endif
    }

    /// The palette fill for `container`, or nil on the practice background. A grouped surface is
    /// the page background in light mode and the surface in dark mode, so a chip on it takes the
    /// fill that contrasts with that layer.
    package static func token(_ container: Container, scheme: ColorScheme) -> Palette.Token? {
        switch container {
        case .pageBackground: .field
        case .groupedSurface: scheme == .dark ? .surfaceRaised : .field
        case .practice: nil
        }
    }
}

extension ShapeStyle where Self == NeutralFill {
    package static var neutralFill: NeutralFill { NeutralFill() }
}

extension EnvironmentValues {
    /// Whether this view sits on a grouped form's card, which ``GroupedForm`` sets.
    @Entry package var onGroupedSurface = false
}
