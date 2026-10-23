#if os(macOS)
    import SwiftUI

    /// Every content button on the Mac, by role. Fills come from ``Palette`` and never read
    /// whether the window is key, so a primary stays Harbor blue in an inactive window, where
    /// AppKit's own prominent bezel turns gray.
    struct MacButtonStyle: ButtonStyle {
        enum Role: CaseIterable {
            /// The one action a surface leads with: accent fill, white label.
            case primary
            /// Any other worded action: the container's control fill, ink label.
            case secondary
            /// Words only, in the accent, underlined on hover.
            case plain
            /// Words only, in secondary ink, underlined on hover: a quiet utility beside content.
            case quiet
            /// A glyph in secondary ink, with a circle of the control fill on hover.
            case icon
            /// A secondary button whose label is the danger red.
            case destructive
            /// Filled danger, only for the final confirm of an irreversible action.
            case destructiveFilled
        }

        enum Size {
            case small, regular, large

            var height: CGFloat {
                switch self {
                case .small: 24
                case .regular: 28
                case .large: 32
                }
            }

            /// An icon button's hover circle, never under 26pt so a glyph keeps a pointer-sized
            /// target even at the small size.
            var iconDiameter: CGFloat { max(height, 26) }
        }

        static let radius: CGFloat = 7
        static let horizontalPadding: CGFloat = 12
        static let disabledOpacity = 0.45
        nonisolated static let pressedDarkening = 0.06

        var role: Role
        var size: Size = .regular

        init(_ role: Role, size: Size = .regular) {
            self.role = role
            self.size = size
        }

        func makeBody(configuration: Configuration) -> some View {
            MacButtonBody(configuration: configuration, role: role, size: size)
        }

        /// The fill a role draws on `container`, or nil where it draws none. A disabled button
        /// keeps its fill and fades as a whole by ``disabledOpacity``, so a disabled primary never
        /// turns gray.
        nonisolated static func fillRGB(
            for role: Role, scheme: ColorScheme, container: MacContainer = .ground, isPressed: Bool
        ) -> KeyColor.RGB? {
            let control = KeyColor.RGB(hex: Palette.hex(container.controlFill, scheme))
            let rest: KeyColor.RGB? =
                switch role {
                case .primary: KeyColor.RGB(hex: Palette.hex(.accentFill, scheme))
                case .secondary, .destructive: control
                // The light danger red in both appearances: dark mode's pale red would not
                // carry a white label.
                case .destructiveFilled: SignalSwatch.danger(.light).ink
                case .icon: isPressed ? control : nil
                case .plain, .quiet: nil
                }
            guard let rest, isPressed else { return rest }
            return darkened(rest)
        }

        static func fill(
            for role: Role, scheme: ColorScheme, container: MacContainer = .ground, isPressed: Bool
        ) -> Color? {
            fillRGB(for: role, scheme: scheme, container: container, isPressed: isPressed)?.color
        }

        /// Whether the role takes the container's control fill, and so its edge on a light card.
        static func strokesOn(_ role: Role) -> Bool {
            role == .secondary || role == .destructive
        }

        static func labelRGB(for role: Role, scheme: ColorScheme) -> KeyColor.RGB {
            switch role {
            case .primary, .destructiveFilled: KeyColor.RGB(hex: Palette.hex(.onAccentFill, scheme))
            case .secondary: KeyColor.RGB(hex: Palette.hex(.ink, scheme))
            case .plain: KeyColor.RGB(hex: Palette.hex(.accent, scheme))
            case .quiet: KeyColor.RGB(hex: Palette.hex(.inkSecondary, scheme))
            case .icon: KeyColor.RGB(hex: Palette.hex(.inkSecondary, scheme))
            case .destructive: SignalSwatch.danger(scheme).ink
            }
        }

        static func label(for role: Role, scheme: ColorScheme) -> Color {
            labelRGB(for: role, scheme: scheme).color
        }

        static func font(_ size: Size) -> Font {
            size == .small ? MacStyle.label.weight(.semibold) : MacStyle.body.weight(.semibold)
        }

        nonisolated private static func darkened(_ rgb: KeyColor.RGB) -> KeyColor.RGB {
            let keep = 1 - pressedDarkening
            return KeyColor.RGB(red: rgb.red * keep, green: rgb.green * keep, blue: rgb.blue * keep)
        }
    }

    extension ButtonStyle where Self == MacButtonStyle {
        static var macPrimary: Self { MacButtonStyle(.primary) }
        static var macSecondary: Self { MacButtonStyle(.secondary) }
        static var macPlain: Self { MacButtonStyle(.plain) }
        static var macQuiet: Self { MacButtonStyle(.quiet) }
        static var macIcon: Self { MacButtonStyle(.icon) }
        static var macDestructive: Self { MacButtonStyle(.destructive) }

        static func mac(_ role: MacButtonStyle.Role, size: MacButtonStyle.Size = .regular) -> Self {
            MacButtonStyle(role, size: size)
        }
    }

    extension View {
        /// A filled Mac button's type, padding, and height, for a control that draws its own
        /// colors on the same metrics.
        func macButtonMetrics(_ size: MacButtonStyle.Size) -> some View {
            font(MacButtonStyle.font(size))
                .lineLimit(1)
                .padding(.horizontal, MacButtonStyle.horizontalPadding)
                .frame(height: size.height)
        }
    }

    private struct MacButtonBody: View {
        let configuration: ButtonStyle.Configuration
        let role: MacButtonStyle.Role
        let size: MacButtonStyle.Size

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container
        @State private var isHovered = false

        var body: some View {
            Group {
                switch role {
                case .icon: icon
                case .plain, .quiet: plain
                default: filled
                }
            }
            .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
            .onHover { isHovered = $0 }
        }

        private var font: Font { MacButtonStyle.font(size) }

        private var labelColor: Color { MacButtonStyle.label(for: role, scheme: scheme) }

        private var fill: Color? {
            MacButtonStyle.fill(for: role, scheme: scheme, container: container, isPressed: configuration.isPressed)
        }

        private var filled: some View {
            configuration.label
                .macButtonMetrics(size)
                .foregroundStyle(labelColor)
                .background(fill ?? .clear, in: .rect(cornerRadius: MacButtonStyle.radius))
                .macControlEdge(
                    MacButtonStyle.strokesOn(role) ? container : .ground, scheme: scheme,
                    cornerRadius: MacButtonStyle.radius
                )
                .contentShape(.rect(cornerRadius: MacButtonStyle.radius))
        }

        private var plain: some View {
            configuration.label
                .font(size == .small ? MacStyle.label : MacStyle.body)
                .lineLimit(1)
                .foregroundStyle(labelColor)
                .underline(isHovered && isEnabled)
                .frame(minHeight: size.height)
                .contentShape(.rect)
                .opacity(configuration.isPressed ? 0.7 : 1)
        }

        /// A circle around a glyph, widening to a capsule around a word.
        private var icon: some View {
            let hoverFill = isHovered && isEnabled ? container.controlColor : Color.clear
            return configuration.label
                .font(font)
                .imageScale(size == .small ? .medium : .large)
                .lineLimit(1)
                .foregroundStyle(labelColor)
                .padding(.horizontal, size == .small ? 4 : 6)
                .frame(minWidth: size.iconDiameter, minHeight: size.iconDiameter)
                .background(fill ?? hoverFill, in: .capsule)
                .contentShape(.capsule)
        }
    }
#endif
