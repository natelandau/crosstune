#if os(macOS)
    import SwiftUI

    /// Every content button on the Mac, by role. Fills come from ``Palette`` and never read
    /// whether the window is key, so a primary stays the accent in an inactive window, where
    /// AppKit's own prominent bezel turns gray.
    ///
    /// A primitive style, so it turns off the system focus effect on the button itself: that
    /// setting flows down from ancestors, and a plain style's body sits inside the button. A
    /// menu takes only a plain style, so it takes ``MacMenuButtonStyle``.
    package struct MacButtonStyle: PrimitiveButtonStyle {
        package enum Role: CaseIterable {
            /// Filled: the one main action in a view. Accent fill, white label.
            case primary
            /// Tinted: every other worded action, on the tint.
            case secondary
            /// Text: a quiet action in the accent, underlined under the pointer.
            case plain
            /// A glyph in secondary text, with a circle of the control fill on hover.
            case icon
            /// Tinted destructive: the container's control fill under the danger red.
            case destructive
            /// Filled danger, only for the final confirm of an irreversible action.
            case destructiveFilled
        }

        package enum Size {
            case small, regular, large

            package var height: CGFloat {
                switch self {
                case .small: MacControl.smallHeight
                case .regular: MacControl.regularHeight
                case .large: MacControl.largeHeight
                }
            }

            /// An icon button's hover circle, never under 26pt so a glyph keeps a pointer-sized
            /// target even at the small size.
            package var iconDiameter: CGFloat { max(height, 26) }

            /// The size a control size stands for.
            package init(_ controlSize: ControlSize) {
                switch controlSize {
                case .mini, .small: self = .small
                case .large, .extraLarge: self = .large
                default: self = .regular
                }
            }
        }

        package static let radius: CGFloat = MacControl.radius
        package static let disabledOpacity = MacControl.disabledOpacity

        package var role: Role
        package var size: Size = .regular
        /// For an icon button that toggles: whether it is on. Nil for one that only acts.
        package var isOn: Bool?

        package init(_ role: Role, size: Size = .regular, isOn: Bool? = nil) {
            self.role = role
            self.size = size
            self.isOn = isOn
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacFocusEffectOff(MacMenuButtonStyle(role, size: size, isOn: isOn)).makeBody(configuration: configuration)
        }

        package static func horizontalPadding(_ size: Size) -> CGFloat {
            switch size {
            case .small: 10
            case .regular: 12
            case .large: 14
            }
        }

        /// Whether a disabled button of `role` drops its fill for an outline and a faint label, so
        /// it reads as off and never as another filled button. The other roles fade as a whole by
        /// ``disabledOpacity``.
        package nonisolated static func dropsFillWhenDisabled(_ role: Role) -> Bool {
            role == .primary || role == .destructiveFilled
        }

        /// The opaque fill a role draws on `container` in `state`, or nil where it draws none.
        /// A filled role takes the hover or pressed overlay; a tinted one steps to `tintStrong`.
        package nonisolated static func fillRGB(
            for role: Role, scheme: ColorScheme, container: MacContainer = .pageBackground, state: MacPressState
        ) -> KeyColor.RGB? {
            switch role {
            case .primary: return overlaid(Palette.rgb(.accentFill, scheme), state: state, scheme: scheme)
            case .destructiveFilled: return overlaid(Palette.rgb(.danger, scheme), state: state, scheme: scheme)
            case .destructive:
                // An overlay on the control fill leaves the danger label short of 4.5:1, so hover
                // and press take the danger role's subtle fill instead.
                guard state != .rest else { return Palette.rgb(container.controlFill, scheme) }
                return Palette.rgb(.danger, scheme).over(
                    Palette.rgb(container.fill, scheme), alpha: Palette.subtleOpacity)
            case .secondary:
                return Palette.rgb(.accent, scheme).over(
                    Palette.rgb(container.fill, scheme), alpha: MacControl.tintFillOpacity(state, scheme: scheme))
            case .icon: return iconFillRGB(isOn: nil, state: state, scheme: scheme, container: container)
            case .plain: return nil
            }
        }

        /// An icon button's circle, or nil where it draws none. A toggle that is on takes the tint,
        /// so on shows in shape and not by the glyph's color alone.
        package nonisolated static func iconFillRGB(
            isOn: Bool?, state: MacPressState, scheme: ColorScheme, container: MacContainer = .pageBackground
        ) -> KeyColor.RGB? {
            if isOn == true {
                return Palette.rgb(.accent, scheme).over(
                    Palette.rgb(container.fill, scheme), alpha: MacControl.tintFillOpacity(state, scheme: scheme))
            }
            guard state != .rest else { return nil }
            let control = Palette.rgb(container.controlFill, scheme)
            return state == .pressed ? overlaid(control, state: .pressed, scheme: scheme) : control
        }

        /// An icon button's glyph: the accent when on, else secondary text that steps to primary
        /// text under the pointer.
        package nonisolated static func iconLabelRGB(isOn: Bool?, state: MacPressState, scheme: ColorScheme)
            -> KeyColor.RGB
        {
            let token: Palette.Token =
                isOn == true ? .accent : state == .rest ? .textSecondary : .textPrimary
            return Palette.rgb(token, scheme)
        }

        package static func fill(
            for role: Role, scheme: ColorScheme, container: MacContainer = .pageBackground, state: MacPressState
        ) -> Color? {
            fillRGB(for: role, scheme: scheme, container: container, state: state)?.color
        }

        /// Whether the role takes the container's control fill, and so its edge on a light card.
        package static func strokesOn(_ role: Role) -> Bool {
            role == .destructive
        }

        /// The label's color. `destructive` is the button's destructive role, which turns a Text
        /// button's words `danger`; the other roles name their destructive look in the role.
        package nonisolated static func labelRGB(
            for role: Role, destructive: Bool = false, scheme: ColorScheme
        ) -> KeyColor.RGB {
            return switch role {
            case .primary: Palette.rgb(.onAccentFill, scheme)
            case .destructiveFilled: Palette.rgb(.onStatus, scheme)
            case .secondary: Palette.rgb(Palette.onTintIsAccent(scheme) ? .accent : .textPrimary, scheme)
            case .plain: Palette.rgb(destructive ? .danger : .accent, scheme)
            case .icon: iconLabelRGB(isOn: nil, state: .rest, scheme: scheme)
            case .destructive: Palette.rgb(.danger, scheme)
            }
        }

        package static func label(for role: Role, destructive: Bool = false, scheme: ColorScheme) -> Color {
            labelRGB(for: role, destructive: destructive, scheme: scheme).color
        }

        package static func font(_ size: Size) -> Font {
            size == .small ? MacStyle.label.weight(.semibold) : MacStyle.body.weight(.semibold)
        }

        nonisolated private static func overlaid(
            _ fill: KeyColor.RGB, state: MacPressState, scheme: ColorScheme
        ) -> KeyColor.RGB {
            state == .rest ? fill : Palette.rgb(.textPrimary, scheme).over(fill, alpha: state.overlayOpacity)
        }
    }

    /// A ``MacButtonStyle`` look as a plain style, for a menu, which ignores a primitive one.
    package struct MacMenuButtonStyle: ButtonStyle {
        package var role: MacButtonStyle.Role
        package var size: MacButtonStyle.Size
        package var isOn: Bool?

        package init(_ role: MacButtonStyle.Role, size: MacButtonStyle.Size = .regular, isOn: Bool? = nil) {
            self.role = role
            self.size = size
            self.isOn = isOn
        }

        package func makeBody(configuration: Configuration) -> some View {
            MacButtonBody(configuration: configuration, role: role, size: size, isOn: isOn)
        }
    }

    extension View {
        /// Gives every menu, and any button beside one, the `role` look at the environment's
        /// control size, each holding its own focus for its ring. It draws each menu as a button
        /// menu, so a menu under it never sets its own menu style.
        package func macMenuAppearance(_ role: MacButtonStyle.Role) -> some View {
            modifier(MacMenuAppearance(role: role))
        }
    }

    private struct MacMenuAppearance: ViewModifier {
        let role: MacButtonStyle.Role
        @Environment(\.controlSize) private var controlSize

        func body(content: Content) -> some View {
            let size = MacButtonStyle.Size(controlSize)
            content
                .buttonStyle(MacButtonStyle(role, size: size))
                .menuStyle(MacFocusedMenuStyle(look: MacMenuButtonStyle(role, size: size)))
                .focusEffectDisabled()
        }
    }

    /// A button menu in `look`. A menu reads only a plain style, so the menu's own focus reaches
    /// the look through ``View/macButtonFocus()`` here, where a primitive style would hold it.
    private struct MacFocusedMenuStyle<Look: ButtonStyle>: MenuStyle {
        let look: Look

        func makeBody(configuration: Configuration) -> some View {
            Menu(configuration)
                .menuStyle(.button)
                .buttonStyle(look)
                .focusEffectDisabled()
                .macButtonFocus()
        }
    }

    extension PrimitiveButtonStyle where Self == MacButtonStyle {
        package static var macPrimary: Self { MacButtonStyle(.primary) }
        package static var macSecondary: Self { MacButtonStyle(.secondary) }
        package static var macPlain: Self { MacButtonStyle(.plain) }
        package static var macIcon: Self { MacButtonStyle(.icon) }
        package static var macDestructive: Self { MacButtonStyle(.destructive) }

        package static func mac(
            _ role: MacButtonStyle.Role, size: MacButtonStyle.Size = .regular, isOn: Bool? = nil
        ) -> Self {
            MacButtonStyle(role, size: size, isOn: isOn)
        }
    }

    extension View {
        /// A filled Mac button's type, padding, and height, for a control that draws its own
        /// colors on the same metrics.
        package func macButtonMetrics(_ size: MacButtonStyle.Size) -> some View {
            font(MacButtonStyle.font(size))
                .lineLimit(1)
                .padding(.horizontal, MacButtonStyle.horizontalPadding(size))
                .frame(height: size.height)
        }
    }

    private struct MacButtonBody: View {
        let configuration: ButtonStyle.Configuration
        let role: MacButtonStyle.Role
        let size: MacButtonStyle.Size
        let isOn: Bool?

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        private var pointer = MacPointer()
        @State private var glyphSprings = 0

        var body: some View {
            Group {
                switch role {
                case .icon: icon
                case .plain: text
                default: filled
                }
            }
            .opacity(isEnabled || dropsFill ? 1 : MacButtonStyle.disabledOpacity)
            .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }

        /// A disabled Filled role, drawn as an outline with a faint label.
        private var dropsFill: Bool { !isEnabled && MacButtonStyle.dropsFillWhenDisabled(role) }

        private var labelColor: Color {
            dropsFill
                ? Palette.onDisabled
                : MacButtonStyle.label(for: role, destructive: configuration.role == .destructive, scheme: scheme)
        }

        private var fill: Color {
            if dropsFill { return .clear }
            return MacButtonStyle.fill(for: role, scheme: scheme, container: container, state: state) ?? .clear
        }

        private var filled: some View {
            configuration.label
                .macButtonMetrics(size)
                .foregroundStyle(labelColor)
                .background(fill, in: .rect(cornerRadius: MacButtonStyle.radius))
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
                .macFocusRing(isFocused, cornerRadius: MacButtonStyle.radius)
        }

        /// Words at a button's height, so a Text button lines up beside a filled one.
        private var text: some View {
            configuration.label
                .font(size == .small ? MacStyle.label : MacStyle.body)
                .lineLimit(1)
                .foregroundStyle(labelColor)
                .underline(state != .rest)
                .frame(minHeight: size.height)
                .contentShape(.rect)
                .opacity(state == .pressed ? 0.7 : 1)
                .macFocusRing(isFocused, cornerRadius: MacButtonStyle.radius)
        }

        /// A circle around a glyph, widening to a capsule around a word.
        private var icon: some View {
            let fill = MacButtonStyle.iconFillRGB(isOn: isOn, state: state, scheme: scheme, container: container)
            return configuration.label
                .font(MacButtonStyle.font(size))
                .imageScale(size == .small ? .medium : .large)
                .lineLimit(1)
                .foregroundStyle(MacButtonStyle.iconLabelRGB(isOn: isOn, state: state, scheme: scheme).color)
                // Turning on springs the glyph from 80% to full; turning off changes nothing.
                .keyframeAnimator(initialValue: 1.0, trigger: glyphSprings) { view, scale in
                    view.scaleEffect(scale)
                } keyframes: { _ in
                    MoveKeyframe(0.8)
                    SpringKeyframe(1, spring: MacMotion.springCurve)
                }
                .padding(.horizontal, size == .small ? 4 : 6)
                .frame(minWidth: size.iconDiameter, minHeight: size.iconDiameter)
                .background {
                    Capsule().fill(fill?.color ?? .clear)
                        .animation(MacMotion.animation(MacMotion.state, reduceMotion: reduceMotion), value: isOn)
                }
                .contentShape(.capsule)
                .macFocusRing(isFocused, shape: Capsule())
                .accessibilityAddTraits(isOn == true ? .isSelected : [])
                .onChange(of: isOn) { _, isOn in
                    guard isOn == true, !reduceMotion else { return }
                    glyphSprings += 1
                }
        }
    }
#endif
