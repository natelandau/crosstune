#if os(macOS)
    import AppKit
    import SwiftUI

    /// A slider without step tick marks. Where it has a detent (no shift, normal speed) a short
    /// mark sits on the track, a drag near it settles on it with a trackpad tap, and the stretch
    /// between the detent and the value shows in the accent as a value that is set. One keyboard
    /// stop whose arrows move it by `step`, and adjustable under VoiceOver.
    package struct MacSlider: View {
        package static let height: CGFloat = 20
        package static let trackHeight: CGFloat = 4
        package static let thumbDiameter: CGFloat = 16
        /// How much the thumb grows under the pointer and while dragged.
        package static let activeThumbScale: CGFloat = 1.12
        /// How near the detent, as a share of the range, a value settles on it.
        nonisolated package static let detentReach = 0.01

        @Binding private var value: Double
        private let range: ClosedRange<Double>
        private let detent: Double?
        private let step: Double
        private let snapsToStep: Bool
        private let detentReach: Double
        private let accessibilityLabel: String
        private let accessibilityValue: String?

        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool
        @GestureState private var isDragging = false
        @State private var isHovered = false
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewState) private var previewState
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        /// - Parameters:
        ///   - step: How far an arrow key or a VoiceOver swipe moves the value.
        ///   - snapsToStep: Whether a drag also lands only on whole steps from the range's start.
        ///   - detentReach: How near the detent, as a share of the range, a drag settles on it.
        ///   - accessibilityValue: What VoiceOver reads for the value, or the value as a whole
        ///     number when nil.
        package init(
            value: Binding<Double>, in range: ClosedRange<Double>, detent: Double?, accessibilityLabel: String,
            step: Double = 1, snapsToStep: Bool = false, detentReach: Double = MacSlider.detentReach,
            accessibilityValue: String? = nil
        ) {
            _value = value
            self.range = range
            self.detent = detent
            self.step = step
            self.snapsToStep = snapsToStep
            self.detentReach = detentReach
            self.accessibilityLabel = accessibilityLabel
            self.accessibilityValue = accessibilityValue
        }

        /// `raw` on the `step` grid from the range's start when one is given, clamped to `range`,
        /// or the detent when it is within `reach` of it, as a share of the range.
        package nonisolated static func snapped(
            _ raw: Double, in range: ClosedRange<Double>, detent: Double?, step: Double? = nil,
            reach: Double = detentReach
        ) -> Double {
            let held = min(max(raw, range.lowerBound), range.upperBound)
            var gridded = held
            if let step { gridded = range.lowerBound + ((held - range.lowerBound) / step).rounded() * step }
            let clamped = min(max(gridded, range.lowerBound), range.upperBound)
            if let detent, abs(held - detent) <= (range.upperBound - range.lowerBound) * reach {
                return detent
            }
            return clamped
        }

        package static func stepped(_ value: Double, by delta: Double, in range: ClosedRange<Double>) -> Double {
            min(max(value + delta, range.lowerBound), range.upperBound)
        }

        /// Whether a change from `old` to `new` lands on the detent, so the snap haptic fires once
        /// as a drag arrives and never while it stays there.
        package static func entersDetent(from old: Double, to new: Double, detent: Double?) -> Bool {
            guard let detent else { return false }
            return new == detent && old != detent
        }

        private var isOnDetent: Bool { detent == value }

        /// The thumb grows under the pointer and while dragged; under Reduce Motion it keeps its
        /// size.
        private var thumbScale: CGFloat {
            guard !reduceMotion else { return 1 }
            let active =
                previewState.map { $0 != .rest } ?? (isEnabled && (isHovered || isDragging))
            return active ? Self.activeThumbScale : 1
        }

        package var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let thumbX = x(of: value, width: width)
                let anchorX = x(of: detent ?? range.lowerBound, width: width)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Palette.borderStrong)
                        .frame(height: Self.trackHeight)
                    Capsule()
                        .fill(Palette.accent)
                        .frame(width: abs(thumbX - anchorX), height: Self.trackHeight)
                        .offset(x: min(thumbX, anchorX))
                    if let detent {
                        Capsule()
                            .fill(isOnDetent ? Palette.accent : Palette.textSecondary)
                            .frame(width: 2, height: 10)
                            .offset(x: x(of: detent, width: width) - 1)
                            .macAnimation(MacMotion.state, value: isOnDetent)
                    }
                    Circle()
                        .fill(scheme == .dark ? Palette.textPrimary : Palette.surfaceRaised)
                        .overlay { Circle().strokeBorder(Palette.border) }
                        .elevation(.control)
                        .frame(width: Self.thumbDiameter, height: Self.thumbDiameter)
                        .scaleEffect(thumbScale)
                        .macAnimation(MacMotion.hover, value: thumbScale)
                        // Outside the grown thumb's edge too, so the ring never overlaps it.
                        .macFocusRing(
                            focused || previewFocused,
                            shape: Circle().inset(by: -Self.thumbDiameter * (thumbScale - 1) / 2)
                        )
                        .offset(x: thumbX - Self.thumbDiameter / 2)
                }
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .onHover { isHovered = $0 }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .updating($isDragging) { _, dragging, _ in dragging = true }
                        .onChanged { drag in
                            let usable = max(1, width - Self.thumbDiameter)
                            let share = (drag.location.x - Self.thumbDiameter / 2) / usable
                            let next = Self.snapped(
                                range.lowerBound + Double(share) * (range.upperBound - range.lowerBound),
                                in: range, detent: detent, step: snapsToStep ? step : nil, reach: detentReach)
                            if Self.entersDetent(from: value, to: next, detent: detent) {
                                NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
                            }
                            value = next
                        }
                )
            }
            .frame(height: Self.height)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macFocusable()
            .focused($focused)
            .accessibilityElement()
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(accessibilityValue ?? String(Int(value.rounded())))
            .macStepCommands(isAdjustable: true) { direction in
                value = Self.stepped(value, by: Double(direction) * step, in: range)
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
