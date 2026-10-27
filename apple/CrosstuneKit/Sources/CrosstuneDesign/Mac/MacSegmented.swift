#if os(macOS)
    import AppKit
    import SwiftUI

    /// How a Mac segmented control marks its chosen segment.
    package enum MacSegmentLook {
        /// The accent fill under a white label: a form's choice, which is a selection.
        case accent
        /// A token raised off the field track under a primary text label: a control that switches
        /// what a view shows, such as practice's modes, where the accent would shout.
        case token
    }

    /// A token segmented control: the chosen segment a raised token on the field track, each
    /// segment's label in the primary text color with an optional badge after it in secondary text.
    /// It keeps its fills in an inactive window, unlike the system control, so the choice in use
    /// stays plain. One keyboard stop whose arrows move the choice; VoiceOver reads it as the
    /// system's segmented picker.
    package struct MacSegmented<Value: Hashable>: View {
        @Binding private var selection: Value
        private let options: [Value]
        private let label: (Value) -> String
        private let badge: (Value) -> String?
        private let title: String
        private let fillsWidth: Bool

        /// - Parameters:
        ///   - title: What VoiceOver names the control.
        ///   - fillsWidth: Whether the segments share the width offered, so the control lines up
        ///     with a panel under it, rather than hugging their labels.
        package init(
            selection: Binding<Value>, options: [Value], label: @escaping (Value) -> String,
            badge: @escaping (Value) -> String? = { _ in nil }, title: String = "", fillsWidth: Bool = false
        ) {
            _selection = selection
            self.options = options
            self.label = label
            self.badge = badge
            self.title = title
            self.fillsWidth = fillsWidth
        }

        /// The chosen token's fill, lighter than the field track in both appearances so it reads
        /// raised. It reads only the appearance, never whether the window is key, so the choice in
        /// use stays plain in an inactive window.
        package static var chosenFillToken: Palette.Token { .surfaceRaised }
        package static var chosenFill: Color { Palette.color(chosenFillToken) }

        package var body: some View {
            MacSegmentTrack(
                title: title, chosen: selection,
                options: options.map { MacSegmentTrack.Option(value: $0, label: label($0), badge: badge($0)) },
                look: .token, fillsWidth: fillsWidth
            ) { selection = $0 }
        }
    }

    /// The segments, focus, and arrow keys every Mac segmented control shares. A nil `chosen`
    /// shows no segment chosen.
    package struct MacSegmentTrack<Value: Hashable>: View {
        package struct Option {
            package let value: Value
            package let label: String
            package var badge: String?
        }

        package static var height: CGFloat { 28 }
        package static var radius: CGFloat { 7 }
        package static var inset: CGFloat { 2 }
        package static var segmentRadius: CGFloat { 5 }

        package let title: String
        package let chosen: Value?
        package let options: [Option]
        package let look: MacSegmentLook
        package var fillsWidth = false
        package let choose: (Value) -> Void

        @FocusState private var focused: Bool

        /// A segment's spoken name: its label, then its badge when it has one.
        package nonisolated static func spokenName(_ label: String, badge: String?) -> String {
            badge.map { "\(label) \($0)" } ?? label
        }

        /// The value an arrow lands on: the neighbor of the chosen one, clamped to the ends.
        /// With nothing chosen, an arrow chooses the first or last.
        package nonisolated static func moved(_ values: [Value], from chosen: Value?, by step: Int) -> Value? {
            guard !values.isEmpty else { return nil }
            guard let chosen, let index = values.firstIndex(of: chosen) else {
                return step > 0 ? values.first : values.last
            }
            return values[min(max(index + step, 0), values.count - 1)]
        }

        package var body: some View {
            HStack(spacing: Self.inset) {
                ForEach(options, id: \.value) { option in
                    MacSegment(
                        label: option.label, badge: option.badge, isChosen: option.value == chosen, look: look,
                        showsRing: focused && option.value == chosen
                    ) {
                        choose(option.value)
                    }
                }
            }
            .padding(Self.inset)
            .frame(height: Self.height)
            .background(Palette.field, in: .rect(cornerRadius: Self.radius))
            // With no segment chosen the ring goes round the whole control.
            .macFocusRing(focused && chosen == nil, cornerRadius: Self.radius)
            .fixedSize(horizontal: !fillsWidth, vertical: true)
            // Activate only: a click chooses a segment without taking focus, so the ring shows
            // only under keyboard navigation, as on the system control.
            .focusable(interactions: .activate)
            .focused($focused)
            .focusEffectDisabled()
            .onMoveCommand { direction in
                let step: Int
                switch direction {
                case .left: step = -1
                case .right: step = 1
                default: return
                }
                if let next = Self.moved(options.map(\.value), from: chosen, by: step), next != chosen {
                    choose(next)
                }
            }
            .accessibilityRepresentation {
                Picker(
                    title,
                    selection: Binding<Value?> {
                        chosen
                    } set: {
                        if let value = $0 { choose(value) }
                    }
                ) {
                    ForEach(options, id: \.value) { option in
                        Text(Self.spokenName(option.label, badge: option.badge)).tag(Optional(option.value))
                    }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private struct MacSegment: View {
        let label: String
        let badge: String?
        let isChosen: Bool
        let look: MacSegmentLook
        let showsRing: Bool
        let action: () -> Void

        @State private var isHovered = false

        private static var radius: CGFloat { MacSegmentTrack<Int>.segmentRadius }

        var body: some View {
            HStack(spacing: 5) {
                ZStack {
                    // The semibold label's width is held under the regular one, so choosing a
                    // segment never shifts its neighbors.
                    Text(label)
                        .font(MacStyle.body.weight(.semibold))
                        .hidden()
                    Text(label)
                        .font(isChosen ? MacStyle.body.weight(.semibold) : MacStyle.body)
                        .foregroundStyle(labelColor)
                }
                if let badge {
                    Text(badge)
                        .font(MacStyle.label)
                        .monospacedDigit()
                        .foregroundStyle(
                            look == .accent && isChosen ? Palette.onAccentFill : Palette.textSecondary)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                RoundedRectangle(cornerRadius: Self.radius)
                    .fill(fill)
                    .elevation(.control, isShown: raised)
            }
            .contentShape(.rect(cornerRadius: Self.radius))
            .macFocusRing(showsRing, cornerRadius: Self.radius)
            .onTapGesture(perform: action)
            .onHover { isHovered = $0 }
        }

        private var raised: Bool { look == .token && isChosen }

        private var labelColor: Color {
            look == .accent && isChosen ? Palette.onAccentFill : Palette.textPrimary
        }

        private var fill: Color {
            if isChosen {
                return look == .accent ? Palette.accentFill : MacSegmented<Int>.chosenFill
            }
            return isHovered ? Palette.border : .clear
        }
    }
#endif
