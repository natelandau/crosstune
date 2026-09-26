import SwiftUI

/// The row under the search results that adds the typed title as a tune.
struct SearchOfferRow: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "plus")
                .foregroundStyle(.tint)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
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
                .foregroundStyle(.secondary)
            Button {
                onOpen(match.entry.tune.id)
            } label: {
                // A 44 point target that does not grow the line: it reaches into the space around.
                Text(SearchOutcome.open)
                    .padding(12)
                    .contentShape(.rect)
                    .padding(-12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityLabel(match.openName)
        }
        .font(.footnote)
    }
}
