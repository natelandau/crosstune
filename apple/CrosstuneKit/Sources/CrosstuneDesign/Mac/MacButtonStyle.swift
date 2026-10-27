#if os(macOS)
    import SwiftUI

    /// Every content button on the Mac, by role. Fills come from ``Palette`` and never read
    /// whether the window is key, so a primary stays the accent in an inactive window, where
    /// AppKit's own prominent bezel turns gray.
    package struct MacButtonStyle: ButtonStyle {
        package enum Role: CaseIterable {
            /// The one action a surface leads with: accent fill, white label.
            case primary
            /// Any other worded action: the container's control fill, primary text label.
            case secondary
            /// Words only, in the accent, underlined on hover.
            case plain
            /// Words only, in secondary text, underlined on hover: a quiet utility beside content.
            case quiet
            /// A glyph in secondary text, with a circle of the control fill on hover.
            case icon
            /// A secondary button whose label is the danger red.
            case destructive
            /// Filled danger, only for the final confirm of an irreversible action.
            case destructiveFilled
        }

        package enum Size {
            case small, regular, large

            package var height: CGFloat {
                switch self {
                case .small: 24
                case .regular: 28
                case .large: 32
                }
            }

            /// An icon button's hover circle, never under 26pt so a glyph keeps a pointer-sized
            /// target even at the small size.
            package var iconDiameter: CGFloat { max(height, 26) }
        }

        package static let radius: CGFloat = 7
        package static let horizontalPadding: CGFloat = 12
        package static let disabledOpacity = 0.45
        /// How much of the primary text color a press mixes into a fill, so a press darkens in
        /// light mode and lightens in dark mode.
        package nonisolated static let pressedOverlay = 0.06

        package var role: Role
        package var size: Size = .regular

        package init(_ role: Role, size: Size = .regular) {
            self.role = role
            self.size = size
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacButtonBody(configuration: configuration, role: role, size: size)
        }

        /// Whether a disabled button of `role` drops its fill for a ring and a faint label, so it
        /// reads as off and never as another filled button. The other roles fade as a whole by
        /// ``disabledOpacity``.
        package nonisolated static func dropsFillWhenDisabled(_ role: Role) -> Bool {
            role == .primary || role == .destructiveFilled
        }

        /// The fill a role draws on `container`, or nil where it draws none. A destructive button
        /// draws nothing at rest and the danger role's subtle fill under the pointer or a press,
        /// so its red label never sits on a gray fill.
        package nonisolated static func fillRGB(
            for role: Role, scheme: ColorScheme, container: MacContainer = .pageBackground, isPressed: Bool
        ) -> KeyColor.RGB? {
            if role == .destructive {
                guard isPressed else { return nil }
                let subtle = Palette.mixHex(
                    Palette.hex(container.fill, scheme), toward: Palette.hex(.danger, scheme),
                    share: Palette.subtleOpacity)
                return KeyColor.RGB(hex: subtle)
            }
            let control = KeyColor.RGB(hex: Palette.hex(container.controlFill, scheme))
            let rest: KeyColor.RGB? =
                switch role {
                case .primary: KeyColor.RGB(hex: Palette.hex(.accentFill, scheme))
                case .secondary: control
                case .destructive: nil
                case .destructiveFilled: KeyColor.RGB(hex: Palette.hex(.danger, scheme))
                case .icon: isPressed ? control : nil
                case .plain, .quiet: nil
                }
            guard let rest, isPressed else { return rest }
            return pressed(rest, scheme: scheme)
        }

        package static func fill(
            for role: Role, scheme: ColorScheme, container: MacContainer = .pageBackground, isPressed: Bool
        ) -> Color? {
            fillRGB(for: role, scheme: scheme, container: container, isPressed: isPressed)?.color
        }

        /// Whether the role takes the container's control fill, and so its edge on a light card.
        package static func strokesOn(_ role: Role) -> Bool {
            role == .secondary
        }

        package static func labelRGB(for role: Role, scheme: ColorScheme) -> KeyColor.RGB {
            switch role {
            case .primary: KeyColor.RGB(hex: Palette.hex(.onAccentFill, scheme))
            case .destructiveFilled: KeyColor.RGB(hex: Palette.hex(.onStatus, scheme))
            case .secondary: KeyColor.RGB(hex: Palette.hex(.textPrimary, scheme))
            case .plain: KeyColor.RGB(hex: Palette.hex(.accent, scheme))
            case .quiet: KeyColor.RGB(hex: Palette.hex(.textSecondary, scheme))
            case .icon: KeyColor.RGB(hex: Palette.hex(.textSecondary, scheme))
            case .destructive: KeyColor.RGB(hex: Palette.hex(.danger, scheme))
            }
        }

        package static func label(for role: Role, scheme: ColorScheme) -> Color {
            labelRGB(for: role, scheme: scheme).color
        }

        package static func font(_ size: Size) -> Font {
            size == .small ? MacStyle.label.weight(.semibold) : MacStyle.body.weight(.semibold)
        }

        nonisolated private static func pressed(_ rgb: KeyColor.RGB, scheme: ColorScheme) -> KeyColor.RGB {
            KeyColor.RGB(hex: Palette.mixHex(rgb.hex, toward: Palette.hex(.textPrimary, scheme), share: pressedOverlay))
        }
    }

    extension ButtonStyle where Self == MacButtonStyle {
        package static var macPrimary: Self { MacButtonStyle(.primary) }
        package static var macSecondary: Self { MacButtonStyle(.secondary) }
        package static var macPlain: Self { MacButtonStyle(.plain) }
        package static var macQuiet: Self { MacButtonStyle(.quiet) }
        package static var macIcon: Self { MacButtonStyle(.icon) }
        package static var macDestructive: Self { MacButtonStyle(.destructive) }

        package static func mac(_ role: MacButtonStyle.Role, size: MacButtonStyle.Size = .regular) -> Self {
            MacButtonStyle(role, size: size)
        }
    }

    extension View {
        /// A filled Mac button's type, padding, and height, for a control that draws its own
        /// colors on the same metrics.
        package func macButtonMetrics(_ size: MacButtonStyle.Size) -> some View {
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
            .opacity(isEnabled || dropsFill ? 1 : MacButtonStyle.disabledOpacity)
            .onHover { isHovered = $0 }
        }

        private var font: Font { MacButtonStyle.font(size) }

        /// A disabled filled role, drawn as a ring with a faint label.
        private var dropsFill: Bool { !isEnabled && MacButtonStyle.dropsFillWhenDisabled(role) }

        private var labelColor: Color {
            dropsFill ? Palette.onDisabled : MacButtonStyle.label(for: role, scheme: scheme)
        }

        private var fill: Color? {
            if dropsFill { return nil }
            // A destructive button shows its fill under the pointer as well as on a press.
            let isPressed = configuration.isPressed || (role == .destructive && isHovered && isEnabled)
            return MacButtonStyle.fill(for: role, scheme: scheme, container: container, isPressed: isPressed)
        }

        private var filled: some View {
            configuration.label
                .macButtonMetrics(size)
                .foregroundStyle(labelColor)
                .background(fill ?? .clear, in: .rect(cornerRadius: MacButtonStyle.radius))
                .overlay {
                    if dropsFill {
                        RoundedRectangle(cornerRadius: MacButtonStyle.radius)
                            .strokeBorder(Palette.disabledBorder, lineWidth: 1)
                    }
                }
                .macControlEdge(
                    MacButtonStyle.strokesOn(role) ? container : .pageBackground, scheme: scheme,
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
