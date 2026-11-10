#if os(macOS)
    import SwiftUI

    /// A Mac pop-up: its value on the control fill with an up-down chevron, the value in secondary
    /// text while nothing is set. It is a menu, so the keyboard and VoiceOver reach it as they do
    /// a system pop-up. It lays out as a labeled row; `.labelsHidden()` leaves the value alone
    /// where a heading already names it.
    package struct MacPopUp<Value: Hashable>: View {
        private let title: String
        @Binding private var selection: Value
        private let options: [Value]
        private let label: (Value) -> String
        private let isSet: Bool
        private let size: MacButtonStyle.Size

        /// - Parameters:
        ///   - isSet: False while the selection stands for no value, such as a filter's Any.
        package init(
            _ title: String, selection: Binding<Value>, options: [Value], label: @escaping (Value) -> String,
            isSet: Bool = true, size: MacButtonStyle.Size = .small
        ) {
            self.title = title
            _selection = selection
            self.options = options
            self.label = label
            self.isSet = isSet
            self.size = size
        }

        package var body: some View {
            MacPullDown(title, value: label(selection), isSet: isSet, size: size, kind: .value) {
                ForEach(options, id: \.self) { option in
                    // A toggle draws the menu's own checkmark; picking the checked one turns it
                    // off, which here means picking it again.
                    Toggle(
                        label(option),
                        isOn: Binding {
                            selection == option
                        } set: { _ in
                            if option != selection { selection = option }
                        })
                }
            }
        }
    }

    extension MacPopUp {
        /// A pop-up whose first choice is nil, standing for no value, which reads in secondary text.
        package init<Wrapped: Hashable>(
            _ title: String, selection: Binding<Wrapped?>, choices: [Wrapped], label: @escaping (Wrapped?) -> String,
            size: MacButtonStyle.Size = .small
        ) where Value == Wrapped? {
            self.init(
                title, selection: selection, options: [nil] + choices.map(Optional.some), label: label,
                isSet: selection.wrappedValue != nil, size: size)
        }
    }

    /// ``MacPopUp``'s look over menu items of the caller's own, for a row whose choices act
    /// rather than pick a value, such as a bulk edit's Clear or Keep. It is Small by default, the
    /// size of a control at a row's end; a standalone one is Regular.
    package struct MacPullDown<Items: View>: View {
        private let title: String
        private let value: String
        private let isSet: Bool
        private let size: MacButtonStyle.Size
        private let kind: MacPopUpStyle.Kind
        private let items: Items

        @Environment(\.macFormValues) private var formValues

        package init(
            _ title: String, value: String, isSet: Bool = true, size: MacButtonStyle.Size = .small,
            kind: MacPopUpStyle.Kind = .actions, @ViewBuilder items: () -> Items
        ) {
            self.title = title
            self.value = value
            self.isSet = isSet
            self.size = size
            self.kind = kind
            self.items = items()
        }

        package var body: some View {
            MacPopUpMenu(style: MacPopUpStyle(isSet: isSet, size: size, kind: kind)) {
                items
            } label: {
                Text(value)
            }
            // A long value truncates rather than pushing the row's label aside.
            .frame(maxWidth: MacPopUpStyle.maxWidth, alignment: formValues == .leading ? .leading : .trailing)
            .accessibilityLabel(title)
            .accessibilityValue(value)
            .modifier(MacPullDownLabel(title: title))
        }
    }

    /// The pull-down's title beside it, unless labels are hidden: the automatic LabeledContent
    /// style ignores `.labelsHidden()` outside a Form.
    private struct MacPullDownLabel: ViewModifier {
        let title: String
        @Environment(\.labelsVisibility) private var labelsVisibility

        func body(content: Content) -> some View {
            if labelsVisibility == .hidden {
                content
            } else {
                LabeledContent {
                    content
                } label: {
                    Text(title)
                }
            }
        }
    }

    /// A menu drawn as a pop-up, or an inline pop-up with ``MacInlinePopUpStyle``, with the system
    /// focus effect off so only the keyboard ring shows.
    package struct MacPopUpMenu<Style: ButtonStyle, Items: View, Label: View>: View {
        private let style: Style
        private let items: Items
        private let label: Label

        package init(style: Style, @ViewBuilder items: () -> Items, @ViewBuilder label: () -> Label) {
            self.style = style
            self.items = items()
            self.label = label()
        }

        package var body: some View {
            Menu {
                items
            } label: {
                label
            }
            .menuStyle(.button)
            .buttonStyle(style)
            .menuIndicator(.hidden)
            .focusEffectDisabled()
            .macButtonFocus()
        }
    }

    /// The pop-up's button: the value on the container's control fill, with the hover and pressed
    /// overlays and the keyboard focus ring. A menu takes only a plain style, so whoever places
    /// the menu turns the system focus effect off around it.
    package struct MacPopUpStyle: ButtonStyle {
        /// What the menu holds, which its chevron says.
        package enum Kind {
            /// One value from a closed list.
            case value
            /// Actions under a word.
            case actions

            package var chevron: String {
                switch self {
                case .value: "chevron.up.chevron.down"
                case .actions: "chevron.down"
                }
            }
        }

        package static let radius: CGFloat = MacControl.radius
        package static let maxWidth: CGFloat = 240
        package static let horizontalInset: CGFloat = MacFieldStyle.horizontalInset

        package var isSet: Bool
        package var size: MacButtonStyle.Size
        package var kind: Kind

        /// - Parameter isSet: False for an empty value, which reads in secondary text.
        package init(isSet: Bool = true, size: MacButtonStyle.Size = .regular, kind: Kind = .value) {
            self.isSet = isSet
            self.size = size
            self.kind = kind
        }

        package static func valueRGB(isSet: Bool, scheme: ColorScheme) -> KeyColor.RGB {
            Palette.rgb(isSet ? .textPrimary : .textSecondary, scheme)
        }

        package static func font(_ size: MacButtonStyle.Size) -> Font {
            size == .small ? .system(size: 12) : MacStyle.body
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacPopUpBody(configuration: configuration, style: self)
        }
    }

    private struct MacPopUpBody: View {
        let configuration: ButtonStyle.Configuration
        let style: MacPopUpStyle

        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.macPreviewFocused) private var previewFocused
        @Environment(\.macContainer) private var container
        private var pointer = MacPointer()

        var body: some View {
            HStack(spacing: 8) {
                configuration.label
                    .font(MacPopUpStyle.font(style.size))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .foregroundStyle(MacPopUpStyle.valueRGB(isSet: style.isSet, scheme: scheme).color)
                Image(systemName: style.kind.chevron)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
            }
            // A field's inset, so a value in a pop-up starts where a field's text does.
            .padding(.horizontal, MacPopUpStyle.horizontalInset)
            .frame(height: style.size.height)
            .background(container.controlColor, in: .rect(cornerRadius: MacPopUpStyle.radius))
            .overlay {
                RoundedRectangle(cornerRadius: MacPopUpStyle.radius).fill(state.overlay).allowsHitTesting(false)
            }
            .macControlEdge(container, scheme: scheme, cornerRadius: MacPopUpStyle.radius)
            .contentShape(.rect(cornerRadius: MacPopUpStyle.radius))
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macFocusRing(isFocused || previewFocused, cornerRadius: MacPopUpStyle.radius)
            .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }

    /// A list header's sort or view choice: small secondary words with a chevron, on the
    /// control fill and in primary text under the pointer. A sort's chevron turns up for an
    /// ascending order. A menu takes it through ``MacPopUpMenu``, which turns the system focus
    /// effect off.
    package struct MacInlinePopUpStyle: ButtonStyle {
        package static let height: CGFloat = MacControl.smallHeight
        package static let horizontalInset: CGFloat = 6
        package static let radius: CGFloat = MacControl.radius

        private let symbol: String

        package init(symbol: String = "chevron.down") {
            self.symbol = symbol
        }

        package static func labelToken(_ state: MacPressState) -> Palette.Token {
            state == .rest ? .textSecondary : .textPrimary
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacInlinePopUpBody(configuration: configuration, symbol: symbol)
        }
    }

    extension ButtonStyle where Self == MacInlinePopUpStyle {
        package static var macInlinePopUp: Self { MacInlinePopUpStyle() }

        /// The inline pop-up with `symbol` after its words, such as a sort's direction.
        package static func macInlinePopUp(symbol: String) -> Self { MacInlinePopUpStyle(symbol: symbol) }
    }

    private struct MacInlinePopUpBody: View {
        let configuration: ButtonStyle.Configuration
        let symbol: String

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.macPreviewFocused) private var previewFocused
        @Environment(\.macContainer) private var container
        private var pointer = MacPointer()

        var body: some View {
            HStack(spacing: 3) {
                configuration.label
                    .lineLimit(1)
                Image(systemName: symbol)
                    .font(.system(size: 8, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(Palette.color(MacInlinePopUpStyle.labelToken(state)))
            .padding(.horizontal, MacInlinePopUpStyle.horizontalInset)
            .frame(height: MacInlinePopUpStyle.height)
            .background(
                state == .rest ? .clear : container.controlColor, in: .rect(cornerRadius: MacInlinePopUpStyle.radius)
            )
            .overlay {
                RoundedRectangle(cornerRadius: MacInlinePopUpStyle.radius)
                    .fill(state == .pressed ? state.overlay : .clear)
                    .allowsHitTesting(false)
            }
            .contentShape(.rect(cornerRadius: MacInlinePopUpStyle.radius))
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macFocusRing(isFocused || previewFocused, cornerRadius: MacInlinePopUpStyle.radius)
            .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }
#endif
