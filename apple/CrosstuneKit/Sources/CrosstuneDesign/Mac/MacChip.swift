#if os(macOS)
    import SwiftUI

    /// How a chip reads.
    package enum MacChipState {
        /// Unpicked: the field fill and primary text, or a key's own hue.
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

            package var height: CGFloat { self == .row ? 18 : 26 }
            package var horizontalPadding: CGFloat { self == .row ? 6 : 12 }
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
            case .rest: KeyColor.RGB(hex: Palette.hex(.textPrimary, scheme))
            case .chosen: KeyColor.RGB(hex: Palette.hex(.onAccentFill, scheme))
            case .set: KeyColor.RGB(hex: Palette.hex(Palette.onTintIsAccent(scheme) ? .accent : .textPrimary, scheme))
            }
        }

        /// The opaque fill of a state with no hue, or nil for the tint, which is translucent.
        package static func solidFillHex(state: MacChipState, scheme: ColorScheme) -> String? {
            switch state {
            case .rest: Palette.hex(.field, scheme).lowercased()
            case .chosen: Palette.hex(.accentFill, scheme).lowercased()
            case .set: nil
            }
        }

        /// The tint as it lands on `background`.
        package static func setTintHex(over background: String, scheme: ColorScheme) -> String {
            let accent = KeyColor.RGB(hex: Palette.hex(.accent, scheme))
            let base = KeyColor.RGB(hex: background)
            let opacity = Palette.tintOpacity(scheme)
            func mix(_ upper: Double, _ lower: Double) -> Double { upper * opacity + lower * (1 - opacity) }
            return KeyColor.RGB(
                red: mix(accent.red, base.red), green: mix(accent.green, base.green),
                blue: mix(accent.blue, base.blue)
            ).hex
        }
    }

    /// A chip's look on a button's label. A key passes its own `hue` and the `hueText` that reads
    /// on it; a chip with none takes its state's fill.
    package struct MacChipStyle: ButtonStyle {
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
        let style: MacChipStyle

        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .macChip(
                    state: style.state, hue: style.hue, hueText: style.hueText, size: style.size,
                    emphasis: configuration.isPressed || isHovered ? 1 : 0
                )
                .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
                .onHover { isHovered = $0 }
        }
    }

    extension View {
        /// Draws this view as a chip: chip font, the size's height and padding, the state's fill
        /// and text color. `emphasis` darkens the fill for hover and press.
        package func macChip(
            state: MacChipState, hue: Color? = nil, hueText: Color? = nil, size: MacChip.Size, emphasis: Double = 0,
            minWidth: CGFloat? = nil, onSelectedRow: Bool = false
        ) -> some View {
            modifier(
                MacChipLabel(
                    state: state, hue: hue, hueText: hueText, size: size, emphasis: emphasis, minWidth: minWidth,
                    onSelectedRow: onSelectedRow))
        }
    }

    private struct MacChipLabel: ViewModifier {
        let state: MacChipState
        let hue: Color?
        let hueText: Color?
        let size: MacChip.Size
        let emphasis: Double
        let minWidth: CGFloat?
        let onSelectedRow: Bool

        @Environment(\.colorScheme) private var scheme

        func body(content: Content) -> some View {
            content
                .font(MacStyle.chip)
                .lineLimit(1)
                .foregroundStyle(label)
                .padding(.horizontal, size.horizontalPadding)
                .frame(minWidth: minWidth, minHeight: size.height, maxHeight: size.height)
                .background(fill, in: .capsule)
                .overlay {
                    Palette.hoverOverlay.clipShape(.capsule)
                        .opacity(emphasis)
                }
                .overlay { ring }
                .contentShape(.capsule)
        }

        private var label: Color { hueText ?? MacChip.labelRGB(state: state, scheme: scheme).color }

        private var fill: AnyShapeStyle {
            if let hue { return AnyShapeStyle(hue) }
            if let hex = MacChip.solidFillHex(state: state, scheme: scheme) {
                return AnyShapeStyle(KeyColor.RGB(hex: hex).color)
            }
            return AnyShapeStyle(Palette.tint(scheme))
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
