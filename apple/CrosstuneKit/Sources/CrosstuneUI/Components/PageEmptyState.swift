import SwiftUI

/// What an empty section shows in place of its rows: the empty-list glyph, title, and hint,
/// scaled to sit under a section heading. The title is not a header, since the section's own
/// heading names it.
struct PageEmptyState: View {
    let title: String
    let hint: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)
            Text(title)
                .font(PageStyle.body.weight(.semibold))
            Text(hint)
                .font(PageStyle.secondary)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .accessibilityElement(children: .combine)
    }
}
