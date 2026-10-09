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

/// A section heading's control: a glyph, or a word such as Edit, in a small glass circle or
/// capsule where ``PageStyle/headingControlsUseGlass``, or plain in the tint otherwise.
struct PageControlStyle: ButtonStyle {
    static let height = PageStyle.headingControlHeight

    func makeBody(configuration: Configuration) -> some View {
        PageControlBody(configuration: configuration)
    }
}

private struct PageControlBody: View {
    let configuration: ButtonStyle.Configuration

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let glass = PageStyle.headingControlsUseGlass
        let control = configuration.label
            .font(PageStyle.secondary.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(ink(glass: glass))
            .padding(.horizontal, 6)
            .frame(minWidth: PageControlStyle.height, minHeight: PageControlStyle.height)
        Group {
            if glass {
                control
                    .contentShape(.capsule)
                    .pageGlass(in: .capsule)
            } else {
                control.contentShape(.rect)
            }
        }
        .opacity(configuration.isPressed ? 0.6 : 1)
    }

    private func ink(glass: Bool) -> AnyShapeStyle {
        if !isEnabled { return AnyShapeStyle(.tertiary) }
        return glass ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint)
    }
}

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
