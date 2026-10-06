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
}
