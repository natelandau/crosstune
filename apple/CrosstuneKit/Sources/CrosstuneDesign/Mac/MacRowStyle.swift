#if os(macOS)
    import SwiftUI

    /// Every pressable Mac row: an opens-more row in a form card, a picker sheet's row, a saved
    /// place. The whole row is the button, at least a row's height, with the container's control
    /// fill under the pointer, the pressed overlay on a press, and the keyboard ring inside it.
    ///
    /// A primitive style, so it turns off the system focus effect on the button itself, as
    /// ``MacButtonStyle`` does.
    package struct MacRowStyle: PrimitiveButtonStyle {
        package static let radius = MacControl.radius
        /// How far a row's text sits in from its fill, which a line beside the rows matches.
        package static let labelInset: CGFloat = 10

        private let padsLabel: Bool

        /// - Parameter padsLabel: False for a row whose label already holds its own insets, so
        ///   it lines up with read-only rows beside it.
        package init(padsLabel: Bool = true) {
            self.padsLabel = padsLabel
        }

        /// The fill a row draws on `container` in `state` under its overlay, or nil at rest.
        package static func fillToken(state: MacPressState, container: MacContainer) -> Palette.Token? {
            state == .rest ? nil : container.controlFill
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacFocusEffectOff(MacRowBodyStyle(padsLabel: padsLabel)).makeBody(configuration: configuration)
        }
    }

    extension PrimitiveButtonStyle where Self == MacRowStyle {
        package static var macRow: Self { MacRowStyle() }
    }

    /// Whether a row under it is under the pointer or pressed, so a form card hides the hairlines
    /// beside that row.
    package struct MacRowHovered: PreferenceKey {
        package static let defaultValue = false

        package static func reduce(value: inout Bool, nextValue: () -> Bool) {
            value = value || nextValue()
        }
    }

    extension EnvironmentValues {
        /// The padding a form card puts around each of its rows. A pressable row draws its fill
        /// and ring over that padding, so the whole row lights up rather than its content alone.
        /// So a ``MacRowStyle`` button in a card is the whole row, never one part of a row's
        /// content.
        @Entry package var macFormRowPadding: EdgeInsets?
        /// Whether the row around a view is under the pointer or holds focus.
        @Entry package var macRowHighlighted = false
    }

    private struct MacRowBodyStyle: ButtonStyle {
        let padsLabel: Bool

        func makeBody(configuration: Configuration) -> some View {
            MacRowBody(configuration: configuration, padsLabel: padsLabel)
        }
    }

    private struct MacRowBody: View {
        /// A row's own padding outside a form card.
        private static let padding = EdgeInsets(
            top: 0, leading: MacRowStyle.labelInset, bottom: 0, trailing: MacRowStyle.labelInset)

        let configuration: ButtonStyle.Configuration
        let padsLabel: Bool

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.macPreviewFocused) private var previewFocused
        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container
        @Environment(\.macFormRowPadding) private var cardPadding
        private var pointer = MacPointer()

        var body: some View {
            let padding = cardPadding ?? (padsLabel ? Self.padding : EdgeInsets())
            configuration.label
                .environment(\.macRowHighlighted, isEnabled && (pointer.isHovered || isFocused || previewFocused))
                .environment(\.macFormRowPadding, nil)
                .font(MacStyle.body)
                .foregroundStyle(Palette.textPrimary)
                .padding(padding)
                .frame(maxWidth: .infinity, minHeight: MacControl.rowMinHeight, alignment: .leading)
                .background { fill }
                .macControlEdge(container, scheme: scheme, cornerRadius: MacRowStyle.radius, isShown: state != .rest)
                .contentShape(.rect(cornerRadius: MacRowStyle.radius))
                .macFocusRing(isFocused || previewFocused, cornerRadius: MacRowStyle.radius, inset: true)
                .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
                .macPointer(pointer, state: state)
                .preference(key: MacRowHovered.self, value: state != .rest)
                // In a card, the row reaches over the card's padding around it.
                .padding(cardPadding.map(Self.negated) ?? EdgeInsets())
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }

        @ViewBuilder private var fill: some View {
            if let token = MacRowStyle.fillToken(state: state, container: container) {
                RoundedRectangle(cornerRadius: MacRowStyle.radius)
                    .fill(Palette.color(token))
                    .overlay(state.overlay, in: .rect(cornerRadius: MacRowStyle.radius))
            }
        }

        private static func negated(_ insets: EdgeInsets) -> EdgeInsets {
            EdgeInsets(top: -insets.top, leading: -insets.leading, bottom: -insets.bottom, trailing: -insets.trailing)
        }
    }
#endif
