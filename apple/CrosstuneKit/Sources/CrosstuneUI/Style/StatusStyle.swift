import CrosstuneVocabulary
import SwiftUI

/// How a tune's learning status looks: its label, and a filled dot or a hollow ring beside it.
public enum StatusStyle {
    /// How a status's dot is drawn.
    public enum Dot: Equatable, Sendable {
        case filled(Color)
        case ring
    }

    /// Known's green, the same on every platform: the darker light green holds 3:1 on paper,
    /// where the system's falls near 2:1.
    public static let knownLightHex = "#248A3D"
    public static let knownDarkHex = "#30D158"

    public static let known = Palette.dynamic(
        light: KeyColor.RGB(hex: knownLightHex), dark: KeyColor.RGB(hex: knownDarkHex))

    /// Want to learn's status gray, the same on every platform. It holds 3:1 on the ground and
    /// on a grouped form's card in each appearance.
    public static let unknownHex = "#8A909A"
    public static var unknown: Color { BrandStyle.color(hex: unknownHex) }

    /// Want to learn's gray on a surface or a wash, where the shared gray falls under 3:1 in
    /// light mode.
    public static func unknownOnSurfaceHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? unknownHex : "#737983"
    }

    /// The status a tune shows. A value this build does not know shows as want to learn.
    public static func normalized(_ status: String) -> String {
        Vocabulary.statusLabels[status] == nil ? "want_to_learn" : status
    }

    /// "Known", "Learning", or "Unknown".
    public static func label(_ status: String) -> String {
        Vocabulary.statusLabels[normalized(status)]!
    }

    /// Known is a filled green dot, learning a filled orange one, want to learn a hollow ring.
    public static func dot(_ status: String) -> Dot {
        switch normalized(status) {
        case "known": .filled(known)
        case "learning": .filled(.orange)
        default: .ring
        }
    }
}

extension Color {
    /// The record control and Stop, which never follow the destructive role's color.
    public static let recordingRed = Color.red
}
