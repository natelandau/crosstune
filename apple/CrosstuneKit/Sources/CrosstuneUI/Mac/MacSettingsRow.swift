import CrosstuneDesign

#if os(macOS)
    import SwiftUI

    /// One row of a Settings tab, inside a ``MacFormSection`` card: the setting's name leading,
    /// its help as a second line in secondary text under the name, and its control trailing at
    /// its own size. A thin layer over ``MacFormRow``.
    struct MacSettingsRow<Control: View>: View {
        /// A free-text field's width, so a row's field never runs the card's width.
        static var fieldWidth: CGFloat { 200 }

        private let title: String
        private let help: AttributedString?
        private let control: Control

        init(_ title: String, help: String? = nil, @ViewBuilder control: () -> Control) {
            self.init(title, attributedHelp: help.map { AttributedString($0) }, control: control)
        }

        /// Help that carries its own runs, such as a link that follows the sentence.
        init(_ title: String, attributedHelp: AttributedString?, @ViewBuilder control: () -> Control) {
            self.title = title
            help = attributedHelp
            self.control = control()
        }

        var body: some View {
            MacFormRow(placement: .trailing) {
                control
                    // The row names the setting, so a pop-up or field draws only its value.
                    .labeledContentStyle(MacControlOnlyStyle())
                    .fixedSize()
            } label: {
                Text(title)
                if let help {
                    Text(help)
                }
            }
            // Air around a name with help under it, so two-line rows do not crowd the hairlines.
            .padding(.vertical, help == nil ? 0 : 4)
        }
    }

    /// A row's value that only reads, in secondary text.
    struct MacSettingsValue: View {
        private let text: String

        init(_ text: String) {
            self.text = text
        }

        var body: some View {
            Text(text)
                .font(MacStyle.body)
                .foregroundStyle(Palette.textSecondary)
                .monospacedDigit()
                .lineLimit(1)
        }
    }

    /// A Settings switch: the system switch at the small size, its label hidden for the row's.
    struct MacSettingsSwitch: View {
        private let title: String
        @Binding private var isOn: Bool

        init(_ title: String, isOn: Binding<Bool>) {
            self.title = title
            _isOn = isOn
        }

        var body: some View {
            Toggle(title, isOn: $isOn)
                .macSwitch(isOn: isOn)
        }
    }

    /// A row's trailing button, such as Sign out or Import…, at the size of a control at a row's
    /// end, in a ``MacButtonStyle`` role.
    struct MacSettingsButton: View {
        private let title: String
        private let role: MacButtonStyle.Role
        private let action: () -> Void

        init(_ title: String, role: MacButtonStyle.Role = .secondary, action: @escaping () -> Void) {
            self.title = title
            self.role = role
            self.action = action
        }

        var body: some View {
            Button(title, action: action)
                .buttonStyle(.mac(role, size: .small))
        }
    }

    /// A Settings row that opens more, such as the plan or the stats: the library's opens-more row
    /// with an optional value.
    struct MacSettingsLinkRow<Label: View>: View {
        private let value: String?
        private let hint: String?
        private let action: () -> Void
        private let label: Label

        init(value: String?, hint: String? = nil, action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
            self.value = value
            self.hint = hint
            self.action = action
            self.label = label()
        }

        var body: some View {
            DisclosureRowButton(action: action) {
                LabeledContent {
                    if let value, !value.isEmpty {
                        Text(value).foregroundStyle(Palette.textSecondary)
                    }
                } label: {
                    label
                }
            }
            .accessibilityHint(hint ?? "", isEnabled: hint != nil)
        }
    }

    extension MacSettingsLinkRow where Label == Text {
        init(_ title: String, value: String?, hint: String? = nil, action: @escaping () -> Void) {
            self.init(value: value, hint: hint, action: action) { Text(title) }
        }
    }
#endif
