#if os(macOS)
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacChipTests {
        /// The chosen key's ring is an indicator, so it holds 3:1 on both its sides for every
        /// key's hue: the accent sits too near a chosen hue's lightness, so a line of ground
        /// parts the two, and outside the ring is the ground or surface the chip sits on.
        @Test(arguments: [ColorScheme.light, .dark])
        func chosenKeyRingHoldsContrastOnEveryHue(scheme: ColorScheme) {
            let ring = Palette.hex(MacChip.ringToken, scheme)
            let gap = Palette.hex(MacChip.ringGapToken, scheme)
            #expect(MacChip.ringGapWidth > 0)
            #expect(contrastRatio(ring, gap) >= 3)
            for ground in [Palette.Token.ground, .surface] {
                #expect(contrastRatio(ring, Palette.hex(ground, scheme)) >= 3, "\(ground)")
            }
            // The side the ring faces inward: the hue itself where it holds, else the gap.
            for pitchClass in 0..<12 {
                let hue = KeyColor.swatch(pitchClass: pitchClass, scheme: scheme, chosen: true).background.hex
                let inside = MacChip.ringGapWidth > 0 ? gap : hue
                #expect(contrastRatio(ring, inside) >= 3, "pitch class \(pitchClass)")
            }
        }

        /// A set chip's label on its wash, over the grounds a chip sits on.
        @Test(arguments: [ColorScheme.light, .dark])
        func setChipLabelPassesContrastOnItsWash(scheme: ColorScheme) {
            let label = MacChip.labelRGB(state: .set, scheme: scheme).hex
            for ground in [Palette.Token.ground, .surface] {
                let wash = MacChip.setWashHex(over: Palette.hex(ground, scheme), scheme: scheme)
                #expect(contrastRatio(label, wash) >= 4.5, "\(scheme) on \(ground)")
            }
        }

        /// A chosen chip with no hue of its own is the accent fill under a white label.
        @Test(arguments: [ColorScheme.light, .dark])
        func chosenChipWithoutHueUsesAccentFill(scheme: ColorScheme) {
            #expect(
                MacChip.solidFillHex(state: .chosen, scheme: scheme) == Palette.hex(.accentFill, scheme).lowercased()
            )
            #expect(
                MacChip.labelRGB(state: .chosen, scheme: scheme).hex
                    == Palette.hex(.onAccentFill, scheme).lowercased())
            #expect(
                contrastRatio(
                    MacChip.labelRGB(state: .chosen, scheme: scheme).hex, Palette.hex(.accentFill, scheme)) >= 4.5)
        }

        @Test func rowKeyPillHasMinimumWidth() {
            #expect(MacChip.minRowWidth == 28)
            #expect(MacChip.Size.row.height == 18)
            #expect(MacChip.Size.standalone.height == 26)
        }
    }
#endif
