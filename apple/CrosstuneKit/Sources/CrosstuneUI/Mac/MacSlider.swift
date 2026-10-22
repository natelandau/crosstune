#if os(macOS)
    import SwiftUI

    /// A slider without step tick marks. Where it has a detent (no shift, normal speed) a short
    /// mark sits on the track, a drag near it settles on it, and the stretch between the detent
    /// and the value shows in the accent as a value that is set. One keyboard stop whose arrows
    /// move it by `step`, and adjustable under VoiceOver.
    struct MacSlider: View {
        static let height: CGFloat = 20
        static let trackHeight: CGFloat = 4
        static let thumbDiameter: CGFloat = 16
        /// How near the detent, as a share of the range, a value settles on it.
        static let detentReach = 0.01

        @Binding private var value: Double
        private let range: ClosedRange<Double>
        private let detent: Double?
        private let step: Double
        private let accessibilityLabel: String
        private let accessibilityValue: String?

        @FocusState private var focused: Bool
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled

        /// - Parameters:
        ///   - step: How far an arrow key or a VoiceOver swipe moves the value.
        ///   - accessibilityValue: What VoiceOver reads for the value, or the value as a whole
        ///     number when nil.
        init(
            value: Binding<Double>, in range: ClosedRange<Double>, detent: Double?, accessibilityLabel: String,
            step: Double = 1, accessibilityValue: String? = nil
        ) {
            _value = value
            self.range = range
            self.detent = detent
            self.step = step
            self.accessibilityLabel = accessibilityLabel
            self.accessibilityValue = accessibilityValue
        }

        /// `raw` clamped to `range`, or the detent when it is within ``detentReach`` of it.
        static func snapped(_ raw: Double, in range: ClosedRange<Double>, detent: Double?) -> Double {
            let clamped = min(max(raw, range.lowerBound), range.upperBound)
            if let detent, abs(clamped - detent) <= (range.upperBound - range.lowerBound) * detentReach {
                return detent
            }
            return clamped
        }

        static func stepped(_ value: Double, by delta: Double, in range: ClosedRange<Double>) -> Double {
            min(max(value + delta, range.lowerBound), range.upperBound)
        }

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let thumbX = x(of: value, width: width)
                let anchorX = x(of: detent ?? range.lowerBound, width: width)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(MacPalette.inkSecondary.opacity(0.25))
                        .frame(height: Self.trackHeight)
                    Capsule()
                        .fill(MacPalette.accent)
                        .frame(width: abs(thumbX - anchorX), height: Self.trackHeight)
                        .offset(x: min(thumbX, anchorX))
                    if let detent {
                        Capsule()
                            .fill(MacPalette.inkSecondary)
                            .frame(width: 2, height: 10)
                            .offset(x: x(of: detent, width: width) - 1)
                    }
                    Circle()
                        .fill(scheme == .dark ? MacPalette.ink : .white)
                        .overlay { Circle().strokeBorder(MacPalette.hairline) }
                        .shadow(color: .black.opacity(0.2), radius: 1.5, y: 0.5)
                        .frame(width: Self.thumbDiameter, height: Self.thumbDiameter)
                        .macFocusRing(focused, cornerRadius: Self.thumbDiameter / 2)
                        .offset(x: thumbX - Self.thumbDiameter / 2)
                }
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { drag in
                            let usable = max(1, width - Self.thumbDiameter)
                            let share = (drag.location.x - Self.thumbDiameter / 2) / usable
                            value = Self.snapped(
                                range.lowerBound + Double(share) * (range.upperBound - range.lowerBound),
                                in: range, detent: detent)
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
                case .left, .down: value = Self.stepped(value, by: -step, in: range)
                case .right, .up: value = Self.stepped(value, by: step, in: range)
                @unknown default: break
                }
            }
            .accessibilityElement()
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(accessibilityValue ?? String(Int(value.rounded())))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: value = Self.stepped(value, by: step, in: range)
                case .decrement: value = Self.stepped(value, by: -step, in: range)
                @unknown default: break
                }
            }
        }

        /// The thumb's center for `value` in a slider `width` wide; the thumb stays inside it.
        private func x(of value: Double, width: CGFloat) -> CGFloat {
            let span = range.upperBound - range.lowerBound
            let share = span > 0 ? (min(max(value, range.lowerBound), range.upperBound) - range.lowerBound) / span : 0
            return Self.thumbDiameter / 2 + CGFloat(share) * max(0, width - Self.thumbDiameter)
        }
    }
#endif
