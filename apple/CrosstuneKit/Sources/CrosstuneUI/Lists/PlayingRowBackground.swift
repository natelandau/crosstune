import CrosstuneDesign
import SwiftUI

extension View {
    /// A list row's background: the light tint on the row a playing list is on. Otherwise, on
    /// iOS, clear, so the page shows through, unless the list selects the row, which keeps the
    /// system's selection fill.
    func playingRowBackground(isPlaying: Bool, isSelected: Bool = false) -> some View {
        #if os(macOS)
            listRowBackground(isPlaying ? PlayingRowTint() : nil)
        #else
            listRowBackground(isSelected && !isPlaying ? nil : PlayingRowTint(isPlaying: isPlaying))
        #endif
    }
}

#if os(macOS)
    /// The playing row's tint, inset and rounded as the selection is, so the two read as one family.
    private struct PlayingRowTint: View {
        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            RoundedRectangle(cornerRadius: 6)
                .fill(Palette.tintSubtle(colorScheme))
                .padding(.horizontal, MacStyle.selectionInset)
        }
    }
#else
    /// The playing row's tint, or clear for any other row.
    private struct PlayingRowTint: View {
        let isPlaying: Bool

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            if isPlaying { Palette.tintSubtle(colorScheme) } else { Color.clear }
        }
    }
#endif
