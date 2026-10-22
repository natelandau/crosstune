import SwiftUI

/// What an empty section shows in place of its rows. The title is not a header, since the
/// section's own heading names it. On the Mac it is one quiet line at the section's text edge,
/// its glyph hung in the page's glyph column, saying what to add; the title is read aloud with it.
/// Elsewhere it is the empty-list glyph, title, and hint, scaled to sit under a section heading.
struct PageEmptyState: View {
    let title: String
    let hint: String
    let systemImage: String

    var body: some View {
        #if os(macOS)
            HangingGlyphLine {
                Image(systemName: systemImage)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.inkSecondary)
            } content: {
                Text(hint)
                    .foregroundStyle(.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title). \(hint)")
        #else
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 28))
                    .foregroundStyle(.inkSecondary)
                    .padding(.bottom, 2)
                Text(title)
                    .font(PageStyle.body.weight(.semibold))
                Text(hint)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.inkSecondary)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .accessibilityElement(children: .combine)
        #endif
    }
}
