import SwiftUI

#if !os(macOS)
    /// A settings row whose value changes somewhere else: its title and value, with a chevron, as
    /// one button. The Mac draws ``MacSettingsLinkRow``, whose ring stays inside its card.
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
                        .font(.platform(.footnote).weight(.semibold))
                        .foregroundStyle(.textSecondary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(hint ?? "")
        }
    }
#endif
