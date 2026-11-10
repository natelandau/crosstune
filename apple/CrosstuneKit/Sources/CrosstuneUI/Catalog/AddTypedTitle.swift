import CrosstuneAnalytics
import CrosstuneDesign
import SwiftUI

/// The row under the search results that adds the typed title as a tune.
struct AddTypedTitleRow: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "plus")
                .contentMask()
                .foregroundStyle(Palette.accent)
                .frame(maxWidth: .infinity, minHeight: minimumTapTarget, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.labelOnly)
    }
}

/// Names an exact match that search found but a filter or the archived setting hides, with
/// the control that opens it.
struct HiddenMatchNote: View {
    let match: HiddenMatch
    let onOpen: (_ tuneID: String) -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(match.note)
                .contentMask()
                .foregroundStyle(.textSecondary)
            Button {
                onOpen(match.entry.tune.id)
            } label: {
                Text(SearchOutcome.open)
            }
            .buttonStyle(.text)
            .accessibilityLabel(match.openName)
        }
        .font(.platform(.footnote))
    }
}
