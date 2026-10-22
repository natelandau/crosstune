import SwiftUI

/// A section heading's control: a glyph, or a word such as Edit. The Mac draws its icon role;
/// elsewhere it is plain in the tint.
struct PageControlStyle: ButtonStyle {
    static let height = PageStyle.headingControlHeight

    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            MacButtonStyle(.icon, size: .small).makeBody(configuration: configuration)
        #else
            PageControlBody(configuration: configuration)
        #endif
    }
}

#if !os(macOS)
    private struct PageControlBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(PageStyle.secondary.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                .padding(.horizontal, 6)
                .frame(minWidth: PageControlStyle.height, minHeight: PageControlStyle.height)
                .contentShape(.rect)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
#endif
