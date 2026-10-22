#if os(macOS)
    import SwiftUI

    /// A Mac text field: flat on its container's control fill, no border, with the accent focus ring. A
    /// field under a heading that names it hides its own label with `.labelsHidden()`.
    // SwiftUI builds the body on the main actor, though the requirement does not say so.
    @MainActor struct MacFieldStyle: @preconcurrency TextFieldStyle {
        nonisolated static let radius: CGFloat = 7
        nonisolated static let height: CGFloat = 28
        nonisolated static let horizontalInset: CGFloat = 8
        nonisolated static let focusRingWidth: CGFloat = 2

        /// The full accent: a partial one falls under 3:1 on the field fill.
        nonisolated static let focusRingToken = MacPalette.Token.accent

        nonisolated static func focusRingRGB(_ scheme: ColorScheme) -> KeyColor.RGB {
            KeyColor.RGB(hex: MacPalette.hex(focusRingToken, scheme))
        }

        /// A glyph inside the field's leading padding that says what the field takes, such as a
        /// link.
        var leadingSymbol: String?

        func _body(configuration: TextField<_Label>) -> some View {
            MacFieldBody(field: configuration, leadingSymbol: leadingSymbol)
        }
    }

    extension TextFieldStyle where Self == MacFieldStyle {
        static var macField: Self { MacFieldStyle() }

        static func macField(leadingSymbol: String) -> Self { MacFieldStyle(leadingSymbol: leadingSymbol) }
    }

    private struct MacFieldBody<Field: View>: View {
        let field: Field
        let leadingSymbol: String?

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme
        @FocusState private var focused: Bool

        var body: some View {
            HStack(spacing: 6) {
                if let leadingSymbol {
                    Image(systemName: leadingSymbol)
                        .font(.system(size: 12))
                        .foregroundStyle(MacPalette.inkSecondary)
                        .accessibilityHidden(true)
                }
                field
                    // Outside a grouped form the field would draw AppKit's bezel inside the fill.
                    .textFieldStyle(.plain)
                    .font(MacStyle.body)
                    .multilineTextAlignment(.leading)
                    .focused($focused)
                    .focusEffectDisabled()
            }
            .padding(.horizontal, MacFieldStyle.horizontalInset)
            .padding(.vertical, 5)
            .frame(minHeight: MacFieldStyle.height)
            .background(container.controlColor, in: .rect(cornerRadius: MacFieldStyle.radius))
            .macControlEdge(container, scheme: scheme, cornerRadius: MacFieldStyle.radius)
            .macFocusRing(focused, cornerRadius: MacFieldStyle.radius)
        }
    }

    /// Multiline text on the field fill, with the field's ring and an inset that keeps the text
    /// off the fill's edge.
    struct MacTextEditorBackground: ViewModifier {
        /// TextEditor pads each line by its own 5pt line fragment, so the sides take less.
        static let verticalInset: CGFloat = 9
        static let horizontalInset: CGFloat = 4
        static let lineHeight: CGFloat = 16

        let minLines: Int
        let maxLines: Int?

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            content
                .font(MacStyle.body)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .focusEffectDisabled()
                .padding(.vertical, Self.verticalInset)
                .padding(.horizontal, Self.horizontalInset)
                .frame(minHeight: Self.height(lines: minLines), maxHeight: maxLines.map(Self.height(lines:)))
                .background(container.controlColor, in: .rect(cornerRadius: MacFieldStyle.radius))
                .macControlEdge(container, scheme: scheme, cornerRadius: MacFieldStyle.radius)
                .macFocusRing(focused, cornerRadius: MacFieldStyle.radius)
        }

        static func height(lines: Int) -> CGFloat {
            CGFloat(lines) * lineHeight + 2 * verticalInset
        }
    }

    extension View {
        /// Draws a `TextEditor` as a Mac multiline field, `minLines` tall and growing to
        /// `maxLines`, or without a cap when that is nil.
        func macTextEditor(minLines: Int, maxLines: Int? = nil) -> some View {
            modifier(MacTextEditorBackground(minLines: minLines, maxLines: maxLines))
        }

        /// The Mac focus ring for a control that draws its own shape and turns the system's off
        /// with `.focusEffectDisabled()`.
        func macFocusRing(_ isFocused: Bool, cornerRadius: CGFloat) -> some View {
            overlay {
                if isFocused {
                    RoundedRectangle(cornerRadius: cornerRadius + MacFieldStyle.focusRingWidth)
                        .strokeBorder(
                            MacPalette.color(MacFieldStyle.focusRingToken), lineWidth: MacFieldStyle.focusRingWidth
                        )
                        .padding(-MacFieldStyle.focusRingWidth)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    /// A Mac pop-up: its value in secondary ink with a small chevron, the accent once it narrows
    /// a list. It is a menu, so the keyboard and VoiceOver reach it as they do a system pop-up.
    /// It lays out as a labeled row; `.labelsHidden()` leaves the value alone where a heading
    /// already names it.
    struct MacPopUp<Value: Hashable>: View {
        private let title: String
        @Binding private var selection: Value
        private let options: [Value]
        private let label: (Value) -> String
        private let isSet: Bool
        private let reportsRepicks: Bool

        /// - Parameter reportsRepicks: Writes `selection` even when the choice already shown is
        ///   picked again, for a field where picking is itself the musician's decision.
        init(
            _ title: String, selection: Binding<Value>, options: [Value], label: @escaping (Value) -> String,
            isSet: Bool = false, reportsRepicks: Bool = false
        ) {
            self.title = title
            _selection = selection
            self.options = options
            self.label = label
            self.isSet = isSet
            self.reportsRepicks = reportsRepicks
        }

        var body: some View {
            MacPullDown(title, value: label(selection), isSet: isSet) {
                ForEach(options, id: \.self) { option in
                    // A toggle draws the menu's own checkmark; picking the checked one turns it
                    // off, which here means picking it again.
                    Toggle(
                        label(option),
                        isOn: Binding {
                            selection == option
                        } set: { _ in
                            if reportsRepicks || option != selection { selection = option }
                        })
                }
            }
        }
    }

    /// ``MacPopUp``'s look over menu items of the caller's own, for a row whose choices act
    /// rather than pick a value, such as a bulk edit's Clear or Keep.
    struct MacPullDown<Items: View>: View {
        private let title: String
        private let value: String
        private let isSet: Bool
        private let items: Items

        @Environment(\.macFormValues) private var formValues

        init(_ title: String, value: String, isSet: Bool = false, @ViewBuilder items: () -> Items) {
            self.title = title
            self.value = value
            self.isSet = isSet
            self.items = items()
        }

        var body: some View {
            LabeledContent {
                Menu {
                    items
                } label: {
                    Text(value)
                }
                .menuStyle(.button)
                .buttonStyle(MacPopUpStyle(isSet: isSet))
                .menuIndicator(.hidden)
                // A long value truncates rather than pushing the row's label aside.
                .frame(maxWidth: MacPopUpStyle.maxWidth, alignment: formValues == .leading ? .leading : .trailing)
                .accessibilityLabel(title)
                .accessibilityValue(value)
            } label: {
                Text(title)
            }
        }
    }

    /// The pop-up's button: borderless, the container's control fill on hover, the system ring on focus.
    struct MacPopUpStyle: ButtonStyle {
        static let height: CGFloat = MacStyle.smallControlHeight
        static let radius: CGFloat = 6
        static let maxWidth: CGFloat = 240

        var isSet = false

        static func valueRGB(isSet: Bool, scheme: ColorScheme) -> KeyColor.RGB {
            KeyColor.RGB(hex: MacPalette.hex(isSet ? .accent : .inkSecondary, scheme))
        }

        func makeBody(configuration: Configuration) -> some View {
            MacPopUpBody(configuration: configuration, isSet: isSet)
        }
    }

    private struct MacPopUpBody: View {
        let configuration: ButtonStyle.Configuration
        let isSet: Bool

        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macContainer) private var container
        @State private var isHovered = false

        var body: some View {
            HStack(spacing: 4) {
                configuration.label
                    .font(MacStyle.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(MacPopUpStyle.valueRGB(isSet: isSet, scheme: scheme).color)
            // A field's inset, so a value in a pop-up starts where a field's text does.
            .padding(.horizontal, MacFieldStyle.horizontalInset)
            .frame(height: MacPopUpStyle.height)
            .background(
                isHovered && isEnabled || configuration.isPressed ? container.controlColor : .clear,
                in: .rect(cornerRadius: MacPopUpStyle.radius)
            )
            .contentShape(.rect(cornerRadius: MacPopUpStyle.radius))
            .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
            .onHover { isHovered = $0 }
        }
    }
#endif
