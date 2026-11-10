#if os(macOS)
    import SwiftUI

    /// A picker row's leading glyph: + for a choice that adds, an accent check for one already
    /// made, or an empty slot of the same width.
    package struct MacPickGlyph: View {
        package enum Kind {
            case add
            /// A + that shows only while its row is under the pointer or focused, for a list
            /// where every row adds, so a column of them never shows at rest.
            case addOnHighlight
            case done
            case none
        }

        package static let width: CGFloat = 18

        package let kind: Kind

        package init(kind: Kind) {
            self.kind = kind
        }

        @Environment(\.macRowHighlighted) private var highlighted

        package nonisolated static func shows(_ kind: Kind, highlighted: Bool) -> Bool {
            kind != .addOnHighlight || highlighted
        }

        package var body: some View {
            Group {
                switch kind {
                case .add, .addOnHighlight:
                    Image(systemName: "plus")
                        .foregroundStyle(Palette.textSecondary)
                        .opacity(Self.shows(kind, highlighted: highlighted) ? 1 : 0)
                case .done:
                    Image(systemName: "checkmark")
                        .foregroundStyle(Palette.accent)
                case .none:
                    Color.clear
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .frame(width: Self.width)
            .accessibilityHidden(true)
        }
    }
#endif
