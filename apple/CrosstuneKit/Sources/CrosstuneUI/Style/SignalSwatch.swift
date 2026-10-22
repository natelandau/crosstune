import SwiftUI

/// Warning and danger as a capsule's fill and the text on it: a deep shade on a pale fill in
/// light mode and the reverse in dark mode, so the text keeps at least 4.5:1 with its fill.
enum SignalSwatch {
    nonisolated static func warning(_ scheme: ColorScheme) -> KeyColor.Swatch {
        scheme == .dark
            ? KeyColor.Swatch(background: KeyColor.RGB(hex: "#3D2A12"), ink: KeyColor.RGB(hex: "#FFB35C"))
            : KeyColor.Swatch(background: KeyColor.RGB(hex: "#FFEFD9"), ink: KeyColor.RGB(hex: "#8A4B00"))
    }

    nonisolated static func danger(_ scheme: ColorScheme) -> KeyColor.Swatch {
        scheme == .dark
            ? KeyColor.Swatch(background: KeyColor.RGB(hex: "#4A1C1A"), ink: KeyColor.RGB(hex: "#FF8A80"))
            : KeyColor.Swatch(background: KeyColor.RGB(hex: "#FDE2E0"), ink: KeyColor.RGB(hex: "#B3261E"))
    }
}
