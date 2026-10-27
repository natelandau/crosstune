import SwiftUI

#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

/// The color roles every Apple platform shares. A view names a role, never a primitive, so a
/// role moves to another value in one line here.
public enum Palette {
    public enum Token: CaseIterable, Sendable {
        case pageBackground, surface, surfaceRaised, field, groupedBackground, groupedSurface
        case textPrimary, textSecondary
        case accent, accentFill, onAccentFill, accentSelection, accentTrack, inverseAccent
        case brand, onBrand, brandSecondary, onTintSecondary
        case danger, warning, statusKnown, statusLearning, statusUnknown, statusUnknownOnFill
        case practiceBackground, onPractice, onPracticeSecondary, tunerClose, tunerInTuneBackground
    }

    public static func hex(_ token: Token, _ scheme: ColorScheme) -> String {
        let (light, dark) = pair(token)
        return scheme == .dark ? dark : light
    }

    private static func pair(_ token: Token) -> (light: String, dark: String) {
        switch token {
        case .pageBackground: (Primitive.warmGray0, Primitive.gray950)
        case .surface: (Primitive.warmGray50, Primitive.gray900)
        case .surfaceRaised: (Primitive.warmGray0, Primitive.gray800)
        case .field: (Primitive.warmGray100, Primitive.gray850)
        // The layers swap in dark mode so a card still contrasts with the page.
        case .groupedBackground: (hex(.surface, .light), hex(.pageBackground, .dark))
        case .groupedSurface: (hex(.pageBackground, .light), hex(.surface, .dark))
        case .textPrimary: (Primitive.gray925, Primitive.gray100)
        case .textSecondary: (Primitive.gray600, Primitive.gray300)
        case .accent: (Primitive.blue700, Primitive.blue300)
        // Dark mode takes a deeper blue than the accent so white text keeps its contrast.
        case .accentFill: (Primitive.blue700, Primitive.blue650)
        case .onAccentFill: (Primitive.white, Primitive.white)
        // Between the accent fill and the accent, so white text holds 4.5:1 on it and it holds
        // 3:1 on the page background and the surface.
        case .accentSelection: (Primitive.blue700, Primitive.blue500)
        // A step deeper than the accent in dark mode, so the white thumb holds 3:1 on the track
        // and the track holds 3:1 on every background a switch sits on.
        case .accentTrack: (Primitive.blue700, Primitive.blue400)
        // The other appearance's accent, which reads on the inverse surface's text color.
        case .inverseAccent: (hex(.accent, .dark), hex(.accent, .light))
        case .brand: (Primitive.coral400, Primitive.coral400)
        // Dark in both appearances, since the brand color is light in both.
        case .onBrand: (Primitive.slate950, Primitive.slate950)
        case .brandSecondary: (Primitive.slate600, Primitive.white)
        // Darker in light mode and lighter in dark mode than the system's secondary label,
        // which falls short of 4.5:1 on a tint or a Plan sheet card.
        case .onTintSecondary: (Primitive.gray650, Primitive.gray250)
        case .danger: (Primitive.red700, Primitive.red300)
        case .warning: (Primitive.orange800, Primitive.orange300)
        // The darker light green holds 3:1 on the page background, where the system's falls
        // near 2:1.
        case .statusKnown: (Primitive.green700, Primitive.green400)
        case .statusLearning: (Primitive.orange400, Primitive.orange450)
        // Holds 3:1 on the page background and on a grouped form's card in each appearance.
        case .statusUnknown: (Primitive.gray400, Primitive.gray400)
        // On a surface or a tint, where `statusUnknown` falls under 3:1 in light mode.
        case .statusUnknownOnFill: (Primitive.gray500, Primitive.gray400)
        case .practiceBackground: (Primitive.slate800, Primitive.slate900)
        case .onPractice: (Primitive.white, Primitive.white)
        // Holds 4.5:1 on the practice background and on the tuner's in-tune background alike.
        case .onPracticeSecondary: (Primitive.slate300, Primitive.slate300)
        // Lighter than the brand color, so the tuner's close and far steps read apart by
        // lightness and not only by hue.
        case .tunerClose: (Primitive.coral200, Primitive.coral200)
        // Each appearance's practice background with 14% of the dark scheme's known green.
        case .tunerInTuneBackground: (Primitive.teal800, Primitive.green900)
        }
    }

    // MARK: Backgrounds and borders

    /// Content columns and sheets.
    public static let pageBackground = color(.pageBackground)
    /// The sidebar, cards, footers, and the practice stage.
    public static let surface = color(.surface)
    /// A control on a `surface` card or footer, where `field` would read gray on gray.
    public static let surfaceRaised = color(.surfaceRaised)
    /// Inputs, secondary buttons, and chips.
    public static let field = color(.field)
    /// A grouped form's page.
    public static let groupedBackground = color(.groupedBackground)
    /// A grouped form's cards.
    public static let groupedSurface = color(.groupedSurface)
    /// Hairlines and separators, as a color and its opacity in each appearance.
    static let borderLight = (rgb: KeyColor.RGB(red: 30 / 255, green: 40 / 255, blue: 55 / 255), alpha: 0.12)
    static let borderDark = (rgb: KeyColor.RGB(red: 230 / 255, green: 240 / 255, blue: 1), alpha: 0.10)
    public static let border = dynamic(light: borderLight, dark: borderDark)
    /// Over a scan in dark mode, so a white page does not glare; nothing in light mode.
    static let imageDim = dynamic(
        light: (KeyColor.RGB(hex: Primitive.black), 0), dark: (KeyColor.RGB(hex: Primitive.black), 0.12))

    // MARK: Text

    public static let textPrimary = color(.textPrimary)
    public static let textSecondary = color(.textSecondary)

    // MARK: Accent

    /// Text, glyphs, and focus rings.
    public static let accent = color(.accent)
    /// A primary button's or a chosen item's fill.
    public static let accentFill = color(.accentFill)
    public static let onAccentFill = color(.onAccentFill)
    /// A focused list's selection on iPhone and iPad, and its edit-mode checkmarks.
    public static let accentSelection = color(.accentSelection)
    /// An on switch's track.
    public static let accentTrack = color(.accentTrack)
    /// An action on the inverse surface, such as the undo banner's Undo.
    static let inverseAccent = color(.inverseAccent)

    /// How strongly `tint` shows the accent over what it sits on.
    public static func tintOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.22 : 0.12
    }

    /// Selection, a set filter, a current item, and a tinted control.
    public static func tint(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintOpacity(scheme))
    }

    static func tintStrongestOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.5 : 0.3
    }

    /// The strongest tint, so a track drawn on `tint` still shows. Never under an accent label.
    public static func tintStrongest(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintStrongestOpacity(scheme))
    }

    /// Whether `onTint` is the accent. Over a dark surface the tint leaves accent text short of
    /// 4.5:1, so in dark mode the label takes the primary text color.
    public static func onTintIsAccent(_ scheme: ColorScheme) -> Bool {
        scheme != .dark
    }

    /// A label on a tint: the accent in light mode, the primary text color in dark mode.
    public static func onTint(_ scheme: ColorScheme) -> Color {
        onTintIsAccent(scheme) ? accent : textPrimary
    }

    /// Secondary text on a tint or a Plan sheet card.
    public static func onTintSecondary(_ scheme: ColorScheme) -> Color {
        color(hex: hex(.onTintSecondary, scheme))
    }

    // MARK: Brand

    /// The mark's T, the playhead, the premium header, and the scrubber's marker.
    public static let brand = color(.brand)
    public static let onBrand = color(.onBrand)
    /// The mark's C, which never follows the accent.
    public static let brandSecondary = color(.brandSecondary)

    // MARK: Status

    /// Error text and destructive actions.
    public static let danger = color(.danger)
    public static let warning = color(.warning)
    public static let statusKnown = color(.statusKnown)
    public static let statusLearning = color(.statusLearning)
    /// Want to learn's ring on a background.
    public static let statusUnknown = color(.statusUnknown)
    /// The record control and Stop, which never follow the destructive role's color.
    public static let record = Color.red

    // MARK: Practice

    /// The practice screen's background in `scheme`, the app's appearance rather than the
    /// practice screen's own.
    public static func practiceBackground(_ scheme: ColorScheme) -> Color {
        color(hex: hex(.practiceBackground, scheme))
    }

    /// Text, the played waveform, and the trim handles on practice.
    public static let onPractice = color(.onPractice)
    /// Secondary text, the unplayed waveform, and the tuner's muted text on practice.
    public static let onPracticeSecondary = color(.onPracticeSecondary)
    /// Round buttons and chips on practice: the system's tertiary fill, heavier than its own so
    /// it shows on the dark practice background.
    static let practiceFill = color(hex: Primitive.zinc500, opacity: 0.44)

    // MARK: Resolving

    static func color(_ token: Token) -> Color {
        let (light, dark) = pair(token)
        return dynamic(light: (KeyColor.RGB(hex: light), 1), dark: (KeyColor.RGB(hex: dark), 1))
    }

    /// A fixed sRGB color from a `#rrggbb` string, for a value already chosen for one appearance.
    static func color(hex: String, opacity: Double = 1) -> Color {
        let rgb = KeyColor.RGB(hex: hex)
        return Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: opacity)
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

/// Warning and danger as a capsule's fill and the text on it: a deep shade on a pale fill in
/// light mode and the reverse in dark mode, so the text keeps at least 4.5:1 with its fill.
enum StatusCapsuleColors {
    nonisolated static func warning(_ scheme: ColorScheme) -> KeyColor.PillColors {
        KeyColor.PillColors(
            background: KeyColor.RGB(hex: scheme == .dark ? Primitive.orange900 : Primitive.orange100),
            text: KeyColor.RGB(hex: Palette.hex(.warning, scheme)))
    }

    nonisolated static func danger(_ scheme: ColorScheme) -> KeyColor.PillColors {
        KeyColor.PillColors(
            background: KeyColor.RGB(hex: scheme == .dark ? Primitive.red900 : Primitive.red100),
            text: KeyColor.RGB(hex: Palette.hex(.danger, scheme)))
    }
}
