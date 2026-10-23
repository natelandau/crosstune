import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct PhoneStyleTests {
    private static let grounds = [PhoneStyle.practiceGroundLight, PhoneStyle.practiceGroundDark]

    @Test func practiceGroundTakesEachAppearancesJet() {
        for (scheme, hex) in [
            (ColorScheme.light, "#2D3142"), (ColorScheme.dark, "#1E212C"),
        ] {
            let resolved = PhoneStyle.practiceGround(scheme).resolve(in: EnvironmentValues())
            let expected = KeyColor.RGB(hex: hex)
            #expect(abs(Double(resolved.red) - expected.red) < 0.01, "\(scheme) red")
            #expect(abs(Double(resolved.green) - expected.green) < 0.01, "\(scheme) green")
            #expect(abs(Double(resolved.blue) - expected.blue) < 0.01, "\(scheme) blue")
        }
    }

    @Test func waveformReadsOnTheGround() {
        for ground in Self.grounds {
            #expect(contrastRatio(PhoneStyle.waveUnplayed, ground) >= 3, "unplayed on \(ground)")
            #expect(contrastRatio(PhoneStyle.wavePlayed, ground) >= 4.5, "played on \(ground)")
        }
    }

    @Test func coralPlayheadReadsOnTheGround() {
        for ground in Self.grounds {
            #expect(contrastRatio(BrandStyle.coralHex, ground) >= 3, "coral on \(ground)")
        }
    }

    @Test func tunerStepsReadOnTheGround() {
        for ground in Self.grounds {
            #expect(contrastRatio(PhoneStyle.tuneCloseHex, ground) >= 3, "close on \(ground)")
            #expect(contrastRatio(BrandStyle.coralHex, ground) >= 3, "far on \(ground)")
        }
        // Apart in lightness as well as hue, so they stay apart under red-green color blindness.
        #expect(abs(relativeLuminance(PhoneStyle.tuneCloseHex) - relativeLuminance(BrandStyle.coralHex)) >= 0.1)
    }

    @Test func tunerBarsReadOnTheGroundAcrossTheBlend() {
        for step in 0...10 {
            let bar = PhoneStyle.tuneBarHex(cents: 3 + 0.7 * Double(step))
            for ground in Self.grounds {
                #expect(contrastRatio(bar, ground) >= 3, "\(bar) on \(ground)")
            }
        }
    }

    @Test func tunerBarStepsOutsideTheZoneAndBlendsInsideIt() {
        #expect(PhoneStyle.tuneBarHex(cents: 30) == BrandStyle.coralHex)
        #expect(PhoneStyle.tuneBarHex(cents: -12) == PhoneStyle.tuneCloseHex)
        #expect(PhoneStyle.tuneBarHex(cents: 10) == PhoneStyle.tuneCloseHex.lowercased())
        #expect(PhoneStyle.tuneBarHex(cents: -3) == StatusStyle.knownDarkHex.lowercased())
        let half = PhoneStyle.tuneBarHex(cents: 6.5)
        #expect(half != PhoneStyle.tuneCloseHex.lowercased() && half != StatusStyle.knownDarkHex.lowercased())
    }

    @Test func tunerGroundBlendsFromTheGroundToTheWash() {
        for (scheme, ground) in [
            (ColorScheme.light, PhoneStyle.practiceGroundLight), (.dark, PhoneStyle.practiceGroundDark),
        ] {
            #expect(PhoneStyle.tuneGroundHex(scheme, green: 0) == ground.lowercased())
            #expect(PhoneStyle.tuneGroundHex(scheme, green: 1) == PhoneStyle.tuneWashHex(scheme).lowercased())
        }
    }

    @Test func tunerWashMixesTheGreenIntoEachGround() {
        for (scheme, ground) in [
            (ColorScheme.light, PhoneStyle.practiceGroundLight), (.dark, PhoneStyle.practiceGroundDark),
        ] {
            let wash = PhoneStyle.tuneWashHex(scheme)
            let mixed = KeyColor.RGB(hex: blend(StatusStyle.knownDarkHex, over: ground, opacity: 0.14))
            let rgb = KeyColor.RGB(hex: wash)
            #expect(abs(rgb.red - mixed.red) <= 1.0 / 255, "\(scheme) red")
            #expect(abs(rgb.green - mixed.green) <= 1.0 / 255, "\(scheme) green")
            #expect(abs(rgb.blue - mixed.blue) <= 1.0 / 255, "\(scheme) blue")
            #expect(wash != ground, "\(scheme) reads apart from the ground")
            #expect(contrastRatio("#FFFFFF", wash) >= 4.5, "white on the \(scheme) wash")
            #expect(contrastRatio(PhoneStyle.tuneMutedHex, wash) >= 4.5, "muted on the \(scheme) wash")
            #expect(contrastRatio(PhoneStyle.tuneMutedHex, ground) >= 4.5, "muted on the \(scheme) ground")
            #expect(contrastRatio(StatusStyle.knownDarkHex, wash) >= 3, "green on the \(scheme) wash")
        }
    }
}
