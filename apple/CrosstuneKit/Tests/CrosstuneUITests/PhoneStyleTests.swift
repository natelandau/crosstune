import CrosstuneDesign
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct PhoneStyleTests {
    private static let schemes: [ColorScheme] = [.light, .dark]
    private static let backgrounds = schemes.map { Palette.hex(.tunerBackground, $0) }
    private static let brand = Palette.hex(.brand, .light)
    private static let tunerClose = Palette.hex(.tunerClose, .light)
    private static let known = Palette.hex(.statusKnown, .dark)
    private static let muted = Palette.hex(.onTunerSecondary, .light)

    @Test func playheadReadsOnThePageAndASurface() {
        for scheme in Self.schemes {
            for background in [Palette.Token.pageBackground, .surface] {
                #expect(
                    contrastRatio(Palette.hex(.playhead, scheme), Palette.hex(background, scheme)) >= 3,
                    "\(scheme) \(background)")
            }
        }
    }

    /// The tuner draws on one dark background in either appearance.
    @Test func tunerBackgroundIsOneValueInEachAppearance() {
        for (scheme, hex) in [
            (ColorScheme.light, "#1E212C"), (ColorScheme.dark, "#1E212C"),
        ] {
            let resolved = Palette.tunerBackground(scheme).resolve(in: EnvironmentValues())
            let expected = KeyColor.RGB(hex: hex)
            #expect(abs(Double(resolved.red) - expected.red) < 0.01, "\(scheme) red")
            #expect(abs(Double(resolved.green) - expected.green) < 0.01, "\(scheme) green")
            #expect(abs(Double(resolved.blue) - expected.blue) < 0.01, "\(scheme) blue")
        }
    }

    @Test func tunerStepsReadOnTheTunerBackground() {
        for background in Self.backgrounds {
            #expect(contrastRatio(Self.tunerClose, background) >= 3, "close on \(background)")
            #expect(contrastRatio(Self.brand, background) >= 3, "far on \(background)")
        }
        // Apart in lightness as well as hue, so they stay apart under red-green color blindness.
        #expect(abs(relativeLuminance(Self.tunerClose) - relativeLuminance(Self.brand)) >= 0.1)
    }

    @Test func tunerBarsReadOnTheTunerBackgroundAcrossTheBlend() {
        for step in 0...10 {
            let bar = Palette.tunerBarHex(cents: 3 + 0.7 * Double(step))
            for background in Self.backgrounds {
                #expect(contrastRatio(bar, background) >= 3, "\(bar) on \(background)")
            }
        }
    }

    @Test func tunerBarStepsOutsideTheZoneAndBlendsInsideIt() {
        #expect(Palette.tunerBarHex(cents: 30) == Self.brand)
        #expect(Palette.tunerBarHex(cents: -12) == Self.tunerClose)
        #expect(Palette.tunerBarHex(cents: 10) == Self.tunerClose.lowercased())
        #expect(Palette.tunerBarHex(cents: -3) == Self.known.lowercased())
        let half = Palette.tunerBarHex(cents: 6.5)
        #expect(half != Self.tunerClose.lowercased() && half != Self.known.lowercased())
    }

    @Test func tunerBackgroundBlendsFromItsOwnToTheInTuneBackground() {
        for scheme in Self.schemes {
            let background = Palette.hex(.tunerBackground, scheme)
            let inTune = Palette.hex(.tunerInTuneBackground, scheme)
            #expect(Palette.tunerBackgroundHex(scheme, green: 0) == background.lowercased())
            #expect(Palette.tunerBackgroundHex(scheme, green: 1) == inTune.lowercased())
        }
    }

    @Test func tunerInTuneBackgroundMixesTheGreenIntoEachTunerBackground() {
        for scheme in Self.schemes {
            let background = Palette.hex(.tunerBackground, scheme)
            let inTune = Palette.hex(.tunerInTuneBackground, scheme)
            let mixed = KeyColor.RGB(hex: blend(Self.known, over: background, opacity: 0.14))
            let rgb = KeyColor.RGB(hex: inTune)
            #expect(abs(rgb.red - mixed.red) <= 1.0 / 255, "\(scheme) red")
            #expect(abs(rgb.green - mixed.green) <= 1.0 / 255, "\(scheme) green")
            #expect(abs(rgb.blue - mixed.blue) <= 1.0 / 255, "\(scheme) blue")
            #expect(inTune != background, "\(scheme) reads apart from the tuner background")
            #expect(contrastRatio("#FFFFFF", inTune) >= 4.5, "white on the \(scheme) in-tune background")
            #expect(contrastRatio(Self.muted, inTune) >= 4.5, "muted on the \(scheme) in-tune background")
            #expect(contrastRatio(Self.muted, background) >= 4.5, "muted on the \(scheme) tuner background")
            #expect(contrastRatio(Self.known, inTune) >= 3, "green on the \(scheme) in-tune background")
        }
    }
}
