import SwiftUI

/// One section of a document page: a plain heading with its controls trailing, then the
/// content, with no card around either.
struct PageSection<Content: View, Accessory: View>: View {
    let title: String
    let accessory: Accessory
    let content: Content

    init(_ title: String, @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content) {
        self.title = title
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
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension PageSection where Accessory == EmptyView {
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.init(title, accessory: { EmptyView() }, content: content)
    }
}
