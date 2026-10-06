import CrosstuneCommands
import CrosstuneVocabulary
import SwiftUI

/// The catalog's tunes split by learning status in the status colors, each segment as wide as
/// its share. A status with no tunes has no segment.
struct StatusBar: View {
    let counts: [String: Int]

    private static let height: CGFloat = 8
    private static let gap: CGFloat = 2

    var body: some View {
        GeometryReader { proxy in
            let shown = Self.segments(counts)
            let total = Double(shown.reduce(0) { $0 + $1.count })
            let room = max(0, proxy.size.width - Self.gap * Double(max(0, shown.count - 1)))
            HStack(spacing: Self.gap) {
                ForEach(shown, id: \.status) { segment in
                    Capsule()
                        .fill(Self.color(segment.status))
                        .frame(width: room * Double(segment.count) / total)
                }
            }
        }
        .frame(height: Self.height)
        .accessibilityElement()
        .accessibilityLabel(Self.accessibilityText(counts))
    }

    /// The stats' tunes by status, keyed as the bar reads them.
    nonisolated static func byStatus(_ counts: Stats.Counts) -> [String: Int] {
        ["known": counts.known, "learning": counts.learning, "want_to_learn": counts.wantToLearn]
    }

    /// The statuses with tunes, in the vocabulary's order.
    static func segments(_ counts: [String: Int]) -> [(status: String, count: Int)] {
        Vocabulary.statuses.compactMap { status in
            let count = counts[status] ?? 0
            return count > 0 ? (status, count) : nil
        }
    }

    /// Every status and its count, as `Known 4, Learning 2, Unknown 9`.
    static func accessibilityText(_ counts: [String: Int]) -> String {
        Vocabulary.statuses.map { "\(StatusStyle.label($0)) \(counts[$0] ?? 0)" }.joined(separator: ", ")
    }

    /// Want to learn has a ring rather than a color in rows, so its segment is a neutral gray.
    private static func color(_ status: String) -> Color {
        switch StatusStyle.dot(status) {
        case .filled(let color): color
        case .ring: .secondary.opacity(0.4)
        }
    }
}
