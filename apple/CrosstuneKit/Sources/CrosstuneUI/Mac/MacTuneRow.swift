#if os(macOS)
    import SwiftUI

    /// The Mac tune row on one line: position in a list, status glyph, title, tunings, then the
    /// key pill at the trailing edge, so the keys down a column line up.
    public struct MacTuneRow: View {
        private let text: TuneRowText
        private let position: Int?

        public init(text: TuneRowText, position: Int?) {
            self.text = text
            self.position = position
        }

        public var body: some View {
            HStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let position {
                        // As wide as three digits, so titles start in one column down a list.
                        Text(position, format: .number)
                            .font(MacStyle.secondary)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(minWidth: Self.positionWidth, alignment: .trailing)
                    }
                    StatusGlyph(text.status)
                    Text(text.title)
                        .font(MacStyle.body)
                        .lineLimit(1)
                        .layoutPriority(1)
                    details
                }
                Spacer(minLength: 0)
                if let key = text.key {
                    KeyPill(key.key, suffix: key.suffix, size: .compact)
                        .fixedSize()
                }
            }
            .frame(minHeight: MacStyle.rowHeight)
            .opacity(text.isArchived ? 0.6 : 1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text.accessibilityLabel(position: position))
        }

        private var details: some View {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let tunings = text.tunings {
                    // The tunings give way to the title, truncating, and drop out rather than
                    // shrink to a lone ellipsis.
                    ViewThatFits(in: .horizontal) {
                        Text(tunings)
                            .monospacedDigit()
                            .lineLimit(1)
                            .frame(
                                minWidth: Self.minTuningsWidth, idealWidth: Self.minTuningsWidth,
                                alignment: .leading)
                        Color.clear.frame(width: 0, height: 0)
                    }
                }
                if text.isArchived {
                    Text(TuneRowText.archived)
                        .fixedSize()
                }
            }
            .font(MacStyle.secondary)
            .foregroundStyle(.secondary)
        }

        /// Three tabular digits at the secondary size.
        private static let positionWidth: CGFloat = 21

        /// Room for a tuning's name to read before it truncates.
        private static let minTuningsWidth: CGFloat = 56
    }
#endif
