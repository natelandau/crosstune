import SwiftUI

/// How far a view floats above what it sits on, as the web's `--shadow-float` and
/// `--shadow-control` draw it. A CSS blur is twice a SwiftUI shadow's radius.
package enum Elevation {
    /// Overlays, banners, and capsules that float over content.
    case float
    /// A thumb, a segmented control's chosen token, and other small raised controls.
    case control

    package struct Shadow: Equatable {
        package let opacity: Double
        package let radius: CGFloat
        package let y: CGFloat
    }

    /// The shadows `self` draws in `scheme`, nearest first. Black shadows barely show on a
    /// near-black page, so dark mode draws them darker.
    package func shadows(_ scheme: ColorScheme) -> [Shadow] {
        let dark = scheme == .dark
        switch self {
        case .float:
            return [
                Shadow(opacity: dark ? 0.4 : 0.10, radius: 1.5, y: 1),
                Shadow(opacity: dark ? 0.5 : 0.16, radius: 14, y: 8),
            ]
        case .control:
            return [Shadow(opacity: 0.18, radius: 1.5, y: 1)]
        }
    }
}

private struct ElevationShadow: ViewModifier {
    let elevation: Elevation
    let isShown: Bool

    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shadows = elevation.shadows(scheme)
        let near = shadows[0]
        let far = shadows.count > 1 ? shadows[1] : Elevation.Shadow(opacity: 0, radius: 0, y: 0)
        content
            .shadow(color: color(near), radius: near.radius, y: near.y)
            .shadow(color: color(far), radius: far.radius, y: far.y)
    }

    private func color(_ shadow: Elevation.Shadow) -> Color {
        Palette.color(hex: Primitive.black, opacity: isShown ? shadow.opacity : 0)
    }
}

extension View {
    /// Draws `elevation`'s shadow under this view, or none while `isShown` is false.
    package func elevation(_ elevation: Elevation, isShown: Bool = true) -> some View {
        modifier(ElevationShadow(elevation: elevation, isShown: isShown))
    }
}
