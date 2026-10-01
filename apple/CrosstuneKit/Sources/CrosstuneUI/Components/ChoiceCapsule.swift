import SwiftUI

/// One choice in a rail of capsules: a neutral fill at rest, the tint when chosen, and a 44
/// point target whatever its text size, which takes no more room than the capsule.
public struct ChoiceCapsule<Label: View>: View {
    private let isChosen: Bool
    private let action: () -> Void
    private let label: Label

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing

    public init(chosen: Bool, action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        isChosen = chosen
        self.action = action
        self.label = label()
    }

    public var body: some View {
        Button(action: action) {
            label
                .font(.subheadline)
                .foregroundStyle(isChosen ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                .padding(.horizontal, spacing(14))
                .padding(.vertical, spacing.chipVertical)
                .background(isChosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
                .tapTarget()
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isChosen ? .isSelected : [])
    }
}

#Preview("Choice capsules") {
    @Previewable @State var chosen = "Reel"
    HStack(spacing: 8) {
        ForEach(["Reel", "Jig", "Waltz"], id: \.self) { type in
            ChoiceCapsule(chosen: chosen == type) {
                chosen = type
            } label: {
                Text(type)
            }
        }
    }
    .padding()
}
