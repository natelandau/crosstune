import CrosstuneAnalytics
import SwiftUI

/// A set filter as a filled capsule named for its value, which removes the filter when pressed.
package struct RemoveFilterCapsule: View {
    package nonisolated static let removeFilter = "Remove filter"

    /// The capsule's spoken name: "Remove filter Old-time".
    package nonisolated static func name(_ label: String) -> String {
        "\(removeFilter) \(label)"
    }

    /// How a token arrives: sliding in from the row's leading edge, fading as it does.
    package static let insertion = AnyTransition.move(edge: .leading).combined(with: .opacity)

    package let label: String
    package let action: () -> Void

    package init(label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    @Environment(\.spacing) private var spacing
    @Environment(\.colorScheme) private var colorScheme
    #if os(iOS)
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #endif

    package var body: some View {
        Button(action: action) {
            #if os(macOS)
                // A token in the filter row, worn as a set filter control is.
                HStack(spacing: 4) {
                    Text(label)
                        .contentMask()
                        .lineLimit(1)
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
                .macChip(state: .set, size: .standalone)
            #else
                HStack(spacing: spacing(6)) {
                    // A long label wraps at the accessibility sizes rather than truncating.
                    Text(label)
                        .contentMask()
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                }
                .font(.subheadline)
                .foregroundStyle(Palette.onTint(colorScheme))
                .padding(.horizontal, spacing(12))
                .padding(.vertical, spacing.chipVertical)
                .background(Palette.tint(colorScheme), in: .capsule)
                .tapTarget()
            #endif
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.name(label))
    }
}
