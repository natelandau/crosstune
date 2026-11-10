import SwiftUI

/// A form row that opens something other than a page pushed on the stack, such as a sheet: its
/// label, then a chevron drawn at the size and weight of the system's disclosure indicator, as
/// one button with the system's row highlight. A pushed page is a `NavigationLink`, which draws
/// the system's own. A button draws a `LabeledContent` value in the label's color, so a value
/// takes `textSecondary` itself, as a navigation row's does. On the Mac it is the opens-more row:
/// a `LabeledContent`'s label leading with its help under it, then its value and a chevron
/// trailing, as one row button.
package struct DisclosureRowButton<Label: View>: View {
    private let action: () -> Void
    private let label: Label

    package init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.action = action
        self.label = label()
    }

    package var body: some View {
        #if os(macOS)
            Button(action: action) {
                HStack(spacing: 6) {
                    label.labeledContentStyle(MacDisclosureRowContentStyle())
                    Image(systemName: "chevron.forward")
                        .font(MacStyle.rowChevron)
                        .foregroundStyle(Palette.textSecondary)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.macRow)
        #else
            phoneBody
        #endif
    }

    private var phoneBody: some View {
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

#if os(macOS)
    /// The opens-more row's label and value: the value trails, just before the chevron.
    private struct MacDisclosureRowContentStyle: LabeledContentStyle {
        func makeBody(configuration: Configuration) -> some View {
            MacFormRow(placement: .trailing) {
                configuration.content
                    .font(MacStyle.body)
                    .monospacedDigit()
                    .lineLimit(1)
                    .truncationMode(.middle)
            } label: {
                configuration.label
            }
        }
    }
#endif

#Preview("Disclosure row") {
    Form {
        DisclosureRowButton(action: {}) {
            LabeledContent("Apple Music") { Text("Connected").foregroundStyle(Palette.textSecondary) }
        }
    }
}
