import SwiftUI

/// The iPhone icon button: a 44pt circle holding one glyph, bare or on a neutral fill, or a
/// Compact disc of the tint holding a glyph or initials, for a button whose disc is its whole look.
/// A button that holds a state passes `isOn`, which tints the circle and the glyph and marks it
/// selected for VoiceOver. On the Mac it draws the Mac icon button at the control size, a Toggle
/// when it holds a state.
package struct IconButtonStyle: PrimitiveButtonStyle {
    package enum Shape { case plain, circled, tintDisc }

    package let shape: Shape
    package let isOn: Bool

    package init(_ shape: Shape = .plain, isOn: Bool = false) {
        self.shape = shape
        self.isOn = isOn
    }

    package func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            MacIconButton(isOn: isOn, configuration: configuration)
        #else
            Button(configuration)
                .buttonStyle(IconButtonAppearance(shape: shape, isOn: isOn))
        #endif
    }
}

extension PrimitiveButtonStyle where Self == IconButtonStyle {
    /// A bare glyph in a 44pt circle.
    package static var icon: Self { IconButtonStyle() }

    /// A glyph in a 44pt circle, circled on a fill when `shape` is `.circled`, and tinted while
    /// `isOn` is true.
    package static func icon(_ shape: IconButtonStyle.Shape = .plain, isOn: Bool = false) -> Self {
        IconButtonStyle(shape, isOn: isOn)
    }
}

extension View {
    /// Gives a menu the icon button's look. A menu takes its look only from a plain button style,
    /// never from `.icon`, which is a primitive one. On the Mac it draws the Mac icon button.
    package func iconButtonMenuAppearance(_ shape: IconButtonStyle.Shape = .plain) -> some View {
        modifier(IconButtonMenuAppearance(shape: shape))
    }
}

private struct IconButtonMenuAppearance: ViewModifier {
    let shape: IconButtonStyle.Shape

    #if os(macOS)
        func body(content: Content) -> some View {
            content.macMenuAppearance(.icon)
        }
    #else
        func body(content: Content) -> some View {
            content.buttonStyle(IconButtonAppearance(shape: shape, isOn: false))
        }
    #endif
}

#if os(macOS)
    private struct MacIconButton: View {
        let isOn: Bool
        let configuration: PrimitiveButtonStyleConfiguration

        @Environment(\.controlSize) private var controlSize

        var body: some View {
            Button(configuration)
                .buttonStyle(MacButtonStyle(.icon, size: MacButtonStyle.Size(controlSize), isOn: isOn))
        }
    }
#endif

#if !os(macOS)
    private struct IconButtonAppearance: ButtonStyle {
        let shape: IconButtonStyle.Shape
        let isOn: Bool

        func makeBody(configuration: Configuration) -> some View {
            IconButtonBody(shape: shape, isOn: isOn, configuration: configuration)
        }
    }

    private struct IconButtonBody: View {
        let shape: IconButtonStyle.Shape
        let isOn: Bool
        let configuration: ButtonStyleConfiguration

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var pops = 0

        @ViewBuilder var body: some View {
            if shape == .tintDisc {
                tintDisc
            } else {
                circle
            }
        }

        private var tintDisc: some View {
            configuration.label
                .font(.footnote.weight(.semibold))
                .foregroundStyle(isEnabled ? Palette.onTint(colorScheme) : Palette.onDisabled)
                .frame(width: ControlMetrics.compactHeight, height: ControlMetrics.compactHeight)
                .background(isEnabled ? Palette.tint(colorScheme) : .clear, in: .circle)
                .disabledCapsuleRing(!isEnabled)
                // The disc does not grow, so its letters stop at the default size and a long press
                // shows the button enlarged.
                .dynamicTypeSize(...DynamicTypeSize.large)
                .pressDim(configuration.isPressed)
                .libraryHover(.circle)
                .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                .contentShape(.rect)
                .accessibilityShowsLargeContentViewer()
        }

        private var circle: some View {
            configuration.label
                .foregroundStyle(glyph)
                // The circle keeps its 44 point size, so the glyph stops growing before it fills it.
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .keyframeAnimator(initialValue: 1.0, trigger: pops) { view, scale in
                    view.scaleEffect(scale)
                } keyframes: { _ in
                    MoveKeyframe(0.8)
                    SpringKeyframe(1, spring: Motion.springCurve)
                }
                .frame(width: minimumTapTarget, height: minimumTapTarget)
                .background(fill, in: .circle)
                .disabledCapsuleRing(!isEnabled && (shape == .circled))
                .pressDim(configuration.isPressed)
                .libraryHover(.circle)
                .contentShape(.circle)
                .accessibilityAddTraits(isOn ? .isSelected : [])
                .accessibilityShowsLargeContentViewer()
                .onChange(of: isOn) { _, nowOn in
                    guard nowOn, !reduceMotion else { return }
                    pops += 1
                }
        }

        private var glyph: Color {
            guard isEnabled else { return Palette.onDisabled }
            return isOn ? Palette.accent : Palette.textPrimary
        }

        private var fill: AnyShapeStyle {
            guard isEnabled else { return AnyShapeStyle(.clear) }
            if isOn { return AnyShapeStyle(Palette.tint(colorScheme)) }
            return shape == .circled ? AnyShapeStyle(.neutralFill) : AnyShapeStyle(.clear)
        }
    }
#endif

#Preview("Icon buttons") {
    HStack {
        Button {
        } label: {
            Image(systemName: "forward.fill")
        }.buttonStyle(.icon)
        Button {
        } label: {
            Image(systemName: "plus")
        }.buttonStyle(.icon(.circled))
        Button {
        } label: {
            Image(systemName: "repeat")
        }.buttonStyle(.icon(isOn: true))
        Button {
        } label: {
            Image(systemName: "plus")
        }.buttonStyle(.icon(.circled)).disabled(true)
    }
    .padding()
}
