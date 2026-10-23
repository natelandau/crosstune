#if os(macOS)
    import SwiftUI

    /// One row of a Settings tab, inside a ``MacFormSection`` card: the setting's name leading,
    /// its help as a second line in secondary ink under the name, and its control trailing at
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

    /// Draws a `LabeledContent` as its content alone, for a control whose row already names it.
    /// The automatic style ignores `.labelsHidden()` outside a `Form`.
    private struct MacControlOnlyStyle: LabeledContentStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.content
        }
    }

    /// A row's value that only reads, in secondary ink.
    struct MacSettingsValue: View {
        private let text: String

        init(_ text: String) {
            self.text = text
        }

        var body: some View {
            Text(text)
                .font(MacStyle.body)
                .foregroundStyle(Palette.inkSecondary)
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

    /// A row's trailing button, such as Sign out or Import…, in a ``MacButtonStyle`` role. It
    /// draws its own ring under keyboard focus, hugging the button, never the system's.
    struct MacSettingsButton: View {
        private let title: String
        private let role: MacButtonStyle.Role
        private let action: () -> Void

        @FocusState private var focused: Bool

        init(_ title: String, role: MacButtonStyle.Role = .secondary, action: @escaping () -> Void) {
            self.title = title
            self.role = role
            self.action = action
        }

        var body: some View {
            Button(title, action: action)
                .buttonStyle(.mac(role))
                .focusEffectDisabled()
                .focused($focused)
                .macFocusRing(focused, cornerRadius: MacButtonStyle.radius)
        }
    }

    /// A row that opens more, such as the plan or the stats: the label leading, an optional value
    /// in secondary ink, and a chevron, as one button. Under keyboard focus it draws a ring inset
    /// in its card rather than the system's, which would wrap the whole card.
    struct MacSettingsLinkRow<Label: View>: View {
        private let value: String?
        private let hint: String?
        private let action: () -> Void
        private let label: Label

        @FocusState private var focused: Bool

        init(value: String?, hint: String? = nil, action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
            self.value = value
            self.hint = hint
            self.action = action
            self.label = label()
        }

        var body: some View {
            Button(action: action) {
                MacFormRow(placement: .trailing) {
                    HStack(spacing: 6) {
                        if let value, !value.isEmpty {
                            Text(value)
                                .font(MacStyle.body)
                                .foregroundStyle(Palette.inkSecondary)
                                .monospacedDigit()
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Image(systemName: "chevron.forward")
                            .font(MacStyle.rowChevron)
                            .foregroundStyle(Palette.inkSecondary)
                            .accessibilityHidden(true)
                    }
                } label: {
                    label
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .focusEffectDisabled()
            .focused($focused)
            .macSettingsRowRing(focused)
            .accessibilityHint(hint ?? "")
        }
    }

    extension MacSettingsLinkRow where Label == Text {
        init(_ title: String, value: String?, hint: String? = nil, action: @escaping () -> Void) {
            self.init(value: value, hint: hint, action: action) { Text(title) }
        }
    }

    extension View {
        /// The ring of a row that is one button, inset in its card: out to just inside the
        /// card's edges, so it reads as the row's and never as the card's.
        func macSettingsRowRing(_ isFocused: Bool) -> some View {
            overlay {
                if isFocused {
                    RoundedRectangle(cornerRadius: MacButtonStyle.radius)
                        .strokeBorder(Palette.accent, lineWidth: MacFieldStyle.focusRingWidth)
                        .padding(.horizontal, -(MacForm.rowInset - 4))
                        .padding(.vertical, -2)
                        .allowsHitTesting(false)
                }
            }
        }

        /// Opens a Settings tab with focus on an invisible stop beside its content, not its first
        /// row, so no row wears a ring until the keyboard moves to it. Only the stop turns its ring
        /// off: every control in the tab keeps the system's.
        func macSettingsOpensUnfocused() -> some View {
            modifier(MacSettingsOpensUnfocused())
        }
    }

    private struct MacSettingsOpensUnfocused: ViewModifier {
        @FocusState private var holdsFocus: Bool

        func body(content: Content) -> some View {
            content
                .background {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .focusable()
                        .focusEffectDisabled()
                        .focused($holdsFocus)
                        .accessibilityHidden(true)
                }
                .defaultFocus($holdsFocus, true)
        }
    }
#endif
