import SwiftUI

/// The six practice loop colors, one per palette slot, each with a light and a dark variant.
/// Saturated and darker than the key pastels so a loop never reads as a key. The values match
/// the web's `--loop-0` to `--loop-5`.
enum LoopColor {
    private static let light: [UInt32] = [0x1f5fd6, 0xb34700, 0x1e7a34, 0xb0247a, 0x00727a, 0x6b3fc4]
    private static let dark: [UInt32] = [0x3570dc, 0xc0560a, 0x26853c, 0xc8368c, 0x0f808a, 0x7d56d8]

    private static func value(_ slot: Int, dark isDark: Bool) -> UInt32 {
        let index = ((slot % light.count) + light.count) % light.count
        return isDark ? dark[index] : light[index]
    }

    /// `#rrggbb` for `slot`'s variant.
    static func hex(_ slot: Int, dark: Bool) -> String {
        let digits = String(value(slot, dark: dark), radix: 16)
        return "#" + String(repeating: "0", count: 6 - digits.count) + digits
    }

    /// A loop's own color: its bar when selected, its edges, and its dot in the list.
    static func color(_ slot: Int, scheme: ColorScheme) -> Color {
        let rgb = value(slot, dark: scheme == .dark)
        return Color(
            .sRGB, red: Double(rgb >> 16 & 0xff) / 255, green: Double(rgb >> 8 & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255)
    }

    /// An unselected loop's fill and the selected loop's tint through the waveform, under the
    /// page's own text color.
    static func tint(_ slot: Int, scheme: ColorScheme) -> Color {
        color(slot, scheme: scheme).opacity(scheme == .dark ? 0.3 : 0.2)
    }
}
