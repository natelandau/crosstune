import SwiftUI

/// A settings row whose value changes somewhere else: its title and value, with a chevron, as
/// one button.
struct SettingsFieldRow: View {
    let title: String
    let value: String
    var hint: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                LabeledContent(title, value: value)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(hint ?? "")
    }
}
