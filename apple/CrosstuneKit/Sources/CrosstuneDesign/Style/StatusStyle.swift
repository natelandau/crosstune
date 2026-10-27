import CrosstuneVocabulary
import SwiftUI

/// How a tune's learning status looks: its label, and a filled dot or a hollow ring beside it.
public enum StatusStyle {
    /// How a status's dot is drawn.
    public enum Dot: Equatable, Sendable {
        case filled(Color)
        case ring
    }

    /// The status a tune shows. A value this build does not know shows as want to learn.
    public static func normalized(_ status: String) -> String {
        Vocabulary.statusLabels[status] == nil ? "want_to_learn" : status
    }

    /// "Known", "Learning", or "Unknown".
    public static func label(_ status: String) -> String {
        Vocabulary.statusLabels[normalized(status)]!
    }

    /// Known and learning are filled dots in their status colors, want to learn a hollow ring.
    public static func dot(_ status: String) -> Dot {
        switch normalized(status) {
        case "known": .filled(Palette.statusKnown)
        case "learning": .filled(Palette.statusLearning)
        default: .ring
        }
    }
}
