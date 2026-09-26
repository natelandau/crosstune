import SwiftUI
import Testing

@testable import CrosstuneUI

/// Each channel of `hex` as a byte.
private func bytes(_ hex: String) -> [Int] {
    let digits = Array(hex.dropFirst())
    return stride(from: 0, to: 6, by: 2).map { Int(String(digits[$0..<$0 + 2]), radix: 16)! }
}

/// Whether two colors agree to within one step per channel, the rounding the web's committed
/// hex values carry.
private func matches(_ color: KeyColor.RGB, _ hex: String) -> Bool {
    zip(bytes(color.hex), bytes(hex)).allSatisfy { abs($0 - $1) <= 1 }
}

@Suite struct PitchClassTests {
    @Test(arguments: [
        ("C", 0), ("D", 2), ("E", 4), ("F", 5), ("G", 7), ("A", 9), ("B", 11), ("F#", 6), ("Gb", 6),
        ("Bb", 10), ("A#", 10), ("bb", 10), ("b", 11), ("C♯", 1), ("E♭", 3), ("Cb", 11), (" D ", 2),
    ])
    func readsANoteAndItsAccidental(key: String, pitch: Int) {
        #expect(KeyColor.pitchClass(key) == pitch)
    }

    @Test(arguments: ["", "Am", "Dm7", "H", "C/G", "D major", "ß", "Bconstructor"])
    func refusesAnythingElse(key: String) {
        #expect(KeyColor.pitchClass(key) == nil)
    }

    @Test func placesHuesAroundTheCircleOfFifths() {
        #expect(KeyColor.hue(pitchClass: 0) == 20)  // C
        #expect(KeyColor.hue(pitchClass: 7) == 50)  // G
        #expect(KeyColor.hue(pitchClass: 2) == 80)  // D
        #expect(KeyColor.hue(pitchClass: 6) == 200)  // F sharp
        #expect(KeyColor.hue(pitchClass: 5) == 350)  // F
    }
}

@Suite struct KeySwatchTests {
    @Test func matchesTheWebsRestingGroundsInLightMode() {
        let web = [
            "#facac8", "#b3dff6", "#ebd4af", "#d6d2fb", "#c5e1be", "#f5c9dd", "#ade3e6", "#f7ceb7", "#c2d9fd",
            "#d9dbb1", "#e8ccef", "#b4e4d2",
        ]
        for (pitch, hex) in web.enumerated() {
            let swatch = KeyColor.swatch(pitchClass: pitch, scheme: .light, chosen: false)
            #expect(matches(swatch.background, hex), "pitch \(pitch): \(swatch.background.hex) vs \(hex)")
        }
    }

    @Test(arguments: [
        (0, ColorScheme.light, false, "#facac8", "#5f3434"),
        (0, ColorScheme.light, true, "#804949", "#ffffff"),
        (0, ColorScheme.dark, false, "#5c3232", "#f9c1bf"),
        (0, ColorScheme.dark, true, "#e48686", "#2a1313"),
        (6, ColorScheme.dark, false, "#06494c", "#9edfe2"),
        (6, ColorScheme.dark, true, "#23bac1", "#002021"),
        (11, ColorScheme.light, true, "#246954", "#ffffff"),
    ])
    func matchesTheWebInEveryRole(pitch: Int, scheme: ColorScheme, chosen: Bool, background: String, ink: String) {
        let swatch = KeyColor.swatch(pitchClass: pitch, scheme: scheme, chosen: chosen)
        #expect(matches(swatch.background, background), "\(swatch.background.hex) vs \(background)")
        #expect(matches(swatch.ink, ink), "\(swatch.ink.hex) vs \(ink)")
    }

    @Test func givesBothSpellingsOfAPitchOneColor() {
        let sharp = KeyColor.swatch(pitchClass: KeyColor.pitchClass("F#")!, scheme: .light, chosen: false)
        let flat = KeyColor.swatch(pitchClass: KeyColor.pitchClass("Gb")!, scheme: .light, chosen: false)
        #expect(sharp == flat)
    }
}

@Suite struct StatusStyleTests {
    @Test func labelsAndDotsFollowTheStatus() {
        #expect(StatusStyle.label("known") == "Known")
        #expect(StatusStyle.label("learning") == "Learning")
        #expect(StatusStyle.label("want_to_learn") == "Unknown")
        #expect(StatusStyle.dot("known") == .filled(.green))
        #expect(StatusStyle.dot("learning") == .filled(.orange))
        #expect(StatusStyle.dot("want_to_learn") == .ring)
    }

    @Test func showsAnUnrecognizedStatusAsWantToLearn() {
        #expect(StatusStyle.normalized("mastered") == "want_to_learn")
        #expect(StatusStyle.label("mastered") == "Unknown")
        #expect(StatusStyle.dot("mastered") == .ring)
    }
}
