import SwiftUI

/// One section of a document page: a plain heading with its controls trailing, then the
/// content, with no card around either. `maxWidth` caps heading and content together, so the
/// heading's controls sit over the content's trailing edge rather than across a wide page.
/// Given `expanded`, the heading is a disclosure that opens and closes the section; the caller
/// shows its content only while open.
struct PageSection<Content: View, Accessory: View>: View {
    let title: String
    let maxWidth: CGFloat
    let expanded: Binding<Bool>?
    let accessory: Accessory
    let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ title: String, maxWidth: CGFloat = .infinity, expanded: Binding<Bool>? = nil,
        @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.maxWidth = maxWidth
        self.expanded = expanded
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PageStyle.headingGap) {
            HStack(spacing: 8) {
                if let expanded {
                    disclosure(expanded)
                } else {
                    heading
                }
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

    private var heading: some View {
        Text(title)
            .font(PageStyle.sectionHeading)
            .accessibilityAddTraits(.isHeader)
    }

    private func disclosure(_ expanded: Binding<Bool>) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .default) { expanded.wrappedValue.toggle() }
        } label: {
            HStack(spacing: 6) {
                heading
                Image(systemName: "chevron.right")
                    .font(PageStyle.secondary.weight(.semibold))
                    .foregroundStyle(.inkSecondary)
                    .rotationEffect(.degrees(expanded.wrappedValue ? 90 : 0))
                    .accessibilityHidden(true)
            }
            .frame(minHeight: PageControlStyle.height)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // The button merges its label, which drops the heading's own trait.
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(expanded.wrappedValue ? FactCopy.expanded : FactCopy.collapsed)
    }
}

extension PageSection where Accessory == EmptyView {
    init(_ title: String, maxWidth: CGFloat = .infinity, @ViewBuilder content: () -> Content) {
        self.init(title, maxWidth: maxWidth, accessory: { EmptyView() }, content: content)
    }
}
