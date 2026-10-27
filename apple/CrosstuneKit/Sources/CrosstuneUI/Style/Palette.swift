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
        case pageBackground, surface, surfaceRaised, field, fieldHover, groupedBackground, groupedSurface
        case textPrimary, textSecondary, textTertiary, neutralFill
        case accent, accentFill, onAccentFill, accentSelection, accentTrack, inverseAccent
        case brand, onBrand, brandSecondary, onTintSecondary
        case danger, warning, warningFill, onWarningFill, onStatus
        case warningFillStrong, dangerFillStrong, onStatusStrong
        case statusKnown, statusLearning, statusUnknown, statusUnknownOnFill, onRecord
        case practiceBackground, onPractice, onPracticeSecondary, tunerClose, tunerInTune, tunerInTuneBackground
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
        case .fieldHover: (Primitive.warmGray150, Primitive.gray800)
        // The layers swap in dark mode so a card still contrasts with the page.
        case .groupedBackground: (hex(.surface, .light), hex(.pageBackground, .dark))
        case .groupedSurface: (hex(.pageBackground, .light), hex(.surface, .dark))
        case .textPrimary: (Primitive.gray925, Primitive.gray100)
        case .textSecondary: (Primitive.gray600, Primitive.gray300)
        // The faintest text that still clears 3:1: a glyph that cannot act, an unplayed waveform,
        // a quiet bar.
        case .textTertiary: (Primitive.warmGray500, Primitive.warmGray500)
        // A solid gray action, such as a gray swipe action, under a white label.
        case .neutralFill: (Primitive.gray600, Primitive.gray600)
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
        // The brand color in light mode, where an orange that carries a white label reads brown.
        case .warningFill: (hex(.brand, .light), hex(.warning, .dark))
        case .onWarningFill: (hex(.onBrand, .light), hex(.onStatus, .dark))
        // Text or a glyph on a danger, known, or dark-mode warning fill.
        case .onStatus: (Primitive.white, Primitive.gray950)
        // A swipe action's warning and danger fills. The system draws a swipe action's label
        // white in both appearances, so each fill is deep enough for white to hold 4.5:1.
        case .warningFillStrong: (Primitive.orange700, Primitive.orange700)
        case .dangerFillStrong: (Primitive.red700, Primitive.red700)
        case .onStatusStrong: (Primitive.white, Primitive.white)
        // The darker light green holds 3:1 on the page background, where the system's falls
        // near 2:1.
        case .statusKnown: (Primitive.green700, Primitive.green400)
        case .statusLearning: (Primitive.orange400, Primitive.orange450)
        // Holds 3:1 on the page background and on a grouped form's card in each appearance.
        case .statusUnknown: (Primitive.gray400, Primitive.gray400)
        // On a surface or a tint, where `statusUnknown` falls under 3:1 in light mode.
        case .statusUnknownOnFill: (Primitive.gray500, Primitive.gray400)
        // White falls under 4.5:1 on the record red, so its label is dark.
        case .onRecord: (Primitive.gray950, Primitive.gray950)
        // The same dark background in either appearance.
        case .practiceBackground: (Primitive.slate900, Primitive.slate900)
        case .onPractice: (Primitive.white, Primitive.white)
        // Holds 4.5:1 on the practice background and on the tuner's in-tune background alike.
        case .onPracticeSecondary: (Primitive.slate300, Primitive.slate300)
        // Lighter than the brand color, so the tuner's close and far steps read apart by
        // lightness and not only by hue.
        case .tunerClose: (Primitive.coral200, Primitive.coral200)
        // The dark scheme's known green, in either appearance.
        case .tunerInTune: (Primitive.green400, Primitive.green400)
        case .tunerInTuneBackground:
            (tunerInTuneBackgroundHex(.light), tunerInTuneBackgroundHex(.dark))
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
    public static let fieldHover = color(.fieldHover)
    /// Hairlines and separators, as a color and its opacity in each appearance.
    static let borderLight = (rgb: KeyColor.RGB(red: 30 / 255, green: 40 / 255, blue: 55 / 255), alpha: 0.12)
    static let borderDark = (rgb: KeyColor.RGB(red: 230 / 255, green: 240 / 255, blue: 1), alpha: 0.10)
    public static let border = dynamic(light: borderLight, dark: borderDark)
    /// Behind a label over a waveform on the page, so the waveform shows faintly through.
    public static let pageBackgroundTranslucent = translucent(.pageBackground, 0.8)
    /// Dashed outlines and slider tracks.
    public static let borderStrong = translucent(.textPrimary, 0.22)
    /// Laid over a fill that has no hover or press of its own.
    public static let hoverOverlay = translucent(.textPrimary, 0.06)
    /// Behind a tooltip or the undo banner: the other appearance's page.
    public static let inverseSurface = color(.textPrimary)
    public static let onInverseSurface = color(.pageBackground)
    /// Over a scan in dark mode, so a white page does not glare; nothing in light mode.
    static let imageDim = dynamic(
        light: (KeyColor.RGB(hex: Primitive.black), 0), dark: (KeyColor.RGB(hex: Primitive.black), 0.12))

    // MARK: Text

    public static let textPrimary = color(.textPrimary)
    public static let textSecondary = color(.textSecondary)
    public static let textTertiary = color(.textTertiary)
    public static let neutralFill = color(.neutralFill)
    /// The ring of a filled control that is off, which draws no fill.
    public static let disabledBorder = borderStrong
    /// The label of a filled control that is off.
    public static let onDisabled = translucent(.textPrimary, 0.45)

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

    // The accent tint scale. Each step reads apart from the next; `tintStrong` is the strongest
    // an accent label holds 4.5:1 on.

    static func tintSubtleOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.10 : 0.08
    }

    /// A hover on a row or plain control, the playing row, and a drop target.
    public static func tintSubtle(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintSubtleOpacity(scheme))
    }

    /// How strongly `tint` shows the accent over what it sits on.
    public static func tintOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.22 : 0.12
    }

    /// Selection, a set filter, a current item, and a tinted control.
    public static func tint(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintOpacity(scheme))
    }

    static func tintStrongOpacity(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.28 : 0.18
    }

    /// A hover over a tint, and the Plan sheet's premium column.
    public static func tintStrong(_ scheme: ColorScheme) -> Color {
        accent.opacity(tintStrongOpacity(scheme))
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
    public static let onStatus = color(.onStatus)
    /// How strongly a status's subtle fill shows it: a selected status segment, a destructive
    /// hover, an error or warning capsule.
    static let subtleOpacity = 0.15

    /// `token`'s subtle fill.
    static func subtle(_ token: Token) -> Color {
        translucent(token, subtleOpacity)
    }
    /// A warning button's and a warning swipe action's fill.
    public static let warningFill = color(.warningFill)
    public static let onWarningFill = color(.onWarningFill)
    public static let warningFillStrong = color(.warningFillStrong)
    public static let dangerFillStrong = color(.dangerFillStrong)
    /// The label on a strong status fill, which the system draws for a swipe action.
    public static let onStatusStrong = color(.onStatusStrong)
    /// Every fill a swipe action takes. Each carries the system's white label.
    static let swipeFills: [Token] = [.neutralFill, .accentFill, .warningFillStrong, .dangerFillStrong]
    public static let statusKnown = color(.statusKnown)
    public static let statusLearning = color(.statusLearning)
    /// Want to learn's ring on a background.
    public static let statusUnknown = color(.statusUnknown)
    /// The record control and Stop, which never follow the destructive role's color.
    public static let record = Color.red
    public static let onRecord = color(.onRecord)

    // MARK: Practice

    /// The practice screen's background in `scheme`, the app's appearance rather than the
    /// practice screen's own.
    public static func practiceBackground(_ scheme: ColorScheme) -> Color {
        color(hex: hex(.practiceBackground, scheme))
    }

    /// Behind a label over the practice waveform, so the waveform shows faintly through.
    static func practiceBackgroundTranslucent(_ scheme: ColorScheme) -> Color {
        color(hex: hex(.practiceBackground, scheme), opacity: 0.8)
    }

    /// Text, the played waveform, and the trim handles on practice.
    public static let onPractice = color(.onPractice)
    /// Secondary text, the unplayed waveform, and the tuner's muted text on practice.
    public static let onPracticeSecondary = color(.onPracticeSecondary)
    /// Round buttons and chips on practice: the system's tertiary fill, heavier than its own so
    /// it shows on the dark practice background.
    static let practiceFill = color(hex: Primitive.gray470, opacity: 0.44)

    // MARK: Resolving

    /// `token` at `opacity` in each appearance.
    static func translucent(_ token: Token, _ opacity: Double) -> Color {
        let (light, dark) = pair(token)
        return dynamic(light: (KeyColor.RGB(hex: light), opacity), dark: (KeyColor.RGB(hex: dark), opacity))
    }

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
