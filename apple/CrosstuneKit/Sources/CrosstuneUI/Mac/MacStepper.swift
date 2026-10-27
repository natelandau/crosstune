import CrosstuneDesign

#if os(macOS)
    import SwiftUI

    /// A stepper pill, `[ − | value | + ]`, on the field fill. One keyboard stop whose arrows
    /// step the value, and one VoiceOver element that is adjustable; the halves take the pointer.
    struct MacStepper: View {
        static let height: CGFloat = 28
        static let halfWidth: CGFloat = 28
        static let valueMinWidth: CGFloat = 44

        private let value: String
        private let decrement: () -> Void
        private let increment: () -> Void
        private let canDecrement: Bool
        private let canIncrement: Bool
        private let accessibilityLabel: String

        @FocusState private var focused: Bool

        init(
            value: String, decrement: @escaping () -> Void, increment: @escaping () -> Void, canDecrement: Bool,
            canIncrement: Bool, accessibilityLabel: String
        ) {
            self.value = value
            self.decrement = decrement
            self.increment = increment
            self.canDecrement = canDecrement
            self.canIncrement = canIncrement
            self.accessibilityLabel = accessibilityLabel
        }

        var body: some View {
            HStack(spacing: 0) {
                MacStepperHalf(systemImage: "minus", isEnabled: canDecrement, action: decrement)
                divider
                Text(value)
                    .font(MacStyle.body.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                    .frame(minWidth: Self.valueMinWidth)
                    .padding(.horizontal, 4)
                divider
                MacStepperHalf(systemImage: "plus", isEnabled: canIncrement, action: increment)
            }
            .frame(height: Self.height)
            .background(Palette.field, in: .capsule)
            .clipShape(.capsule)
            .macFocusRing(focused, cornerRadius: Self.height / 2)
            .fixedSize()
            .focusable(interactions: .activate)
            .focused($focused)
            .focusEffectDisabled()
            .onMoveCommand { direction in
                switch direction {
                case .left, .down: if canDecrement { decrement() }
                case .right, .up: if canIncrement { increment() }
                @unknown default: break
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(value)
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: if canIncrement { increment() }
                case .decrement: if canDecrement { decrement() }
                @unknown default: break
                }
            }
        }

        private var divider: some View {
            Rectangle()
                .fill(Palette.border)
                .frame(width: 1, height: Self.height - 12)
        }
    }

    /// A Button, so a press that slides off before release never fires, as on any Mac button.
    /// The stepper is the one keyboard stop, so a half takes no focus of its own.
    private struct MacStepperHalf: View {
        let systemImage: String
        let isEnabled: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
            }
            .buttonStyle(MacStepperHalfStyle())
            .disabled(!isEnabled)
            .focusable(false)
        }
    }

    private struct MacStepperHalfStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            MacStepperHalfBody(configuration: configuration)
        }
    }

    private struct MacStepperHalfBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .foregroundStyle(Palette.textPrimary)
                .frame(width: MacStepper.halfWidth, height: MacStepper.height)
                .background(fill)
                .contentShape(.rect)
                .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
                .onHover { isHovered = $0 }
        }

        private var fill: Color {
            guard isEnabled else { return .clear }
            if configuration.isPressed { return Palette.fieldHover }
            return isHovered ? Palette.border : .clear
        }
    }
#endif
