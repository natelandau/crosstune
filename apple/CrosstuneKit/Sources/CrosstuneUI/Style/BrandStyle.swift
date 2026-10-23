import SwiftUI

/// The brand colors every platform shares: Harbor blue as the app's tint, coral as its mark.
public enum BrandStyle {
    public static let coralHex = "#EF8354"
    public static let onCoralHex = "#1D2230"
    public static let washSecondaryLight = "#555B66"
    public static let washSecondaryDark = "#BAC0CA"

    public static var accent: Color { Palette.accent }

    public static var coral: Color { color(hex: coralHex) }

    /// Ink on a coral fill: dark in both appearances, since coral is a light color in both.
    public static var onCoral: Color { color(hex: onCoralHex) }

    /// How strongly a set filter's Harbor wash shows over the window, the same on every platform.
    public static func setFillOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.22 : 0.12
    }

    /// Whether a set filter's label is Harbor. Over a dark surface the wash leaves Harbor text
    /// short of 4.5:1, so in dark mode the label takes ink.
    public static func setLabelIsAccent(_ scheme: ColorScheme) -> Bool {
        scheme != .dark
    }

    /// A set filter's wash, the fill of a filter control or token once it narrows the list.
    public static func setFill(_ scheme: ColorScheme) -> Color {
        accent.opacity(setFillOpacity(scheme))
    }

    /// A Harbor wash a step stronger than a set filter's, so a track drawn on that wash still shows.
    public static func tintStrong(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintStrongOpacity(scheme))
    }

    static func tintStrongOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.5 : 0.3
    }

    /// Secondary text on a Harbor wash or a Plan sheet card, darker in light mode and lighter in
    /// dark mode than the system's secondary label, which falls short of 4.5:1 on either.
    public static func washSecondary(_ scheme: ColorScheme) -> Color {
        color(hex: washSecondaryHex(scheme))
    }

    static func washSecondaryHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? washSecondaryDark : washSecondaryLight
    }

    /// The Premium column's checks and values on its wash, as a set filter's label is.
    public static func premiumInk(_ scheme: ColorScheme) -> Color {
        setLabel(scheme)
    }

    /// A set filter's label on its wash: the accent in light mode, ink in dark mode.
    public static func setLabel(_ scheme: ColorScheme) -> Color {
        setLabelIsAccent(scheme) ? accent : Palette.ink
    }

    /// A fixed sRGB color from a hex string.
    static func color(hex: String) -> Color {
        let rgb = KeyColor.RGB(hex: hex)
        return Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: 1)
    }
}
