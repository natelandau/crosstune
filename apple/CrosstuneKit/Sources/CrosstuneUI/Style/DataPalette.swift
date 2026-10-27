import CrosstuneAudio
import SwiftUI

/// The colors of data drawings: loops, the heatmap, and the tuner. Each differs from every role
/// on purpose, and each derived step is defined here rather than where it is drawn.
extension Palette {
    // MARK: Loops

    /// `#rrggbb` for a loop slot's color. Saturated and darker than the key pastels so a loop
    /// never reads as a key. The values match the web's `--loop-0` to `--loop-5`.
    static func loopHex(_ slot: Int, dark: Bool) -> String {
        hex(of: loopValue(slot, dark: dark))
    }

    /// A loop's own color: its bar when selected, its edges, and its dot in the list.
    static func loop(_ slot: Int, scheme: ColorScheme) -> Color {
        color(of: loopValue(slot, dark: scheme == .dark))
    }

    /// An unselected loop's fill and the selected loop's tint through the waveform, under the
    /// page's own text color.
    static func loopTint(_ slot: Int, scheme: ColorScheme) -> Color {
        loop(slot, scheme: scheme).opacity(scheme == .dark ? 0.3 : 0.2)
    }

    /// An unselected loop's tint through the waveform, quieter than the selected loop's.
    static func loopTintUnselected(_ slot: Int, scheme: ColorScheme) -> Color {
        loopTint(slot, scheme: scheme).opacity(0.5)
    }

    /// A loop's bar in the overview strip: full when selected, quieter otherwise, so the selected
    /// loop leads.
    static func loopOverview(_ slot: Int, scheme: ColorScheme, selected: Bool) -> Color {
        loop(slot, scheme: scheme).opacity(selected ? 1 : 0.6)
    }

    private static func loopValue(_ slot: Int, dark isDark: Bool) -> UInt32 {
        let count = Primitive.loopLight.count
        let index = ((slot % count) + count) % count
        return isDark ? Primitive.loopDark[index] : Primitive.loopLight[index]
    }

    // MARK: Heatmap

    /// `#rrggbb` for an active day at `level`, 1 through 4. Each step darkens in light mode and
    /// lightens in dark mode, and holds at least 3:1 against every surface the grid can sit on:
    /// the grouped row and page in light (#FFFFFF down to #E5E5EA) and dark (#000000 up to
    /// #3A3A3C) on iOS and macOS. The web's `--heat-1` to `--heat-4` match.
    static func heatmapHex(_ level: Int, dark: Bool) -> String {
        hex(of: heatmapValue(level, dark: dark))
    }

    /// The fill of an active day at `level`, 1 through 4.
    static func heatmap(_ level: Int, scheme: ColorScheme) -> Color {
        color(of: heatmapValue(level, dark: scheme == .dark))
    }

    private static func heatmapValue(_ level: Int, dark isDark: Bool) -> UInt32 {
        let index = min(max(level, 1), Primitive.heatmapLight.count) - 1
        return isDark ? Primitive.heatmapDark[index] : Primitive.heatmapLight[index]
    }

    // MARK: Tuner

    /// The tuner's background while the note is in tune: 14% of the in-tune green over the
    /// practice background, as the web's `--tuner-in-tune-background` mixes it.
    static func tunerInTuneBackgroundHex(_ scheme: ColorScheme) -> String {
        mixHex(hex(.practiceBackground, scheme), toward: hex(.tunerInTune, scheme), share: 0.14)
    }

    /// The tuner's background in `scheme` for a note `green` of the way to in tune: the practice
    /// background outside the target zone, the full in-tune background in tune.
    static func tunerBackgroundHex(_ scheme: ColorScheme, green: Double) -> String {
        mixHex(hex(.practiceBackground, scheme), toward: hex(.tunerInTuneBackground, scheme), share: green)
    }

    /// The welcome tuner illustration's background, which keeps its own lighter practice
    /// background in light mode, as the web's illustration does.
    static func illustrationTunerBackgroundHex(_ scheme: ColorScheme, green: Double) -> String {
        let base = scheme == .dark ? Primitive.slate900 : Primitive.slate800
        let inTune = mixHex(base, toward: hex(.tunerInTune, scheme), share: 0.14)
        return mixHex(base, toward: inTune, share: green)
    }

    /// The tuner's bars for a note `cents` off: the brand color far off, the close step just
    /// outside the target zone, and blending from the close step to the dark scheme's known
    /// green inside it.
    static func tunerBarHex(cents: Double) -> String {
        switch tuneStep(cents: cents) {
        case .far: hex(.brand, .light)
        case .close: hex(.tunerClose, .light)
        case .zone:
            mixHex(hex(.tunerClose, .light), toward: hex(.tunerInTune, .light), share: inTuneFraction(cents: cents))
        }
    }

    /// The tuner zone's tint for a note `green` of the way to in tune: the muted practice text
    /// color at rest, blending toward the dark scheme's known green, as the web's `TunerBars`
    /// mixes it.
    static func tunerZone(green: Double) -> Color {
        color(hex: mixHex(hex(.onPracticeSecondary, .dark), toward: hex(.tunerInTune, .light), share: green / 2))
            .opacity(0.14 + 0.06 * green)
    }

    /// The glow around a tuner bar drawn in `color`.
    static func tunerGlow(_ color: Color) -> Color {
        color.opacity(0.7)
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

    // MARK: Packed values

    private static func hex(of value: UInt32) -> String {
        let digits = String(value, radix: 16)
        return "#" + String(repeating: "0", count: 6 - digits.count) + digits
    }

    private static func color(of rgb: UInt32) -> Color {
        Color(
            .sRGB, red: Double(rgb >> 16 & 0xff) / 255, green: Double(rgb >> 8 & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255)
    }
}
