import CrosstuneDesign
import SwiftUI
import Testing

@testable import CrosstuneUI

struct PhoneStyleTests {
    private static let schemes: [ColorScheme] = [.light, .dark]
    private static let backgrounds = schemes.map { Palette.hex(.tunerBackground, $0) }
    private static let brand = Palette.hex(.brand, .light)
    private static let tunerClose = Palette.hex(.tunerClose, .light)
    private static let known = Palette.hex(.statusKnown, .dark)
    private static let muted = Palette.hex(.onTunerSecondary, .light)

    @Test(arguments: [ColorScheme.light, .dark], [Palette.Token.pageBackground, .surface])
    func playheadReadsOnThePageAndASurface(scheme: ColorScheme, background: Palette.Token) {
        #expect(contrastRatio(Palette.hex(.playhead, scheme), Palette.hex(background, scheme)) >= 3)
    }

    @Test func tunerStepsReadOnTheTunerBackground() {
        for background in Self.backgrounds {
            #expect(contrastRatio(Self.tunerClose, background) >= 3, "close on \(background)")
            #expect(contrastRatio(Self.brand, background) >= 3, "far on \(background)")
        }
        // Apart in lightness as well as hue, so they stay apart under red-green color blindness.
        #expect(abs(relativeLuminance(Self.tunerClose) - relativeLuminance(Self.brand)) >= 0.1)
    }

    @Test(arguments: 0...10)
    func tunerBarsReadOnTheTunerBackgroundAcrossTheBlend(step: Int) {
        let bar = Palette.tunerBarHex(cents: 3 + 0.7 * Double(step))
        for background in Self.backgrounds {
            #expect(contrastRatio(bar, background) >= 3, "\(bar) on \(background)")
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

    @Test func tunerInTuneBackgroundReadsApartAndPassesContrast() {
        for scheme in Self.schemes {
            let background = Palette.hex(.tunerBackground, scheme)
            let inTune = Palette.hex(.tunerInTuneBackground, scheme)
            #expect(inTune != background, "\(scheme) reads apart from the tuner background")
            #expect(
                contrastRatio(Palette.hex(.onTuner, scheme), inTune) >= 4.5,
                "label on the \(scheme) in-tune background")
            #expect(contrastRatio(Self.muted, inTune) >= 4.5, "muted on the \(scheme) in-tune background")
            #expect(contrastRatio(Self.muted, background) >= 4.5, "muted on the \(scheme) tuner background")
            #expect(contrastRatio(Self.known, inTune) >= 3, "green on the \(scheme) in-tune background")
        }
    }
}
