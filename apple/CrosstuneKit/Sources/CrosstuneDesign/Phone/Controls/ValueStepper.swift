import SwiftUI

/// A whole-number value changed one step at a time: one capsule with a minus half, the value,
/// and a plus half. Holding a half repeats the step until the value reaches its bound. The
/// capsule is one focus stop whose arrow keys step, and one adjustable element for VoiceOver.
/// On the Mac it draws the Mac stepper at the control size.
package struct ValueStepper: View {
    private let title: String
    @Binding private var value: Int
    private let range: ClosedRange<Int>
    private let step: Int
    private let format: (Int) -> String

    #if os(macOS)
        @Environment(\.controlSize) private var controlSize
    #endif

    package init(
        _ title: String, value: Binding<Int>, in range: ClosedRange<Int>, step: Int = 1,
        format: @escaping (Int) -> String
    ) {
        self.title = title
        _value = value
        self.range = range
        self.step = step
        self.format = format
    }

    private func canStep(_ direction: Int) -> Bool {
        StepperModel.canStep(value, by: step * direction, in: range)
    }

    private func move(_ direction: Int) {
        value = StepperModel.stepped(value, by: step * direction, in: range)
    }

    package var body: some View {
        #if os(macOS)
            MacStepper(
                value: format(value), decrement: { move(-1) }, increment: { move(1) },
                canDecrement: canStep(-1), canIncrement: canStep(1), accessibilityLabel: title,
                size: MacButtonStyle.Size(controlSize))
        #else
            PhoneValueStepper(
                title: title, value: format(value), lowerText: format(range.lowerBound),
                upperText: format(range.upperBound),
                rollValue: Double(value), canDecrement: canStep(-1), canIncrement: canStep(1),
                step: { direction in
                    guard let next = StepperModel.repeated(value, by: step * direction, in: range) else {
                        return false
                    }
                    value = next
                    return true
                })
        #endif
    }
}

#if !os(macOS)
    private struct PhoneValueStepper: View {
        let title: String
        let value: String
        /// Both bounds' text, laid out hidden so the widest sizes the value and the capsule never
        /// resizes.
        let lowerText: String
        let upperText: String
        let rollValue: Double
        let canDecrement: Bool
        let canIncrement: Bool
        /// Steps once in a direction and reports whether the value moved.
        let step: (Int) -> Bool

        @Environment(\.isEnabled) private var isEnabled
        @FocusState private var focused: Bool

        var body: some View {
            HStack(spacing: 0) {
                StepperHalf(glyph: "minus", direction: -1, isLive: canDecrement && isEnabled, step: step)
                valueText
                StepperHalf(glyph: "plus", direction: 1, isLive: canIncrement && isEnabled, step: step)
            }
            .frame(height: ControlMetrics.compactHeight)
            .background(AnyShapeStyle(.neutralFill), in: .capsule)
            .clipShape(.capsule)
            .tapTarget(visibleHeight: ControlMetrics.compactHeight)
            .dynamicTypeSize(...DynamicTypeSize.large)
            .libraryFocus($focused, isFocusable: isEnabled, shape: Capsule())
            .onKeyPress(.leftArrow) { arrow(-1) }
            .onKeyPress(.downArrow) { arrow(-1) }
            .onKeyPress(.rightArrow) { arrow(1) }
            .onKeyPress(.upArrow) { arrow(1) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
            .accessibilityValue(value)
            .accessibilityShowsLargeContentViewer {
                Text(verbatim: "\(title) \(value)")
            }
            .accessibilityAdjustableAction { direction in
                guard isEnabled else { return }
                switch direction {
                case .increment: _ = step(1)
                case .decrement: _ = step(-1)
                @unknown default: break
                }
            }
        }

        private var valueText: some View {
            ZStack {
                Text(lowerText).hidden()
                Text(upperText).hidden()
                Text(value)
                    .contentTransition(.numericText(value: rollValue))
                    .phoneAnimation(Motion.state, value: rollValue)
            }
            .font(.body.weight(.semibold))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(isEnabled ? Palette.textPrimary : Palette.onDisabled)
            .padding(.horizontal, 8)
            // Held at the widest value's width, so a row that runs short squeezes its neighbors
            // and never truncates the value.
            .fixedSize(horizontal: true, vertical: false)
            .frame(minWidth: 56, maxHeight: .infinity)
            .overlay(alignment: .leading) { Rectangle().fill(Palette.border).frame(width: 0.5) }
            .overlay(alignment: .trailing) { Rectangle().fill(Palette.border).frame(width: 0.5) }
            .accessibilityHidden(true)
        }

        private func arrow(_ direction: Int) -> KeyPress.Result {
            guard focused, isEnabled else { return .ignored }
            _ = step(direction)
            return .handled
        }
    }

    /// One half. Its touch is a `GestureState`, which resets when the touch ends or the system
    /// cancels it, so a half that becomes inert mid-press never stays pressed. A touch on one half
    /// never reaches the other.
    private struct StepperHalf: View {
        let glyph: String
        let direction: Int
        let isLive: Bool
        let step: (Int) -> Bool

        @GestureState private var isDown = false
        @State private var repeating: Task<Void, Never>?

        private var isPressed: Bool { isDown && isLive }

        var body: some View {
            Image(systemName: glyph)
                .font(.body.weight(.semibold))
                .foregroundStyle(isLive ? Palette.textPrimary : Palette.onDisabled)
                .pressScale(isPressed, to: 0.85)
                .frame(width: 44)
                .frame(maxHeight: .infinity)
                // Two hover overlays stacked read as the darker pressed shade.
                .background {
                    if isPressed {
                        Rectangle().fill(Palette.hoverOverlay)
                        Rectangle().fill(Palette.hoverOverlay)
                    }
                }
                .animation(Motion.press, value: isPressed)
                .contentShape(.rect)
                .libraryHover(.rect, isEnabled: isLive)
                .gesture(DragGesture(minimumDistance: 0).updating($isDown) { _, state, _ in state = true })
                .onChange(of: isDown) { _, down in
                    if down { begin() } else { end() }
                }
                .onChange(of: isLive) { _, live in
                    if !live { end() }
                }
                .onDisappear { end() }
                .accessibilityHidden(true)
        }

        private func begin() {
            guard isLive, step(direction) else { return }
            repeating = Task {
                do { try await Task.sleep(for: Motion.repeatDelay) } catch { return }
                while !Task.isCancelled, step(direction) {
                    do { try await Task.sleep(for: Motion.repeatInterval) } catch { return }
                }
            }
        }

        private func end() {
            repeating?.cancel()
            repeating = nil
        }
    }
#endif

#Preview("Stepper") {
    @Previewable @State var semitones = 2
    ValueStepper("Semitones", value: $semitones, in: -12...12) { $0 > 0 ? "+\($0)" : "\($0)" }
        .padding()
}
