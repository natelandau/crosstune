import SwiftUI

/// A label that never acts: a 22pt capsule with a caption semibold title. It takes no target,
/// hover, or focus. On the Mac a neutral badge draws the Mac's row chip, and a brand badge a
/// small brand capsule in bold, unless `macLook` names another look.
package struct Badge: View {
    package enum Kind: Equatable {
        case neutral
        case brand
    }

    package static let height: CGFloat = 22

    private let text: String
    private let kind: Kind
    private let macLook: BadgeLineMacLook

    @ScaledMetric(relativeTo: .caption) private var minHeight = Self.height

    package init(_ text: String, kind: Kind = .neutral, macLook: BadgeLineMacLook = .byKind) {
        self.text = text
        self.kind = kind
        self.macLook = macLook
    }

    package var body: some View {
        #if os(macOS)
            switch (macLook, kind) {
            case (.secondaryText, _):
                Text(text)
                    .contentMask()
                    .monospacedDigit()
                    .macBadgeLineText()
            case (.byKind, .neutral):
                Text(text)
                    .contentMask()
                    .macChip(state: .rest, hueText: Palette.textSecondary, size: .row)
            case (.byKind, .brand):
                Text(text)
                    .contentMask()
                    .font(.platform(.caption2).weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Palette.onBrand)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Palette.brand, in: .capsule)
                    .fixedSize()
            }
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
