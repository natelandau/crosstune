import SwiftUI

/// One section of a document page: a plain heading with its controls trailing, then the
/// content, with no card around either. `maxWidth` caps heading and content together, so the
/// heading's controls sit over the content's trailing edge rather than across a wide page.
struct PageSection<Content: View, Accessory: View>: View {
    let title: String
    let maxWidth: CGFloat
    let accessory: Accessory
    let content: Content

    init(
        _ title: String, maxWidth: CGFloat = .infinity, @ViewBuilder accessory: () -> Accessory,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.maxWidth = maxWidth
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PageStyle.headingGap) {
            HStack(spacing: 8) {
                Text(title)
                    .font(PageStyle.sectionHeading)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                accessory
                    .menuIndicator(.hidden)
                    .menuStyle(.button)
                    .buttonStyle(PageControlStyle())
                    .fixedSize()
            }
            // A heading keeps the same height with or without its controls, so the rhythm
            // between sections holds.
            .frame(minHeight: PageControlStyle.height)
            content
        }
        .frame(maxWidth: maxWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension PageSection where Accessory == EmptyView {
    init(_ title: String, maxWidth: CGFloat = .infinity, @ViewBuilder content: () -> Content) {
        self.init(title, maxWidth: maxWidth, accessory: { EmptyView() }, content: content)
    }
}

/// A line led by a glyph. On the Mac the glyph hangs in the page's glyph column, left of the
/// section's leading edge, so the line's text starts where every other section's text does.
struct HangingGlyphLine<Glyph: View, Content: View>: View {
    var alignment: VerticalAlignment = .firstTextBaseline
    /// Between the glyph and the text where the glyph does not hang.
    var inlineSpacing: CGFloat = 8
    @ViewBuilder let glyph: Glyph
    @ViewBuilder let content: Content

    var body: some View {
        #if os(macOS)
            HStack(alignment: alignment, spacing: MacStyle.pageGlyphGap) {
                glyph
                    .frame(width: MacStyle.pageGlyphColumn - MacStyle.pageGlyphGap)
                content
            }
            // Before the indent, so the hung glyph takes clicks too.
            .contentShape(.rect)
            .padding(.leading, -MacStyle.pageGlyphColumn)
        #else
            HStack(alignment: alignment, spacing: inlineSpacing) {
                glyph
                content
            }
        #endif
    }
}
