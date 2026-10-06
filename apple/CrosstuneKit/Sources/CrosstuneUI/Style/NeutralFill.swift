import SwiftUI

/// The fill of a capsule or pill with no color of its own. The system's tertiary fill all but
/// vanishes on a black dark-mode page, so dark mode takes the same gray at a heavier opacity.
func neutralFill(_ scheme: ColorScheme) -> AnyShapeStyle {
    scheme == .dark
        ? AnyShapeStyle(Color(.sRGB, red: 118 / 255, green: 118 / 255, blue: 128 / 255, opacity: 0.44))
        : lightNeutralFill
}

#if canImport(UIKit)
    import UIKit

    /// The tertiary fill as a fixed color: a hierarchical `.fill.tertiary` resolves a level
    /// darker inside a menu's label than beside it.
    private let lightNeutralFill = AnyShapeStyle(Color(uiColor: .tertiarySystemFill))
#else
    private let lightNeutralFill = AnyShapeStyle(.fill.tertiary)
#endif
