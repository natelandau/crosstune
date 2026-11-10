#if os(macOS)
    import CrosstuneDesign
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    struct MacChipTests {
        /// The chosen key's ring is an indicator, so it holds 3:1 on both its sides for every
        /// key's hue: the accent sits too near a chosen hue's lightness, so a line of the page
        /// background parts the two, and outside the ring is the page background or surface the
        /// chip sits on.
        @Test(arguments: [ColorScheme.light, .dark])
        func chosenKeyRingHoldsContrastOnEveryHue(scheme: ColorScheme) {
            let ring = Palette.hex(MacChip.ringToken, scheme)
            let gap = Palette.hex(MacChip.ringGapToken, scheme)
            #expect(MacChip.ringGapWidth > 0)
            #expect(contrastRatio(ring, gap) >= 3)
            for background in [Palette.Token.pageBackground, .surface] {
                #expect(contrastRatio(ring, Palette.hex(background, scheme)) >= 3, "\(background)")
            }
            // The side the ring faces inward: the hue itself where it holds, else the gap.
            for pitchClass in 0..<12 {
                let hue = KeyColor.pillColors(pitchClass: pitchClass, scheme: scheme, chosen: true).background.hex
                let inside = MacChip.ringGapWidth > 0 ? gap : hue
                #expect(contrastRatio(ring, inside) >= 3, "pitch class \(pitchClass)")
            }
        }

        /// A set chip's label on its tint at rest, hover, and press, over the backgrounds a chip
        /// sits on.
        @Test(arguments: [ColorScheme.light, .dark], [Palette.Token.pageBackground, .surface])
        func setChipLabelPassesContrastOnItsTint(scheme: ColorScheme, background: Palette.Token) {
            let label = MacChip.labelRGB(state: .set, scheme: scheme).hex
            for press in [MacPressState.rest, .hover, .pressed] {
                let tint = MacChip.setTintHex(over: Palette.hex(background, scheme), scheme: scheme, press: press)
                #expect(contrastRatio(label, tint) >= 4.5, "\(press)")
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

        /// A rest chip takes its container's control fill, so it never reads gray on a card.
        @Test(arguments: [ColorScheme.light, .dark])
        func restChipReadsItsContainer(scheme: ColorScheme) {
            #expect(
                MacChip.solidFillHex(state: .rest, scheme: scheme, container: .surface)
                    == Palette.hex(.surfaceRaised, scheme).lowercased())
        }
    }
#endif
