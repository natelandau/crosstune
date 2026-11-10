import SwiftUI

/// A label that never acts: a 22pt capsule with a caption semibold title. It takes no target,
/// hover, or focus. On the Mac it is a rounded rectangle at the badge's own height.
package struct Badge: View {
    package enum Kind: Equatable {
        case neutral
        case brand
    }

    package static let height: CGFloat = 22

    private let text: String
    private let kind: Kind

    @ScaledMetric(relativeTo: .caption) private var minHeight = Self.height

    package init(_ text: String, kind: Kind = .neutral) {
        self.text = text
        self.kind = kind
    }

    package var body: some View {
        #if os(macOS)
            Text(text)
                .contentMask()
                .font(MacStyle.secondary.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .foregroundStyle(kind == .brand ? Palette.onBrand : Palette.textSecondary)
                .padding(.horizontal, 6)
                .frame(height: MacStyle.badgeHeight)
                .background(
                    kind == .brand ? Palette.brand : Palette.field, in: .rect(cornerRadius: MacControl.innerRadius)
                )
                .fixedSize()
        #else
            phoneBadge
        #endif
    }

    private var phoneBadge: some View {
        Text(text)
            .contentMask()
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(minHeight: minHeight)
            .foregroundStyle(kind == .brand ? Palette.onBrand : Palette.textSecondary)
            .background(kind == .brand ? Palette.brand : Palette.field, in: .capsule)
    }
}

#Preview("Badges") {
    HStack {
        Badge("Archived")
        Badge("Save 17%", kind: .brand)
    }
    .padding()
}
