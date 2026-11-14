import SwiftUI

/// A picker row's glyph on iPhone and iPad: a + in a ring for a choice a press adds, a check in
/// a filled circle for one already added. A row's add glyph is always this, so a change to it is
/// one edit. The Mac draws ``MacPickGlyph``.
package struct PickGlyph: View {
    private let isAdded: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    package init(isAdded: Bool = false) {
        self.isAdded = isAdded
    }

    package var body: some View {
        Image(systemName: isAdded ? "checkmark.circle.fill" : "plus.circle")
            .font(.platform(.title2))
            // The filled check draws its check and circle in the accent fill pair, as the filled
            // state does everywhere else.
            .symbolRenderingMode(isAdded ? .palette : .monochrome)
            .foregroundStyle(
                isAdded ? Palette.onAccentFill : Palette.accent, isAdded ? Palette.accentFill : Palette.accent
            )
            // Magic Replace keeps the circle and morphs the + into the check.
            .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace.magic(fallback: .replace)))
            // A content transition plays only inside an animated change.
            .phoneAnimation(.default, reduced: nil, value: isAdded)
            .accessibilityHidden(true)
    }
}
