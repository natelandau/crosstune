import SwiftUI

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
