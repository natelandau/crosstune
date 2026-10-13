import SwiftUI

#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

/// The brand colors every platform shares: slate as the app's tint, coral as its mark.
public enum BrandStyle {
    public static let accentLight = "#4F5D75"
    public static let accentDark = "#8E9BB3"
    public static let coralHex = "#EF8354"
    public static let onAccentLight = "#FFFFFF"
    public static let onAccentDark = "#16181D"
    public static let onCoralHex = "#1D2230"
    public static let washSecondaryLight = "#555B66"
    public static let washSecondaryDark = "#BAC0CA"
    public static let premiumInkLight = "#465369"

    /// Slate, lighter in dark mode so text on the window keeps its contrast.
    public static var accent: Color {
        dynamic(light: accentLight, dark: accentDark)
    }

    /// Slate's hex in `scheme`.
    static func accentHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? accentDark : accentLight
    }

    /// The hex of the label on a slate fill in `scheme`.
    static func onAccentHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? onAccentDark : onAccentLight
    }

    public static var coral: Color { color(hex: coralHex) }

    /// Ink on a coral fill: dark in both appearances, since coral is a light color in both.
    public static var onCoral: Color { color(hex: onCoralHex) }

    /// A label on a slate fill: white on the light slate, near-black on the dark slate, which
    /// is a light color.
    public static func onAccent(_ scheme: ColorScheme) -> Color {
        color(hex: onAccentHex(scheme))
    }

    /// How strongly a set filter's slate wash shows over the window.
    public static func setFillOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.28 : 0.14
    }

    /// Whether a set filter's label is slate. Over a dark window the wash leaves slate text
    /// short of 4.5:1, so in dark mode the label takes the primary label color.
    public static func setLabelIsSlate(_ scheme: ColorScheme) -> Bool {
        scheme != .dark
    }

    /// A set filter's wash, the fill of a filter control or token once it narrows the list.
    public static func setFill(_ scheme: ColorScheme) -> Color {
        accent.opacity(setFillOpacity(scheme))
    }

    /// A slate wash a step stronger than a set filter's, so a track drawn on that wash still shows.
    public static func tintStrong(_ scheme: ColorScheme) -> Color {
        accent.opacity(scheme == .dark ? 0.5 : 0.3)
    }

    /// Secondary text on a slate wash or a Plan sheet card, darker in light mode and lighter in
    /// dark mode than the system's secondary label, which falls short of 4.5:1 on either.
    public static func washSecondary(_ scheme: ColorScheme) -> Color {
        color(hex: washSecondaryHex(scheme))
    }

    static func washSecondaryHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? washSecondaryDark : washSecondaryLight
    }

    /// The Premium column's checks and values on its wash. Light mode takes a deeper slate, since
    /// the Mac's card darkens the wash enough to leave slate short of 4.5:1; dark mode takes the
    /// primary label, as a set filter does.
    public static func premiumInk(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? .primary : color(hex: premiumInkLight)
    }

    /// A set filter's label on its wash.
    public static func setLabel(_ scheme: ColorScheme) -> Color {
        setLabelIsSlate(scheme) ? accent : .primary
    }

    /// A fixed sRGB color from a hex string.
    static func color(hex: String) -> Color {
        let rgb = KeyColor.RGB(hex: hex)
        return Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: 1)
    }

    #if canImport(AppKit)
        private static func dynamic(light: String, dark: String) -> Color {
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    return NSColor(hex: isDark ? dark : light)
                })
        }
    #elseif canImport(UIKit)
        private static func dynamic(light: String, dark: String) -> Color {
            Color(
                uiColor: UIColor { traits in
                    UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
                })
        }
    #endif
}

#if canImport(AppKit)
    extension NSColor {
        fileprivate convenience init(hex: String) {
            let rgb = KeyColor.RGB(hex: hex)
            self.init(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        }
    }
#elseif canImport(UIKit)
    extension UIColor {
        fileprivate convenience init(hex: String) {
            let rgb = KeyColor.RGB(hex: hex)
            self.init(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        }
    }
#endif
