#if os(macOS)
    import SwiftUI

    /// Sizes and shapes every Mac control shares.
    package enum MacControl {
        package static let smallHeight: CGFloat = 24
        package static let regularHeight: CGFloat = 28
        package static let largeHeight: CGFloat = 32
        package static let rowMinHeight: CGFloat = 32
        /// Rectangular controls.
        package static let radius: CGFloat = 7
        /// A shape inside a control that already has ``radius``.
        package static let innerRadius: CGFloat = 5
        package static let cardRadius: CGFloat = 10
        package static let disabledOpacity = 0.45
        package static let focusRingWidth: CGFloat = 2
        /// The full accent: a partial one falls under 3:1 on a control's fill.
        package nonisolated static let focusRingToken = Palette.Token.accent
    }

    /// Mac animations. Every use goes through ``macAnimation(_:value:)`` so Reduce Motion
    /// turns them all off.
    package enum MacMotion {
        package static let hover: Animation = .easeOut(duration: 0.12)
        package static let state: Animation = .snappy(duration: 0.2)
        package static let springCurve = Spring(duration: 0.26, bounce: 0.15)
        package static let spring: Animation = .spring(springCurve)

        package static func animation(_ animation: Animation, reduceMotion: Bool) -> Animation? {
            reduceMotion ? nil : animation
        }
    }

    extension View {
        /// Animates `value` changes with `animation`, or not at all under Reduce Motion.
        package func macAnimation<V: Equatable>(_ animation: Animation, value: V) -> some View {
            modifier(MacAnimationModifier(animation: animation, value: value))
        }
    }

    private struct MacAnimationModifier<V: Equatable>: ViewModifier {
        let animation: Animation
        let value: V
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        func body(content: Content) -> some View {
            content.animation(MacMotion.animation(animation, reduceMotion: reduceMotion), value: value)
        }
    }

    /// The pointer state a control draws.
    package enum MacPressState: Equatable {
        case rest, hover, pressed

        /// The state a control draws: a gallery's `preview` when set, else the live pointer. A
        /// disabled control rests.
        package static func live(preview: Self?, isEnabled: Bool, isPressed: Bool, isHovered: Bool) -> Self {
            if let preview { return preview }
            guard isEnabled else { return .rest }
            if isPressed { return .pressed }
            return isHovered ? .hover : .rest
        }

        /// How strongly `textPrimary` shows in ``overlay``.
        package nonisolated var overlayOpacity: Double {
            switch self {
            case .rest: 0
            case .hover: Palette.hoverOverlayOpacity
            case .pressed: Palette.pressedOverlayOpacity
            }
        }

        /// The overlay a control lays over its own opaque fill in this state.
        package var overlay: Color {
            switch self {
            case .rest: .clear
            case .hover: Palette.hoverOverlay
            case .pressed: Palette.pressedOverlay
            }
        }
    }

    /// A plain style wrapped as a primitive one, so the system focus effect is off on the button
    /// itself, since that setting flows down from ancestors and a plain style's body sits inside
    /// the button, and so the style learns its focus from ``View/macButtonFocus()``.
    package struct MacFocusEffectOff<Style: ButtonStyle>: PrimitiveButtonStyle {
        private let style: Style

        package init(_ style: Style) {
            self.style = style
        }

        package func makeBody(configuration: Configuration) -> some View {
            Button(configuration)
                .buttonStyle(style)
                .focusEffectDisabled()
                .macButtonFocus()
        }
    }

    /// The pointer over a Mac control: its hover, and the state it draws from that, a press, and
    /// a gallery's preview. The control applies ``View/macPointer(_:state:)`` to track the hover.
    package struct MacPointer: DynamicProperty {
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewState) private var previewState
        @State private var hovered = false

        package init() {}

        package var isHovered: Bool { hovered }

        package func state(isPressed: Bool) -> MacPressState {
            .live(preview: previewState, isEnabled: isEnabled, isPressed: isPressed, isHovered: hovered)
        }

        fileprivate func setHovered(_ isHovered: Bool) {
            hovered = isHovered
        }
    }

    extension View {
        /// Tracks the hover for `pointer` and eases the control into `state`.
        package func macPointer(_ pointer: MacPointer, state: MacPressState) -> some View {
            onHover(perform: pointer.setHovered).macPressAnimation(state)
        }
    }

    extension View {
        /// Eases hover and release with ``MacMotion/hover``; a press lands at once.
        package func macPressAnimation(_ state: MacPressState) -> some View {
            modifier(MacPressAnimationModifier(state: state))
        }
    }

    private struct MacPressAnimationModifier: ViewModifier {
        let state: MacPressState
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        func body(content: Content) -> some View {
            content.animation(
                state == .pressed ? nil : MacMotion.animation(MacMotion.hover, reduceMotion: reduceMotion), value: state
            )
        }
    }

    extension MacControl {
        /// How strongly the accent shows in a tinted control's fill. A hover or a press steps to
        /// `tintStrong`, the strongest tint an accent label holds 4.5:1 on; an overlay on `tint`
        /// would fall short of that on a surface in light mode.
        package static func tintFillOpacity(_ state: MacPressState, scheme: ColorScheme) -> Double {
            state == .rest ? Palette.tintOpacity(scheme) : Palette.tintStrongOpacity(scheme)
        }

        /// The fill a tinted control draws in `state`.
        package static func tintFill(_ state: MacPressState, scheme: ColorScheme) -> Color {
            state == .rest ? Palette.tint(scheme) : Palette.tintStrong(scheme)
        }
    }

    extension EnvironmentValues {
        /// A style draws this state instead of its live one, so a gallery can show each state.
        @Entry package var macPreviewState: MacPressState?
    }
#endif
