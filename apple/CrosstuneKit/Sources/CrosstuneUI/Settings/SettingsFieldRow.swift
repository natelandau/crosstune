import CrosstuneDesign
import SwiftUI

/// A settings row whose value changes somewhere else: its title and value, with a disclosure
/// chevron, as one button.
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
