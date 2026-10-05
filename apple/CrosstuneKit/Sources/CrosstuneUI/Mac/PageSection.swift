#if os(macOS)
    import SwiftUI

    /// One section of a Mac document page: a plain heading with its controls trailing, then the
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
            VStack(alignment: .leading, spacing: MacStyle.headingGap) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(MacStyle.sectionHeading)
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

    /// A section heading's control: a small glass circle around a glyph, or a capsule around a
    /// word such as Edit.
    struct PageControlStyle: ButtonStyle {
        static let height = MacStyle.smallControlHeight

        func makeBody(configuration: Configuration) -> some View {
            PageControlBody(configuration: configuration)
        }
    }

    private struct PageControlBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(MacStyle.secondary.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(isEnabled ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary))
                .padding(.horizontal, 6)
                .frame(minWidth: PageControlStyle.height, minHeight: PageControlStyle.height)
                .contentShape(.capsule)
                .macGlass(in: .capsule)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }

    /// What an empty section says in place of its rows: a quiet line, and the way to fill it.
    struct PageEmptyNote: View {
        let title: String
        let hint: String

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(MacStyle.body)
                Text(hint)
                    .font(MacStyle.secondary)
            }
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
        }
    }
#endif
