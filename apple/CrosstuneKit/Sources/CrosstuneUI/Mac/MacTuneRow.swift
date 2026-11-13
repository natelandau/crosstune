import CrosstuneDesign

#if os(macOS)
    import CrosstuneAnalytics
    import SwiftUI

    /// The Mac tune row on one line: status glyph, title, tunings, archived, and the row's note,
    /// then the key pill at the trailing edge, so the keys down a column line up. A list's
    /// `position` is only spoken.
    public struct MacTuneRow: View {
        private let text: TuneRowText
        private let position: Int?

        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.macRowSelected) private var rowSelected

        public init(text: TuneRowText, position: Int?) {
            self.text = text
            self.position = position
        }

        /// The tunings' text color: secondary at rest, white on a key window's selection,
        /// and primary on a selection that is not emphasized.
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
                    StatusGlyph(text.status)
                    Text(text.title)
                        .contentMask()
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
                if text.isArchived { wholeOrHidden(TuneRowText.archived) }
                if let note = text.note { wholeOrHidden(note) }
            }
            .font(MacStyle.secondary)
            .foregroundStyle(detailColor)
        }

        /// `detail` whole, or nothing where it does not fit, so it never squeezes the title. The
        /// row's label still says it.
        private func wholeOrHidden(_ detail: String) -> some View {
            ViewThatFits(in: .horizontal) {
                Text(detail).fixedSize()
                Color.clear.frame(width: 0, height: 0)
            }
        }

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
        /// A row while its screen selects: led by its checkbox, and a click anywhere on it does
        /// what the checkbox does, while a Shift-click selects every row from the last one
        /// clicked. The row takes the click itself: a click the list took would draw that row
        /// alone as selected for a moment. The row stays in one stack either way, so entering
        /// selection keeps its state.
        func selectionRow(_ selection: Binding<TuneSelection>, row: String, title: String) -> some View {
            modifier(SelectionRow(selection: selection, row: row, title: title))
        }
    }

    private struct SelectionRow: ViewModifier {
        @Binding var selection: TuneSelection
        let row: String
        let title: String

        @Environment(\.selectionVisibleIDs) private var visibleIDs

        func body(content: Content) -> some View {
            HStack(spacing: 8) {
                if selection.isActive {
                    MacSelectionCheckbox(title: title, isOn: $selection[isSelected: row, visible: visibleIDs])
                }
                content
            }
            // The whole row takes clicks only while selecting. Otherwise its empty space belongs to
            // what lies behind it, such as a recording row's open button.
            .background {
                if selection.isActive { Color.clear.contentShape(.rect) }
            }
            .gesture(
                TapGesture().onEnded {
                    selection.click(row, extending: NSEvent.modifierFlags.contains(.shift), visible: visibleIDs)
                },
                including: selection.isActive ? .all : .subviews
            )
        }
    }
#endif
