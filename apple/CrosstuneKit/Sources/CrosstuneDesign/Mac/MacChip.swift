#if os(macOS)
    import SwiftUI

    /// How a chip reads.
    package enum MacChipState {
        /// Unpicked: the container's control fill and primary text, or a key's own hue.
        case rest
        /// The picked choice: the accent fill under white, or a key's hue with an accent ring.
        case chosen
        /// A filter that narrows the list: the tint under its label color.
        case set
    }

    /// The one chip on the Mac, worn by a key pill, a choice capsule, a list token, and a
    /// filter control.
    package enum MacChip {
        package enum Size {
            /// Inside a line of row metadata.
            case row
            /// On its own, in a form, a popover, or a filter row.
            case standalone

            package var height: CGFloat { self == .row ? 18 : MacControl.smallHeight }
            package var horizontalPadding: CGFloat { self == .row ? 6 : 11 }
        }

        /// Single-letter key pills in a row share this width so a column of them lines up.
        package static let minRowWidth: CGFloat = 28
        package static let ringWidth: CGFloat = 2
        package static let ringToken = Palette.Token.accent
        /// A line of page background between the chosen key's ring and its hue: the accent and a
        /// key's chosen hue sit near one lightness, so the ring holds 3:1 only against the page
        /// background.
        package static let ringGapWidth: CGFloat = 1
        package static let ringGapToken = Palette.Token.pageBackground

        package static func labelRGB(state: MacChipState, scheme: ColorScheme) -> KeyColor.RGB {
            switch state {
            case .rest: Palette.rgb(.textPrimary, scheme)
            case .chosen: Palette.rgb(.onAccentFill, scheme)
            case .set: Palette.rgb(Palette.onTintIsAccent(scheme) ? .accent : .textPrimary, scheme)
            }
        }

        /// The opaque fill of a state with no hue in `container`, or nil for the tint, which is
        /// translucent.
        package static func solidFillHex(
            state: MacChipState, scheme: ColorScheme, container: MacContainer = .pageBackground
        ) -> String? {
            switch state {
            case .rest: Palette.hex(container.controlFill, scheme).lowercased()
            case .chosen: Palette.hex(.accentFill, scheme).lowercased()
            case .set: nil
            }
        }

        /// The tint as it lands on `background` in `press`.
        package static func setTintHex(
            over background: String, scheme: ColorScheme, press: MacPressState = .rest
        ) -> String {
            Palette.rgb(.accent, scheme).over(
                KeyColor.RGB(hex: background), alpha: MacControl.tintFillOpacity(press, scheme: scheme)
            ).hex
        }
    }

    /// A chip's look on a button's label. A key passes its own `hue` and the `hueText` that reads
    /// on it; a chip with none takes its state's fill. It wraps the button so the system focus
    /// effect is off; a menu, which ignores a primitive style, takes ``MacMenuChipStyle``.
    package struct MacChipStyle: PrimitiveButtonStyle {
        private let look: MacMenuChipStyle

        package init(state: MacChipState, hue: Color? = nil, hueText: Color? = nil, size: MacChip.Size) {
            look = MacMenuChipStyle(state: state, hue: hue, hueText: hueText, size: size)
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacFocusEffectOff(look).makeBody(configuration: configuration)
        }
    }

    /// A ``MacChipStyle`` look as a plain style, for a menu.
    package struct MacMenuChipStyle: ButtonStyle {
        package var state: MacChipState
        package var hue: Color?
        package var hueText: Color?
        package var size: MacChip.Size

        package init(state: MacChipState, hue: Color? = nil, hueText: Color? = nil, size: MacChip.Size) {
            self.state = state
            self.hue = hue
            self.hueText = hueText
            self.size = size
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacChipButtonBody(configuration: configuration, style: self)
        }
    }

    private struct MacChipButtonBody: View {
        let configuration: ButtonStyle.Configuration
        let style: MacMenuChipStyle

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        private var pointer = MacPointer()

        var body: some View {
            configuration.label
                .macChip(state: style.state, hue: style.hue, hueText: style.hueText, size: style.size, press: press)
                .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
                .macFocusRing(isFocused, shape: Capsule())
                .macPointer(pointer, state: press)
        }

        private var press: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }

    extension View {
        /// Draws this view as a chip: chip font, the size's height and padding, the state's fill
        /// and text color. `press` lays the hover or pressed look over the fill.
        package func macChip(
            state: MacChipState, hue: Color? = nil, hueText: Color? = nil, size: MacChip.Size,
            press: MacPressState = .rest, minWidth: CGFloat? = nil, onSelectedRow: Bool = false
        ) -> some View {
            modifier(
                MacChipLabel(
                    state: state, hue: hue, hueText: hueText, size: size, press: press, minWidth: minWidth,
                    onSelectedRow: onSelectedRow))
        }
    }

    private struct MacChipLabel: ViewModifier {
        let state: MacChipState
        let hue: Color?
        let hueText: Color?
        let size: MacChip.Size
        let press: MacPressState
        let minWidth: CGFloat?
        let onSelectedRow: Bool

        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container

        func body(content: Content) -> some View {
            content
                .font(MacStyle.chip)
                .lineLimit(1)
                .foregroundStyle(label)
                .padding(.horizontal, size.horizontalPadding)
                .frame(minWidth: minWidth, minHeight: size.height, maxHeight: size.height)
                .background(fill, in: .capsule)
                .overlay { overlay.clipShape(.capsule) }
                .macControlEdge(container, scheme: scheme, cornerRadius: size.height / 2, isShown: drawsControlFill)
                .overlay { ring }
                .contentShape(.capsule)
                .macAnimation(MacMotion.state, value: state)
        }

        private var drawsControlFill: Bool { state == .rest && hue == nil }

        private var label: Color { hueText ?? MacChip.labelRGB(state: state, scheme: scheme).color }

        private var fill: AnyShapeStyle {
            if let hue { return AnyShapeStyle(hue) }
            if let hex = MacChip.solidFillHex(state: state, scheme: scheme, container: container) {
                return AnyShapeStyle(KeyColor.RGB(hex: hex).color)
            }
            return AnyShapeStyle(MacControl.tintFill(press, scheme: scheme))
        }

        /// The hover or press look over an opaque fill. The tint steps its own fill instead.
        private var overlay: Color {
            guard hue != nil || state != .set else { return .clear }
            return press.overlay
        }

        /// The chosen key's accent ring, or the light outline that keeps a pill legible on a
        /// selected row.
        @ViewBuilder private var ring: some View {
            if state == .chosen, hue != nil {
                ZStack {
                    Capsule().strokeBorder(
                        Palette.color(MacChip.ringGapToken), lineWidth: MacChip.ringWidth + MacChip.ringGapWidth)
                    Capsule().strokeBorder(Palette.color(MacChip.ringToken), lineWidth: MacChip.ringWidth)
                }
            } else if onSelectedRow {
                Capsule().strokeBorder(Palette.onAccentFill, lineWidth: 1)
            }
        }
    }
#endif
