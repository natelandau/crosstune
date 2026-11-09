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

    package var body: some View {
        #if os(macOS)
            Button(action: action) {
                // A token in the filter row, worn as a set filter control is.
                HStack(spacing: 4) {
                    Text(label)
                        .contentMask()
                        .lineLimit(1)
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
                .macChip(state: .set, size: .standalone)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Self.name(label))
        #else
            Chip(.removable, action: action) {
                Text(label).contentMask()
            }
            .accessibilityLabel(Self.name(label))
        #endif
    }
}
