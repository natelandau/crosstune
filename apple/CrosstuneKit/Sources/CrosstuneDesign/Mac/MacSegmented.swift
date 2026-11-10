#if os(macOS)
    import AppKit
    import SwiftUI

    /// A token segmented control: the chosen segment a raised token on the container's control
    /// fill, each segment's label in the primary text color with an optional ``Badge`` after it. It keeps its fills in an inactive window, unlike the system control, so the
    /// choice in use stays plain. One keyboard stop whose arrows move the choice; VoiceOver reads
    /// it as the system's segmented picker.
    package struct MacSegmented<Value: Hashable>: View {
        @Binding private var selection: Value
        private let options: [Value]
        private let label: (Value) -> String
        private let badge: (Value) -> String?
        private let badgeKind: Badge.Kind
        private let title: String
        private let size: MacButtonStyle.Size
        private let fillsWidth: Bool

        /// - Parameters:
        ///   - title: What VoiceOver names the control.
        ///   - fillsWidth: Whether the segments share the width offered, so the control lines up
        ///     with a panel under it, rather than hugging their labels.
        package init(
            selection: Binding<Value>, options: [Value], label: @escaping (Value) -> String,
            badge: @escaping (Value) -> String? = { _ in nil }, badgeKind: Badge.Kind = .neutral, title: String = "",
            size: MacButtonStyle.Size = .regular, fillsWidth: Bool = false
        ) {
            _selection = selection
            self.options = options
            self.label = label
            self.badge = badge
            self.badgeKind = badgeKind
            self.title = title
            self.size = size
            self.fillsWidth = fillsWidth
        }

        /// The chosen token's fill, which with the token's shadow raises it off the track. It
        /// reads only the appearance and the container, never whether the window is key, so the
        /// choice in use stays plain in an inactive window.
        package static func chosenFillToken(on container: MacContainer) -> Palette.Token {
            switch container {
            case .pageBackground: .surfaceRaised
            case .surface: .pageBackground
            }
        }

        package var body: some View {
            MacSegmentTrack(
                title: title, chosen: selection,
                options: options.map {
                    MacSegmentTrack.Option(value: $0, label: label($0), badge: badge($0), badgeKind: badgeKind)
                },
                size: size, fillsWidth: fillsWidth
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
            package var badgeKind: Badge.Kind = .neutral
        }

        package static var radius: CGFloat { MacControl.radius }
        package static var inset: CGFloat { 2 }
        package static var segmentRadius: CGFloat { MacControl.innerRadius }

        package let title: String
        package let chosen: Value?
        package let options: [Option]
        package var size: MacButtonStyle.Size = .regular
        package var fillsWidth = false
        package let choose: (Value) -> Void

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool
        @Namespace private var token

        private var isFocused: Bool { focused || previewFocused }

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
                        label: option.label, badge: option.badge, badgeKind: option.badgeKind,
                        isChosen: option.value == chosen, size: size,
                        chosenFill: Palette.color(MacSegmented<Value>.chosenFillToken(on: container)), token: token,
                        showsRing: isFocused && option.value == chosen
                    ) {
                        choose(option.value)
                    }
                }
            }
            .padding(Self.inset)
            .frame(height: size.height)
            .background(container.controlColor, in: .rect(cornerRadius: Self.radius))
            .macControlEdge(container, scheme: scheme, cornerRadius: Self.radius)
            .macAnimation(MacMotion.spring, value: chosen)
            // With no segment chosen the ring goes round the whole control.
            .macFocusRing(isFocused && chosen == nil, cornerRadius: Self.radius)
            .fixedSize(horizontal: !fillsWidth, vertical: true)
            .macFocusable()
            .focused($focused)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macStepCommands(isAdjustable: false) { step in
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
        let badgeKind: Badge.Kind
        let isChosen: Bool
        let size: MacButtonStyle.Size
        let chosenFill: Color
        let token: Namespace.ID
        let showsRing: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                HStack(spacing: 5) {
                    MacSteadyWidthLabel(isSemibold: isChosen) { weight in
                        Text(label)
                            .font(weight == .semibold ? font.weight(.semibold) : font)
                            .foregroundStyle(Palette.textPrimary)
                    }
                    if let badge {
                        Badge(badge, kind: badgeKind)
                    }
                }
            }
            .buttonStyle(MacSegmentStyle(isChosen: isChosen, size: size, chosenFill: chosenFill, token: token))
            // The track is the one focus stop; a segment never takes focus on its own.
            .focusable(false)
            .macFocusRing(showsRing, cornerRadius: MacSegmentTrack<Int>.segmentRadius)
        }

        private var font: Font { size == .small ? MacStyle.label.weight(.regular) : MacStyle.body }
    }

    private struct MacSegmentStyle: ButtonStyle {
        let isChosen: Bool
        let size: MacButtonStyle.Size
        let chosenFill: Color
        let token: Namespace.ID

        func makeBody(configuration: Configuration) -> some View {
            MacSegmentBody(
                configuration: configuration, isChosen: isChosen, size: size, chosenFill: chosenFill, token: token)
        }
    }

    private struct MacSegmentBody: View {
        let configuration: ButtonStyle.Configuration
        let isChosen: Bool
        let size: MacButtonStyle.Size
        let chosenFill: Color
        let token: Namespace.ID

        private var pointer = MacPointer()

        private static var radius: CGFloat { MacSegmentTrack<Int>.segmentRadius }

        var body: some View {
            configuration.label
                .lineLimit(1)
                .padding(.horizontal, size == .small ? 10 : 14)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    if isChosen {
                        RoundedRectangle(cornerRadius: Self.radius)
                            .fill(chosenFill)
                            .elevation(.control)
                            .matchedGeometryEffect(id: "token", in: token)
                    } else {
                        RoundedRectangle(cornerRadius: Self.radius)
                            .fill(state.overlay)
                    }
                }
                .contentShape(.rect(cornerRadius: Self.radius))
                .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }
#endif
