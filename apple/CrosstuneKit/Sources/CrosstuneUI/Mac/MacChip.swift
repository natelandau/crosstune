#if os(macOS)
    import SwiftUI

    /// How a chip reads.
    enum MacChipState {
        /// Unpicked: the field fill and ink, or a key's own hue.
        case rest
        /// The picked choice: the accent fill under white, or a key's hue with an accent ring.
        case chosen
        /// A filter that narrows the list: the accent wash under accent ink.
        case set
    }

    /// The one chip on the Mac, worn by a key pill, a choice capsule, a list token, and a
    /// filter control.
    enum MacChip {
        enum Size {
            /// Inside a line of row metadata.
            case row
            /// On its own, in a form, a popover, or a filter row.
            case standalone

            var height: CGFloat { self == .row ? 18 : 26 }
            var horizontalPadding: CGFloat { self == .row ? 6 : 12 }
        }

        /// Single-letter key pills in a row share this width so a column of them lines up.
        static let minRowWidth: CGFloat = 28
        static let ringWidth: CGFloat = 2
        static let ringToken = Palette.Token.accent
        /// A line of ground between the chosen key's ring and its hue: the accent and a key's
        /// chosen hue sit near one lightness, so the ring holds 3:1 only against ground.
        static let ringGapWidth: CGFloat = 1
        static let ringGapToken = Palette.Token.ground
        static let hoverDarkening = 0.06

        static func labelRGB(state: MacChipState, scheme: ColorScheme) -> KeyColor.RGB {
            switch state {
            case .rest: KeyColor.RGB(hex: Palette.hex(.ink, scheme))
            case .chosen: KeyColor.RGB(hex: Palette.hex(.onAccentFill, scheme))
            case .set: KeyColor.RGB(hex: Palette.hex(BrandStyle.setLabelIsAccent(scheme) ? .accent : .ink, scheme))
            }
        }

        /// The opaque fill of a state with no hue, or nil for the set wash, which is translucent.
        static func solidFillHex(state: MacChipState, scheme: ColorScheme) -> String? {
            switch state {
            case .rest: Palette.hex(.field, scheme).lowercased()
            case .chosen: Palette.hex(.accentFill, scheme).lowercased()
            case .set: nil
            }
        }

        /// The set wash as it lands on `ground`.
        static func setWashHex(over ground: String, scheme: ColorScheme) -> String {
            let accent = KeyColor.RGB(hex: Palette.hex(.accent, scheme))
            let base = KeyColor.RGB(hex: ground)
            let opacity = BrandStyle.setFillOpacity(scheme)
            func mix(_ upper: Double, _ lower: Double) -> Double { upper * opacity + lower * (1 - opacity) }
            return KeyColor.RGB(
                red: mix(accent.red, base.red), green: mix(accent.green, base.green),
                blue: mix(accent.blue, base.blue)
            ).hex
        }
    }

    /// A chip's look on a button's label. A key passes its own `hue` and the `hueInk` that reads
    /// on it; a chip with none takes its state's fill.
    struct MacChipStyle: ButtonStyle {
        var state: MacChipState
        var hue: Color?
        var hueInk: Color?
        var size: MacChip.Size

        init(state: MacChipState, hue: Color? = nil, hueInk: Color? = nil, size: MacChip.Size) {
            self.state = state
            self.hue = hue
            self.hueInk = hueInk
            self.size = size
        }

        func makeBody(configuration: Configuration) -> some View {
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
                    state: style.state, hue: style.hue, hueInk: style.hueInk, size: style.size,
                    emphasis: configuration.isPressed || isHovered ? 1 : 0
                )
                .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
                .onHover { isHovered = $0 }
        }
    }

    extension View {
        /// Draws this view as a chip: chip font, the size's height and padding, the state's fill
        /// and ink. `emphasis` darkens the fill for hover and press.
        func macChip(
            state: MacChipState, hue: Color? = nil, hueInk: Color? = nil, size: MacChip.Size, emphasis: Double = 0,
            minWidth: CGFloat? = nil, onSelectedRow: Bool = false
        ) -> some View {
            modifier(
                MacChipLabel(
                    state: state, hue: hue, hueInk: hueInk, size: size, emphasis: emphasis, minWidth: minWidth,
                    onSelectedRow: onSelectedRow))
        }
    }

    private struct MacChipLabel: ViewModifier {
        let state: MacChipState
        let hue: Color?
        let hueInk: Color?
        let size: MacChip.Size
        let emphasis: Double
        let minWidth: CGFloat?
        let onSelectedRow: Bool

        @Environment(\.colorScheme) private var scheme

        func body(content: Content) -> some View {
            content
                .font(MacStyle.chip)
                .lineLimit(1)
                .foregroundStyle(ink)
                .padding(.horizontal, size.horizontalPadding)
                .frame(minWidth: minWidth, minHeight: size.height, maxHeight: size.height)
                .background(fill, in: .capsule)
                .overlay { Color.black.opacity(MacChip.hoverDarkening * emphasis).clipShape(.capsule) }
                .overlay { ring }
                .contentShape(.capsule)
        }

        private var ink: Color { hueInk ?? MacChip.labelRGB(state: state, scheme: scheme).color }

        private var fill: AnyShapeStyle {
            if let hue { return AnyShapeStyle(hue) }
            if let hex = MacChip.solidFillHex(state: state, scheme: scheme) {
                return AnyShapeStyle(KeyColor.RGB(hex: hex).color)
            }
            return AnyShapeStyle(BrandStyle.setFill(scheme))
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
                Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 1)
            }
        }
    }
#endif
