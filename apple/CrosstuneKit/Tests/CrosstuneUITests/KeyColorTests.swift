import CrosstuneDesign
import SwiftUI
import Testing

@testable import CrosstuneUI

struct PitchClassTests {
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

    /// Each fifth up takes the same step around the hue wheel, so the twelve keys get twelve hues.
    @Test func placesHuesAroundTheCircleOfFifths() {
        let fifths = (0..<12).map { KeyColor.hue(pitchClass: $0 * 7 % 12) }
        let steps = Set(zip(fifths, fifths.dropFirst()).map { $1 - $0 })
        #expect(steps.count == 1)
        #expect(Set(fifths).count == 12)
    }
}

struct KeyPillColorsTests {
    @Test(arguments: [ColorScheme.light, .dark], [false, true])
    func everyPillsTextPassesContrast(scheme: ColorScheme, chosen: Bool) {
        for pitch in 0..<12 {
            let colors = KeyColor.pillColors(pitchClass: pitch, scheme: scheme, chosen: chosen)
            #expect(contrastRatio(colors.text, colors.background) >= 4.5, "pitch \(pitch)")
        }
    }

    @Test func givesBothSpellingsOfAPitchOneColor() throws {
        let sharp = KeyColor.pillColors(
            pitchClass: try #require(KeyColor.pitchClass("F#")), scheme: .light, chosen: false)
        let flat = KeyColor.pillColors(
            pitchClass: try #require(KeyColor.pitchClass("Gb")), scheme: .light, chosen: false)
        #expect(sharp == flat)
    }
}

struct StatusStyleTests {
    @Test func labelsAndDotsFollowTheStatus() {
        #expect(StatusStyle.label("known") == "Known")
        #expect(StatusStyle.label("learning") == "Learning")
        #expect(StatusStyle.label("want_to_learn") == "Unknown")
        #expect(StatusStyle.dot("known") == .filled(Palette.statusKnown))
        #expect(StatusStyle.dot("learning") == .filled(Palette.statusLearning))
        #expect(StatusStyle.dot("want_to_learn") == .ring)
    }

    @Test func showsAnUnrecognizedStatusAsWantToLearn() {
        #expect(StatusStyle.normalized("mastered") == "want_to_learn")
        #expect(StatusStyle.label("mastered") == "Unknown")
        #expect(StatusStyle.dot("mastered") == .ring)
    }
}
