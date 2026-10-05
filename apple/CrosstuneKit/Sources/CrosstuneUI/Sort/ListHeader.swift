import SwiftUI

/// The line above a list that says how many rows it holds and, at its trailing edge, how they are
/// ordered. It is a row of the list, so it scrolls with the rows it describes and the order reads
/// as a fact about them rather than a screen-wide setting.
struct ListHeader<Sort: SortKind>: View {
    let count: String
    /// Nil while there is nothing to reorder, such as during selection.
    var choice: Binding<SortChoice<Sort>>?

    var body: some View {
        // At the largest text sizes the two no longer share a line, and the sort drops below.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                countText
                Spacer(minLength: 8)
                sort
            }
            VStack(alignment: .leading, spacing: 4) {
                countText
                sort
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
    }

    private var countText: some View {
        Text(count)
            .font(.footnote)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    @ViewBuilder private var sort: some View {
        if let choice { SortMenu(choice: choice) }
    }
}
