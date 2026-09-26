import SwiftUI

/// The colors of a musical key's pill.
///
/// Each pitch class takes a hue from its place on the circle of fifths, thirty degrees apart,
/// so keys a fifth apart look related and a tritone apart look opposite. Lightness and chroma
/// are constant within a role, at the largest chroma that stays in the sRGB gamut for all
/// twelve hues, so no key reads louder than another and none is clipped. The web client
/// derives its key tokens from these same OKLCH values.
public enum KeyColor {
    /// An sRGB color with channels from 0 to 1.
    public struct RGB: Hashable, Sendable {
        public let red: Double
        public let green: Double
        public let blue: Double

        /// `#rrggbb`, lowercase.
        public var hex: String {
            [red, green, blue].map { channel in
                let byte = Int((channel * 255).rounded())
                return (byte < 16 ? "0" : "") + String(byte, radix: 16)
            }.reduce("#", +)
        }

        public var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }
    }

    /// A pill's ground and the text on it.
    public struct Swatch: Hashable, Sendable {
        public let background: RGB
        public let ink: RGB
    }

    private static let noteSemitones: [String: Int] = ["C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11]
    private static let accidentals: [String: Int] = ["": 0, "#": 1, "♯": 1, "b": -1, "♭": -1]

    /// The pitch class a stored key names, 0 for C through 11 for B, or nil when it is not one.
    ///
    /// The note is the first character and the accidental the rest, so a leading `b` is the
    /// note B and a trailing one a flat. Mode has its own field, so anything past an accidental
    /// (`Am`, `Dm7`) is not a key and gets no color rather than a guessed one.
    public static func pitchClass(_ key: String) -> Int? {
        let text = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = text.first, let note = noteSemitones[String(first).uppercased()],
            let accidental = accidentals[String(text.dropFirst())]
        else { return nil }
        return (note + accidental + 12) % 12
    }

    /// The pitch class's hue in degrees: C at 20, each fifth up 30 more.
    static func hue(pitchClass: Int) -> Double {
        let position = (pitchClass * 7) % 12
        return 20 + 30 * Double(position)
    }

    /// OKLCH lightness and chroma for each role: the pill's ground, then its text, which is
    /// plain white on a chosen pill in light mode.
    private static func roles(scheme: ColorScheme, chosen: Bool) -> (
        background: (Double, Double), ink: (Double, Double)?
    ) {
        switch (scheme == .dark, chosen) {
        case (false, false): ((0.88, 0.0558), (0.38, 0.062))
        case (false, true): ((0.47, 0.0763), nil)
        case (true, false): ((0.37, 0.0604), (0.86, 0.0656))
        case (true, true): ((0.72, 0.1165), (0.22, 0.0373))
        }
    }

    /// The pill's colors for a pitch class. Choosing a key changes only the weight, never the
    /// hue, so a key never looks like a different key when it is chosen.
    public static func swatch(pitchClass: Int, scheme: ColorScheme, chosen: Bool) -> Swatch {
        let hue = hue(pitchClass: pitchClass)
        let (background, ink) = roles(scheme: scheme, chosen: chosen)
        return Swatch(
            background: oklch(background.0, background.1, hue),
            ink: ink.map { oklch($0.0, $0.1, hue) } ?? RGB(red: 1, green: 1, blue: 1))
    }

    /// Converts OKLCH to sRGB through OKLab (Björn Ottosson's matrices), clamped to the gamut.
    static func oklch(_ lightness: Double, _ chroma: Double, _ hueDegrees: Double) -> RGB {
        let radians = hueDegrees * .pi / 180
        let a = chroma * cos(radians)
        let b = chroma * sin(radians)

        let l = pow(lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b, 3)
        let m = pow(lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b, 3)
        let s = pow(lightness - 0.089_484_177_5 * a - 1.291_485_548_0 * b, 3)

        let linear = (
            4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
            -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
            -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s
        )
        return RGB(red: encode(linear.0), green: encode(linear.1), blue: encode(linear.2))
    }

    /// The sRGB transfer function.
    private static func encode(_ linear: Double) -> Double {
        let clamped = min(max(linear, 0), 1)
        return clamped <= 0.003_130_8 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055
    }
}
