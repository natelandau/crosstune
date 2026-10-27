import SwiftUI

/// The height a ``SwipeRows`` list takes: each row's measured height, or `estimate` for a row
/// not measured yet, with `gap` between rows.
package enum SwipeRowsHeight {
    package nonisolated static func height(_ measured: [CGFloat?], gap: CGFloat, estimate: CGFloat) -> CGFloat {
        guard !measured.isEmpty else { return 0 }
        return measured.reduce(0) { $0 + ($1 ?? estimate) } + gap * CGFloat(measured.count - 1)
    }
}

#if !os(macOS)
    /// Rows inside a scroll view that keep their swipe actions. SwiftUI runs swipe actions only
    /// on a `List`'s rows, so the rows get a `List` of their own that never scrolls and draws no
    /// insets, separators, or row fill, so they look as they would in a stack spaced by `rowGap`.
    ///
    /// The list's height is the sum of its rows' measured heights. A `List` lays out only the
    /// rows inside its frame, and a zero-height one lays out none and reports no content size,
    /// so a row not yet measured counts at an estimate until it lays out and reports its own.
    package struct SwipeRows<Data: RandomAccessCollection, Row: View>: View where Data.Element: Identifiable {
        package let data: Data
        package let rowGap: CGFloat
        @ViewBuilder package let row: (Data.Element) -> Row

        package init(data: Data, rowGap: CGFloat, @ViewBuilder row: @escaping (Data.Element) -> Row) {
            self.data = data
            self.rowGap = rowGap
            self.row = row
        }

        @State private var heights: [Data.Element.ID: CGFloat] = [:]
        @ScaledMetric(relativeTo: .body) private var estimate: CGFloat = 60

        package var body: some View {
            List {
                ForEach(data) { item in
                    row(item)
                        .onGeometryChange(for: CGFloat.self) { proxy in
                            proxy.size.height
                        } action: { height in
                            heights[item.id] = height
                        }
                        // The gap rides on each later row's top inset, so the height sum can count it.
                        .listRowInsets(insets(item))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .contentMargins(.vertical, 0, for: .scrollContent)
            .frame(height: SwipeRowsHeight.height(data.map { heights[$0.id] }, gap: rowGap, estimate: estimate))
        }

        private func insets(_ item: Data.Element) -> EdgeInsets {
            EdgeInsets(top: item.id == data.first?.id ? 0 : rowGap, leading: 0, bottom: 0, trailing: 0)
        }
    }
#endif
