import CrosstunePalette
import SwiftUI

/// A tune the shared link can be saved to, checked when chosen.
struct ShareTuneRow: View {
    let title: String
    let detail: String?
    let isChosen: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack {
                VStack(alignment: .leading) {
                    Text(title).foregroundStyle(Palette.textPrimary)
                    if let detail {
                        Text(detail).font(.subheadline).foregroundStyle(Palette.textSecondary)
                    }
                }
                Spacer()
                // The row's selected trait already says it is chosen.
                Image(systemName: "checkmark")
                    .foregroundStyle(Palette.accent)
                    .opacity(isChosen ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .accessibilityAddTraits(isChosen ? .isSelected : [])
        .listRowBackground(Palette.groupedSurface)
    }
}
