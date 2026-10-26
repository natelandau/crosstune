import CrosstuneAudio
import SwiftUI

/// The iPhone's practice ground, waveform, and control sizes, and the tuner's colors, which
/// every platform draws on the practice ground.
public enum PhoneStyle {
    public static let practiceGroundLight = "#2D3142"
    public static let practiceGroundDark = "#1E212C"
    public static let waveUnplayed = "#BFC0C0"
    public static let wavePlayed = "#FFFFFF"

    /// The practice screen's jet-colored ground in `scheme`.
    public static func practiceGround(_ scheme: ColorScheme) -> Color {
        BrandStyle.color(hex: scheme == .dark ? practiceGroundDark : practiceGroundLight)
    }

    /// The tuner's close step, lighter than its far step of full coral, so the two read apart
    /// by lightness and not only by hue. The bars blend from it to green inside the target zone.
    public static let tuneCloseHex = "#F6BBA1"
    /// The tuner's ground while the note is in tune: each appearance's jet with 14% of the dark
    /// scheme's known green mixed in, as the web's `--tune-wash` is.
    public static let tuneWashLight = "#2D4745"
    public static let tuneWashDark = "#213A32"

    /// The tuner's secondary text: silver, which holds 4.5:1 on the ground and the wash alike,
    /// where the dark scheme's secondary ink falls short on the light appearance's wash.
    public static let tuneMutedHex = "#BFC0C0"

    public static var tuneMuted: Color { BrandStyle.color(hex: tuneMutedHex) }

    static func tuneWashHex(_ scheme: ColorScheme) -> String {
        scheme == .dark ? tuneWashDark : tuneWashLight
    }

    /// The tuner's ground in `scheme` for a note `green` of the way to in tune: the practice
    /// ground outside the target zone, the full wash in tune.
    static func tuneGroundHex(_ scheme: ColorScheme, green: Double) -> String {
        mixHex(scheme == .dark ? practiceGroundDark : practiceGroundLight, toward: tuneWashHex(scheme), share: green)
    }

    /// The tuner's bars for a note `cents` off: coral far off, the close step just outside the
    /// target zone, and blending from the close step to the dark scheme's known green inside it.
    static func tuneBarHex(cents: Double) -> String {
        switch tuneStep(cents: cents) {
        case .far: BrandStyle.coralHex
        case .close: tuneCloseHex
        case .zone: mixHex(tuneCloseHex, toward: StatusStyle.knownDarkHex, share: inTuneFraction(cents: cents))
        }
    }

    /// `share` of `toward` mixed into `from` in sRGB, as the web's `color-mix(in srgb, …)` mixes.
    static func mixHex(_ from: String, toward: String, share: Double) -> String {
        let (a, b) = (KeyColor.RGB(hex: from), KeyColor.RGB(hex: toward))
        let t = min(1, max(0, share))
        return KeyColor.RGB(
            red: a.red + (b.red - a.red) * t, green: a.green + (b.green - a.green) * t,
            blue: a.blue + (b.blue - a.blue) * t
        ).hex
    }

    public static let transportPlayDiameter: CGFloat = 72
    public static let stopDiameter: CGFloat = 80
    public static let filterControlHeight: CGFloat = 32
    /// The widest a line of lyrics runs, so a long line stays easy to follow across.
    public static let lyricsMaxWidth: CGFloat = 600
    /// How far a horizontal drag must travel to skip.
    public static let swipeSkipThreshold: CGFloat = 60
    /// How long a new take stays highlighted.
    public static let newTakeHighlight: Duration = .milliseconds(1500)
}
