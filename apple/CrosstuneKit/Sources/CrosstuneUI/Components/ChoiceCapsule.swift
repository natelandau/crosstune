import SwiftUI

/// One choice in a rail of capsules: a neutral fill at rest, the tint when chosen, and a 44
/// point target whatever its text size, which takes no more room than the capsule. The Mac
/// draws it at its own text size, slate when chosen, with no touch target.
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
            #if os(macOS)
                label
                    .font(MacStyle.body)
                    .foregroundStyle(isChosen ? AnyShapeStyle(MacStyle.onAccent(colorScheme)) : AnyShapeStyle(.primary))
                    .padding(.horizontal, spacing(14))
                    .padding(.vertical, spacing.chipVertical)
                    .background(isChosen ? AnyShapeStyle(MacStyle.accent) : neutralFill(colorScheme), in: .capsule)
                    .contentShape(.capsule)
            #else
                label
                    .lineLimit(1)
                    .fixedSize()
                    .font(.subheadline)
                    .foregroundStyle(
                        isChosen ? AnyShapeStyle(BrandStyle.onAccent(colorScheme)) : AnyShapeStyle(.primary)
                    )
                    .padding(.horizontal, spacing(14))
                    .padding(.vertical, spacing.chipVertical)
                    .background(isChosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
                    .tapTarget()
            #endif
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isChosen ? .isSelected : [])
    }
}

/// A capsule's look without its button, for a chip inside a button of its own.
struct ChoiceCapsuleLabel: View {
    let text: String
    let chosen: Bool

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing

    var body: some View {
        #if os(macOS)
            Text(text)
                .font(MacStyle.body)
                .lineLimit(1)
                .foregroundStyle(chosen ? AnyShapeStyle(MacStyle.onAccent(colorScheme)) : AnyShapeStyle(.primary))
                .padding(.horizontal, spacing(14))
                .padding(.vertical, spacing.chipVertical)
                .background(chosen ? AnyShapeStyle(MacStyle.accent) : neutralFill(colorScheme), in: .capsule)
                .contentShape(.capsule)
        #else
            Text(text)
                .font(.subheadline)
                .lineLimit(1)
                .foregroundStyle(chosen ? AnyShapeStyle(BrandStyle.onAccent(colorScheme)) : AnyShapeStyle(.primary))
                .padding(.horizontal, spacing(14))
                .padding(.vertical, spacing.chipVertical)
                .background(chosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
                .tapTarget()
        #endif
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
