import Foundation

@testable import CrosstuneUI

/// WCAG 2 contrast ratio between two sRGB colors.
func contrastRatio(_ first: KeyColor.RGB, _ second: KeyColor.RGB) -> Double {
    func luminance(_ color: KeyColor.RGB) -> Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }
    let (a, b) = (luminance(first), luminance(second))
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
}

/// The same ratio for `#rrggbb` strings.
func contrastRatio(_ first: String, _ second: String) -> Double {
    contrastRatio(KeyColor.RGB(hex: first), KeyColor.RGB(hex: second))
}

/// `top` drawn at `opacity` over `bottom`, as `#rrggbb`.
func blend(_ top: String, over bottom: String, opacity: Double) -> String {
    let (top, bottom) = (KeyColor.RGB(hex: top), KeyColor.RGB(hex: bottom))
    func mix(_ upper: Double, _ lower: Double) -> Double { upper * opacity + lower * (1 - opacity) }
    return KeyColor.RGB(
        red: mix(top.red, bottom.red), green: mix(top.green, bottom.green), blue: mix(top.blue, bottom.blue)
    ).hex
}
