import CrosstuneDesign
import SwiftUI

#if !os(macOS)
    /// A settings row whose value changes somewhere else: its title and value, with a disclosure
    /// chevron, as one button. The Mac draws ``MacSettingsLinkRow``, whose ring stays
    /// inside its card.
    struct SettingsFieldRow: View {
        let title: String
        let value: String
        var hint: String?
        let action: () -> Void

        var body: some View {
            DisclosureRowButton(action: action) {
                LabeledContent(title) {
                    Text(value).foregroundStyle(.textSecondary)
                }
            }
            .accessibilityHint(hint ?? "", isEnabled: hint != nil)
        }
    }
#endif
