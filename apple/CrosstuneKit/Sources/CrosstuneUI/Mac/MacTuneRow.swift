import CrosstuneDesign

#if os(macOS)
    import CrosstuneAnalytics
    import SwiftUI

    /// The Mac tune row on one line: position in a list, status glyph, title, tunings, then the
    /// key pill at the trailing edge, so the keys down a column line up.
    public struct MacTuneRow: View {
        private let text: TuneRowText
        private let position: Int?
        private let showsKey: Bool

        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.macRowSelected) private var rowSelected

        /// `showsKey` false leaves the key to a list that draws it in a trailing slot of its own.
        public init(text: TuneRowText, position: Int?, showsKey: Bool = true) {
            self.text = text
            self.position = position
            self.showsKey = showsKey
        }

        /// The tunings' and position's text color: secondary at rest, white on a key window's
        /// selection, and primary on a selection that is not emphasized.
        nonisolated static func detailColor(emphasized: Bool, rowSelected: Bool = false) -> Palette.Token {
            SecondaryText.token(emphasized: emphasized, rowSelected: rowSelected)
        }

        /// One way the tunings may read: some of them, and how many more are set past them.
        struct TuningLine: Hashable {
            let text: String
            let more: Int

            var count: String? { more > 0 ? "+\(more)" : nil }
            var label: String { count.map { "\(text) \($0)" } ?? text }
        }

        /// What the tunings may read, longest first: all of them, then whole tunings dropped from
        /// the end with a quiet count of the rest. The last one truncates if even it does not fit,
        /// keeping its count, so a tuning is never cut while a shorter whole line would do.
        nonisolated static func tuningCandidates(_ parts: [String]) -> [TuningLine] {
            guard !parts.isEmpty else { return [] }
            return (1...parts.count).reversed().map {
                TuningLine(text: parts.prefix($0).joined(separator: " · "), more: parts.count - $0)
            }
        }

        private var detailColor: Color {
            Palette.color(Self.detailColor(emphasized: prominence == .increased, rowSelected: rowSelected))
        }

        public var body: some View {
            HStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let position {
                        // As wide as three digits, so titles start in one column down a list.
                        Text(position, format: .number)
                            .font(MacStyle.secondary)
                            .monospacedDigit()
                            .foregroundStyle(detailColor)
                            .frame(minWidth: Self.positionWidth, alignment: .trailing)
                    }
                    StatusGlyph(text.status)
                    Text(text.title)
                        .contentMask()
                        .font(MacStyle.body)
                        .lineLimit(1)
                        .layoutPriority(1)
                    details
                }
                Spacer(minLength: 0)
                if showsKey, let key = text.key {
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
                let candidates = Self.tuningCandidates(text.tuningParts)
                if let shortest = candidates.last {
                    // The tunings give way to the title: whole tunings drop first, then the last
                    // one truncates, and they drop out rather than shrink to a lone ellipsis.
                    ViewThatFits(in: .horizontal) {
                        ForEach(candidates.dropLast(), id: \.self) { line in
                            Text(line.label).fixedSize()
                        }
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(shortest.text)
                                .lineLimit(1)
                            if let count = shortest.count {
                                Text(count).fixedSize()
                            }
                        }
                        .frame(
                            minWidth: Self.minTuningsWidth, idealWidth: Self.minTuningsWidth,
                            alignment: .leading)
                        Color.clear.frame(width: 0, height: 0)
                    }
                    .monospacedDigit()
                }
                if text.isArchived {
                    Text(TuneRowText.archived)
                        .fixedSize()
                }
            }
            .font(MacStyle.secondary)
            .foregroundStyle(detailColor)
        }

        /// Three tabular digits at the secondary size.
        private static let positionWidth: CGFloat = 21

        /// Room for a tuning's name to read before it truncates.
        private static let minTuningsWidth: CGFloat = 56
    }

    /// A row's leading checkbox while its column is selecting: on for a selected tune, and a
    /// click adds or takes out that tune alone, as a click on the row would not.
    struct MacSelectionCheckbox: View {
        let title: String
        @Binding var isOn: Bool

        var body: some View {
            Toggle(isOn: $isOn) {
                Text(title).contentMask()
            }
            .toggleStyle(.macCheckbox)
            .labelsHidden()
        }
    }

    extension View {
        /// Leads this row with its selection checkbox while `isSelecting`. The row stays in one
        /// stack either way, so entering selection keeps its state.
        func selectionCheckbox(_ isSelecting: Bool, title: String, isOn: Binding<Bool>) -> some View {
            HStack(spacing: 8) {
                if isSelecting { MacSelectionCheckbox(title: title, isOn: isOn) }
                self
            }
        }
    }
#endif
