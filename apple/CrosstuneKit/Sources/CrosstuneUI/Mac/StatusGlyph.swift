#if os(macOS)
    import SwiftUI

    /// A tune's status as an SF symbol shape on the Mac.
    public struct StatusGlyph: View {
        private let status: String

        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        public init(_ status: String) {
            self.status = status
        }

        public var body: some View {
            let label = StatusStyle.label(status)

            Image(systemName: Self.symbol(for: status))
                .font(MacStyle.body)
                .foregroundStyle(Self.color(for: status))
                .help(label)
                .accessibilityLabel(label)
                .contentTransition(
                    reduceMotion ? .identity : .symbolEffect(.replace)
                )
                // A content transition plays only inside an animated change.
                .animation(reduceMotion ? nil : .default, value: StatusStyle.normalized(status))
        }

        /// The SF symbol name for a status.
        public static func symbol(for status: String) -> String {
            switch StatusStyle.normalized(status) {
            case "known":
                "checkmark.circle.fill"
            case "learning":
                "circle.lefthalf.filled"
            default:
                "circle"
            }
        }

        /// The status dot's color; the hollow ring's status is secondary.
        static func color(for status: String) -> Color {
            switch StatusStyle.dot(status) {
            case .filled(let color): color
            case .ring: .secondary
            }
        }
    }
#endif
