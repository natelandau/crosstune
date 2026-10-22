#if os(macOS)
    import AppKit
    import SwiftUI

    /// The Mac's colors: Harbor blue on paper. ``BrandStyle`` stays the source on iPhone and
    /// iPad, and coral stays the mark's color everywhere.
    public enum MacPalette {
        public enum Token: CaseIterable, Sendable {
            case accent, accentFill, onAccentFill, ground, surface, field, raised, ink, inkSecondary, markInk
        }

        public static let accentLight = "#1F5F9E"
        public static let accentDark = "#6AA6E6"
        public static let accentFillLight = "#1F5F9E"
        public static let accentFillDark = "#2B609A"
        public static let onAccentFillLight = "#FFFFFF"
        public static let onAccentFillDark = "#FFFFFF"
        public static let groundLight = "#FFFEFC"
        public static let groundDark = "#16181B"
        public static let surfaceLight = "#F3F1ED"
        public static let surfaceDark = "#1E2024"
        public static let fieldLight = "#E8E5E0"
        public static let fieldDark = "#292C31"
        public static let raisedLight = groundLight
        public static let raisedDark = "#34373D"
        public static let inkLight = "#1C2026"
        public static let inkDark = "#ECEDF0"
        public static let inkSecondaryLight = "#61676F"
        public static let inkSecondaryDark = "#9CA2AB"
        /// Slate on light and white on dark, as the mark is drawn on every platform.
        public static let markInkLight = BrandStyle.accentLight
        public static let markInkDark = "#FFFFFF"

        public static func hex(_ token: Token, _ scheme: ColorScheme) -> String {
            let (light, dark) = pair(token)
            return scheme == .dark ? dark : light
        }

        /// Text, glyphs, focus rings, and switches.
        public static var accent: Color { color(.accent) }
        /// A primary button's or a chosen item's fill. Dark mode takes a deeper blue than the
        /// accent so white text keeps its contrast.
        public static var accentFill: Color { color(.accentFill) }
        public static var onAccentFill: Color { color(.onAccentFill) }
        /// Content columns and sheets.
        public static var ground: Color { color(.ground) }
        /// The sidebar, cards, footers, and the practice stage.
        public static var surface: Color { color(.surface) }
        /// Inputs, secondary buttons, and chips.
        public static var field: Color { color(.field) }
        /// Inputs and secondary buttons on a `surface` card or footer, where `field` would read
        /// gray on gray: a step lighter than the surface, as a raised control is.
        public static var raised: Color { color(.raised) }
        public static var ink: Color { color(.ink) }
        public static var inkSecondary: Color { color(.inkSecondary) }
        /// The mark's C, which never follows the accent.
        public static var markInk: Color { color(.markInk) }
        /// A rule between areas, as a color and its opacity in each appearance.
        static let hairlineLight = (rgb: KeyColor.RGB(red: 30 / 255, green: 40 / 255, blue: 55 / 255), alpha: 0.12)
        static let hairlineDark = (rgb: KeyColor.RGB(red: 230 / 255, green: 240 / 255, blue: 1), alpha: 0.10)
        public static var hairline: Color { dynamic(light: hairlineLight, dark: hairlineDark) }

        private static func pair(_ token: Token) -> (light: String, dark: String) {
            switch token {
            case .accent: (accentLight, accentDark)
            case .accentFill: (accentFillLight, accentFillDark)
            case .onAccentFill: (onAccentFillLight, onAccentFillDark)
            case .ground: (groundLight, groundDark)
            case .surface: (surfaceLight, surfaceDark)
            case .field: (fieldLight, fieldDark)
            case .raised: (raisedLight, raisedDark)
            case .ink: (inkLight, inkDark)
            case .inkSecondary: (inkSecondaryLight, inkSecondaryDark)
            case .markInk: (markInkLight, markInkDark)
            }
        }

        static func color(_ token: Token) -> Color {
            let (light, dark) = pair(token)
            return dynamic(light: (KeyColor.RGB(hex: light), 1), dark: (KeyColor.RGB(hex: dark), 1))
        }

        /// A color that is `light` in the light appearance and `dark` in the dark one.
        static func dynamic(light: KeyColor.RGB, dark: KeyColor.RGB) -> Color {
            dynamic(light: (light, 1), dark: (dark, 1))
        }

        private static func dynamic(
            light: (rgb: KeyColor.RGB, alpha: Double), dark: (rgb: KeyColor.RGB, alpha: Double)
        ) -> Color {
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    let (rgb, alpha) = isDark ? dark : light
                    return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: alpha)
                })
        }
    }
#endif
