#if os(macOS)
    import SwiftUI

    /// A stepper capsule, `[ − | value | + ]`, on the container's control fill. One keyboard
    /// stop whose arrows step the value, and one VoiceOver element that is adjustable; the halves
    /// take the pointer, and holding one repeats.
    package struct MacStepper: View {
        package static let valueMinWidth: CGFloat = 44

        /// A half's glyph dims only at its limit. A disabled stepper dims as a whole, so its
        /// halves never dim again on top of that.
        package static func glyphOpacity(atLimit: Bool, isControlEnabled: Bool) -> Double {
            atLimit && isControlEnabled ? MacControl.disabledOpacity : 1
        }

        private let value: String
        private let decrement: () -> Void
        private let increment: () -> Void
        private let canDecrement: Bool
        private let canIncrement: Bool
        private let accessibilityLabel: String
        private let size: MacButtonStyle.Size

        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool
        /// The side of the stepper's own last step, -1 or 1, which the new value slides in from.
        @State private var pressDirection = 1
        /// The value shown when the stepper itself stepped, until the value changes. Nil when the
        /// next change comes from outside, which cross-fades instead of sliding.
        @State private var steppedFrom: String?
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macContainer) private var container

        package init(
            value: String, decrement: @escaping () -> Void, increment: @escaping () -> Void, canDecrement: Bool,
            canIncrement: Bool, accessibilityLabel: String, size: MacButtonStyle.Size = .regular
        ) {
            self.value = value
            self.decrement = decrement
            self.increment = increment
            self.canDecrement = canDecrement
            self.canIncrement = canIncrement
            self.accessibilityLabel = accessibilityLabel
            self.size = size
        }

        package var body: some View {
            HStack(spacing: 0) {
                MacStepperHalf(
                    systemImage: "minus", size: size, isLive: canDecrement, isControlEnabled: isEnabled
                ) { step(-1) }
                divider
                ZStack {
                    Text(value)
                        .font(MacStyle.body.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.textPrimary)
                        .lineLimit(1)
                        .id(value)
                        .transition(valueTransition)
                }
                .frame(minWidth: Self.valueMinWidth, maxHeight: .infinity)
                .padding(.horizontal, 4)
                .clipped()
                .macAnimation(MacMotion.state, value: value)
                .onChange(of: value) { steppedFrom = nil }
                divider
                MacStepperHalf(
                    systemImage: "plus", size: size, isLive: canIncrement, isControlEnabled: isEnabled
                ) { step(1) }
            }
            .frame(height: size.height)
            .background(container.controlColor, in: .capsule)
            .clipShape(.capsule)
            .macControlEdge(container, scheme: scheme, cornerRadius: size.height / 2)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macFocusRing(focused || previewFocused, shape: Capsule())
            .fixedSize()
            .macFocusable()
            .focused($focused)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(value)
            .macStepCommands(isAdjustable: true) { direction in
                if direction < 0 ? canDecrement : canIncrement { step(direction) }
            }
        }

        private func step(_ direction: Int) {
            pressDirection = direction
            steppedFrom = value
            if direction < 0 { decrement() } else { increment() }
        }

        private var valueTransition: AnyTransition {
            guard let steppedFrom, steppedFrom != value else { return .opacity }
            return .asymmetric(
                insertion: .move(edge: pressDirection < 0 ? .leading : .trailing).combined(with: .opacity),
                removal: .opacity)
        }

        private var divider: some View {
            Rectangle()
                .fill(Palette.border)
                .frame(width: 1, height: size.height - 12)
        }
    }

    /// A Button, so a press that slides off before release never fires, as on any Mac button.
    /// The stepper is the one keyboard stop, so a half takes no focus of its own. At a limit the
    /// half dims and ignores the pointer.
    private struct MacStepperHalf: View {
        let systemImage: String
        let size: MacButtonStyle.Size
        let isLive: Bool
        let isControlEnabled: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
            }
            .buttonStyle(
                MacStepperHalfStyle(
                    size: size,
                    glyphOpacity: MacStepper.glyphOpacity(atLimit: !isLive, isControlEnabled: isControlEnabled))
            )
            .buttonRepeatBehavior(.enabled)
            .disabled(!isLive)
            .focusable(false)
        }
    }

    private struct MacStepperHalfStyle: ButtonStyle {
        let size: MacButtonStyle.Size
        let glyphOpacity: Double

        func makeBody(configuration: Configuration) -> some View {
            MacStepperHalfBody(configuration: configuration, size: size, glyphOpacity: glyphOpacity)
        }
    }

    private struct MacStepperHalfBody: View {
        let configuration: ButtonStyle.Configuration
        let size: MacButtonStyle.Size
        let glyphOpacity: Double

        private var pointer = MacPointer()

        var body: some View {
            configuration.label
                .foregroundStyle(Palette.textPrimary)
                .opacity(glyphOpacity)
                .frame(width: size.height, height: size.height)
                .background(state.overlay)
                .contentShape(.rect)
                .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }
#endif
