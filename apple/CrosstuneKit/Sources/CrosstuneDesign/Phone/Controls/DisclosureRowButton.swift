import SwiftUI

/// A form row that opens something other than a page pushed on the stack, such as a sheet: its
/// label, then a chevron drawn at the size and weight of the system's disclosure indicator, as
/// one button with the system's row highlight. A pushed page is a `NavigationLink`, which draws
/// the system's own. A button draws a `LabeledContent` value in the label's color, so a value
/// takes `textSecondary` itself, as a navigation row's does.
package struct DisclosureRowButton<Label: View>: View {
    private let action: () -> Void
    private let label: Label

    package init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.action = action
        self.label = label()
    }

    package var body: some View {
        Button(action: action) {
            // The system's gap between a row's value and its disclosure indicator.
            HStack(spacing: 12) {
                label
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.textTertiary)
                    .accessibilityHidden(true)
            }
            // A button draws its label in the tint; a row that opens something reads as text.
            .foregroundStyle(Palette.textPrimary)
            .contentShape(.rect)
        }
        .buttonStyle(.automatic)
    }
}

#Preview("Disclosure row") {
    Form {
        DisclosureRowButton(action: {}) {
            LabeledContent("Apple Music") { Text("Connected").foregroundStyle(Palette.textSecondary) }
        }
    }
}
