import SwiftUI

/// Where a slider settles near its default.
///
/// The reach only gates the haptic and the pulse when the slider's step is as coarse as the
/// reach, as speed's step of 5 is: the zone then holds just the default's grid point, so
/// entering it is a distinct event. With a finer step the value itself settles on the default.
package enum DefaultSnap {
    /// How near the default, as a share of the range's span, a value settles on it.
    package static let reach = 0.04

    /// `value` rounded and held inside `range`, or `defaultValue` when it is within ``reach``
    /// of it.
    package static func snapped(_ value: Double, toward defaultValue: Int, in range: ClosedRange<Int>) -> Int {
        let clamped = min(max(value, Double(range.lowerBound)), Double(range.upperBound))
        let span = Double(range.upperBound - range.lowerBound)
        if abs(clamped - Double(defaultValue)) <= span * reach { return defaultValue }
        return Int(clamped.rounded())
    }

    /// Whether a move from `previous` to `next` enters the default, so a drag that stays on it
    /// is not a new snap and a drag out and back in is.
    package static func entered(from previous: Int, to next: Int, defaultValue: Int) -> Bool {
        next == defaultValue && previous != defaultValue
    }
}

/// The system slider's thumb on the iPhone and iPad, which the default tick and the pulse ring
/// line up with. The thumb travels `width` short of the slider's full width. `width` and
/// `height` are measured from the system slider as drawn on iOS 27, not values the system
/// reports, so they need measuring again when the system thumb changes.
package enum SliderThumb {
    package static let width: CGFloat = 38
    package static let height: CGFloat = 24

    /// The thumb's center for `value`, from the slider's leading edge.
    package static func centerX(of value: Int, in range: ClosedRange<Int>, width sliderWidth: CGFloat) -> CGFloat {
        let span = range.upperBound - range.lowerBound
        let share = span > 0 ? Double(value - range.lowerBound) / Double(span) : 0
        return width / 2 + CGFloat(share) * max(0, sliderWidth - width)
    }
}

/// A whole-number value set by a slider and read from a stepper: the title leads a label line
/// with Reset and the stepper trailing, and the slider takes the full width below. The stepper
/// is the readout, so a drag and a step move one value. A drag settles on the default, with a
/// tick on the track marking it. VoiceOver reads the stepper as the one adjustable element.
/// On the Mac it draws the Mac stepper beside a Mac slider.
package struct ValueSlider: View {
    nonisolated package static let resetName = "Reset"

    private let title: String
    @Binding private var value: Int
    private let range: ClosedRange<Int>
    private let step: Int
    private let defaultValue: Int
    private let canReset: Bool?
    private let onReset: (() -> Void)?
    private let format: (Int) -> String

    /// - Parameters:
    ///   - canReset: Whether Reset is enabled, for a screen whose Reset clears more than this
    ///     value. Nil enables it while the value is off its default.
    ///   - onReset: What Reset does in place of setting the default.
    package init(
        _ title: String, value: Binding<Int>, in range: ClosedRange<Int>, step: Int, defaultValue: Int,
        canReset: Bool? = nil, onReset: (() -> Void)? = nil, format: @escaping (Int) -> String
    ) {
        self.title = title
        _value = value
        self.range = range
        self.step = step
        self.defaultValue = defaultValue
        self.canReset = canReset
        self.onReset = onReset
        self.format = format
    }

    private var resetButton: some View {
        Button(Self.resetName) {
            if let onReset { onReset() } else { value = defaultValue }
        }
        .disabled(!(canReset ?? (value != defaultValue)))
    }

    package var body: some View {
        #if os(macOS)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(MacStyle.label)
                        .foregroundStyle(Palette.textSecondary)
                        .accessibilityHidden(true)
                    Spacer(minLength: 0)
                    resetButton.buttonStyle(.mac(.plain, size: .small))
                }
                .frame(minHeight: MacStyle.smallControlHeight)
                HStack(spacing: 16) {
                    ValueStepper(title, value: $value, in: range, step: step, format: format)
                    MacValueTrack(
                        value: $value, range: range, step: step, defaultValue: defaultValue
                    )
                    // The stepper beside it is the same control for VoiceOver.
                    .accessibilityHidden(true)
                }
            }
        #else
            PhoneValueSlider(
                title: title, value: $value, range: range, step: step, defaultValue: defaultValue,
                format: format, reset: resetButton)
        #endif
    }
}

#if !os(macOS)
    private struct PhoneValueSlider<Reset: View>: View {
        let title: String
        @Binding var value: Int
        let range: ClosedRange<Int>
        let step: Int
        let defaultValue: Int
        let format: (Int) -> String
        let reset: Reset

        @State private var snapCount = 0
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                ValueLabelLine(title) {
                    reset.buttonStyle(.text(oneLine: true))
                } control: {
                    ValueStepper(title, value: $value, in: range, step: step, format: format)
                }
                Slider(
                    value: Binding {
                        Double(value)
                    } set: { raw in
                        let next = DefaultSnap.snapped(raw, toward: defaultValue, in: range)
                        // Only entering the snap zone counts, not every drag step inside it.
                        if DefaultSnap.entered(from: value, to: next, defaultValue: defaultValue) { snapCount += 1 }
                        value = next
                    },
                    in: Double(range.lowerBound)...Double(range.upperBound), step: Double(step)
                )
                .accentTrackTint()
                .accessibilityHidden(true)
                .background { tick }
                .overlay { pulse }
                .sensoryFeedback(.impact(weight: .light), trigger: snapCount)
            }
        }

        /// Beneath the slider, so the thumb covers the tick when it sits on the default.
        private var tick: some View {
            GeometryReader { proxy in
                Capsule()
                    .fill(value == defaultValue ? Palette.accentTrack : Palette.borderStrong)
                    .frame(width: 2, height: 10)
                    .offset(x: SliderThumb.centerX(of: defaultValue, in: range, width: proxy.size.width) - 1)
                    .frame(height: proxy.size.height, alignment: .center)
            }
            .allowsHitTesting(false)
        }

        /// A ring around the thumb that grows and fades on entering the default.
        @ViewBuilder private var pulse: some View {
            if !reduceMotion {
                GeometryReader { proxy in
                    Capsule()
                        .stroke(Palette.accentTrack, lineWidth: 2)
                        .frame(width: SliderThumb.width, height: SliderThumb.height)
                        .phaseAnimator([false, true, false], trigger: snapCount) { ring, grown in
                            ring.scaleEffect(grown ? 1.35 : 1).opacity(grown ? 1 : 0)
                        } animation: { _ in
                            Motion.spring
                        }
                        .offset(
                            x: SliderThumb.centerX(of: value, in: range, width: proxy.size.width)
                                - SliderThumb.width / 2
                        )
                        .frame(height: proxy.size.height, alignment: .center)
                }
                .allowsHitTesting(false)
            }
        }

    }
#else
    /// The Mac slider: a 4 point track with a mark at the default, an accent stretch between the
    /// default and the value, and a 16 point thumb. A drag near the default settles on it.
    private struct MacValueTrack: View {
        @Binding var value: Int
        let range: ClosedRange<Int>
        let step: Int
        let defaultValue: Int

        @FocusState private var focused: Bool
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled

        private static let height: CGFloat = 20
        private static let trackHeight: CGFloat = 4
        private static let thumbDiameter: CGFloat = 16

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let thumbX = x(of: value, width: width)
                let anchorX = x(of: defaultValue, width: width)
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.borderStrong).frame(height: Self.trackHeight)
                    Capsule()
                        .fill(Palette.accent)
                        .frame(width: abs(thumbX - anchorX), height: Self.trackHeight)
                        .offset(x: min(thumbX, anchorX))
                    Capsule()
                        .fill(Palette.textSecondary)
                        .frame(width: 2, height: 10)
                        .offset(x: anchorX - 1)
                    Circle()
                        .fill(scheme == .dark ? Palette.textPrimary : Palette.surfaceRaised)
                        .overlay { Circle().strokeBorder(Palette.border) }
                        .elevation(.control)
                        .frame(width: Self.thumbDiameter, height: Self.thumbDiameter)
                        .macFocusRing(focused, cornerRadius: Self.thumbDiameter / 2)
                        .offset(x: thumbX - Self.thumbDiameter / 2)
                }
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0).onChanged { drag in
                        let usable = max(1, width - Self.thumbDiameter)
                        let share = Double((drag.location.x - Self.thumbDiameter / 2) / usable)
                        let span = Double(range.upperBound - range.lowerBound)
                        let raw = Double(range.lowerBound) + share * span
                        let gridded = (raw / Double(step)).rounded() * Double(step)
                        value = DefaultSnap.snapped(gridded, toward: defaultValue, in: range)
                    }
                )
            }
            .frame(height: Self.height)
            .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
            .focusable(interactions: .activate)
            .focused($focused)
            .focusEffectDisabled()
            .onMoveCommand { direction in
                switch direction {
                case .left, .down: value = StepperModel.stepped(value, by: -step, in: range)
                case .right, .up: value = StepperModel.stepped(value, by: step, in: range)
                @unknown default: break
                }
            }
        }

        private func x(of value: Int, width: CGFloat) -> CGFloat {
            let span = range.upperBound - range.lowerBound
            let share = span > 0 ? Double(value - range.lowerBound) / Double(span) : 0
            return Self.thumbDiameter / 2 + CGFloat(share) * max(0, width - Self.thumbDiameter)
        }
    }
#endif

#Preview("Slider") {
    @Previewable @State var speed = 100
    ValueSlider("Speed", value: $speed, in: 50...125, step: 5, defaultValue: 100) { "\($0)%" }
        .padding()
}
