import SwiftUI

#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

/// Harbor blue on paper, the colors every Apple platform shares. Coral stays the mark's color.
public enum Palette {
    public enum Token: CaseIterable, Sendable {
        case accent, accentFill, onAccentFill, ground, surface, field, raised, ink, inkSecondary, markInk
        case groupedPage, groupedCard, switchOn, listSelection
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
    public static let markInkLight = "#4F5D75"
    public static let markInkDark = "#FFFFFF"
    /// An on switch's track. Dark mode takes a step deeper than the accent, so the white thumb
    /// holds 3:1 on the track and the track holds 3:1 on every ground a switch sits on.
    public static let switchOnLight = accentLight
    public static let switchOnDark = "#4A86C4"
    /// A focused list's selection on iPhone and iPad, and its edit-mode checkmarks: dark mode
    /// takes a step between the accent fill and the accent, so white text holds 4.5:1 on it and
    /// it holds 3:1 on the ground and the surface.
    public static let listSelectionLight = accentLight
    public static let listSelectionDark = "#3A72AE"
    /// A grouped form's page and its cards: the layers swap in dark mode so a card still
    /// contrasts with the page.
    public static let groupedPageLight = surfaceLight
    public static let groupedPageDark = groundDark
    public static let groupedCardLight = groundLight
    public static let groupedCardDark = surfaceDark

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
    public static var groupedPage: Color { color(.groupedPage) }
    public static var groupedCard: Color { color(.groupedCard) }
    public static var switchOn: Color { color(.switchOn) }
    public static var listSelection: Color { color(.listSelection) }
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
        case .groupedPage: (groupedPageLight, groupedPageDark)
        case .groupedCard: (groupedCardLight, groupedCardDark)
        case .switchOn: (switchOnLight, switchOnDark)
        case .listSelection: (listSelectionLight, listSelectionDark)
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

    #if canImport(AppKit)
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
    #elseif canImport(UIKit)
        private static func dynamic(
            light: (rgb: KeyColor.RGB, alpha: Double), dark: (rgb: KeyColor.RGB, alpha: Double)
        ) -> Color {
            Color(
                uiColor: UIColor { traits in
                    let (rgb, alpha) = traits.userInterfaceStyle == .dark ? dark : light
                    return UIColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: alpha)
                })
        }
    #endif
}
