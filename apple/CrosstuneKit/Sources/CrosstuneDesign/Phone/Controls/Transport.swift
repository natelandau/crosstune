import SwiftUI

/// Back, play and pause, and forward as one control, with previous and next track at its ends
/// where a screen plays a list. `.feature` is the large practice transport with a filled play
/// disc; `.inline` is the small one for a bar. Sides `.hidden` leaves play and pause alone, for a
/// bar with room for one control. No play action draws no play button, for a group whose play
/// is elsewhere on the screen.
package struct Transport: View {
    package enum Size { case feature, inline }
    package enum Sides { case skip15, edges, hidden }

    package static let playName = "Play"
    package static let pauseName = "Pause"
    package static let backName = "Back 15 seconds"
    package static let forwardName = "Forward 15 seconds"
    package static let startName = "Go to start"
    package static let endName = "Go to end"
    nonisolated package static let previousName = "Previous tune"
    nonisolated package static let nextName = "Next tune"
    package static let defaultPlayGlyph = "play.fill"

    package let isPlaying: Bool
    package let size: Size
    package let sides: Sides
    /// The play button's name while paused, for a screen whose play button names its scope.
    package let pausedPlayName: String
    /// The play button's glyph while paused, for a screen whose play repeats a part.
    package let pausedPlayGlyph: String
    package let canPlay: Bool
    package let canGoBack: Bool
    package let canGoForward: Bool
    /// Nil draws no play button.
    package let onPlayPause: (() -> Void)?
    package let onBack: () -> Void
    package let onForward: () -> Void
    /// Nil draws no previous track button.
    package let onPrevious: (() -> Void)?
    /// Nil draws no next track button.
    package let onNext: (() -> Void)?
    package let canGoPrevious: Bool
    package let canGoNext: Bool
    package let previousName: String
    package let nextName: String

    package init(
        isPlaying: Bool, size: Size, sides: Sides = .skip15, playName: String = Transport.playName,
        playGlyph: String = Transport.defaultPlayGlyph, canPlay: Bool = true, canGoBack: Bool = true,
        canGoForward: Bool = true, onPlayPause: (() -> Void)?, onBack: @escaping () -> Void = {},
        onForward: @escaping () -> Void = {}, onPrevious: (() -> Void)? = nil, onNext: (() -> Void)? = nil,
        canGoPrevious: Bool = true, canGoNext: Bool = true, previousName: String = Transport.previousName,
        nextName: String = Transport.nextName
    ) {
        self.isPlaying = isPlaying
        self.size = size
        self.sides = sides
        self.pausedPlayName = playName
        self.pausedPlayGlyph = playGlyph
        self.canPlay = canPlay
        self.canGoBack = canGoBack
        self.canGoForward = canGoForward
        self.onPlayPause = onPlayPause
        self.onBack = onBack
        self.onForward = onForward
        self.onPrevious = onPrevious
        self.onNext = onNext
        self.canGoPrevious = canGoPrevious
        self.canGoNext = canGoNext
        self.previousName = previousName
        self.nextName = nextName
    }

    /// The gap between the group's buttons, for a bar that sets a track button beside what
    /// shows in place of play.
    package static func spacing(_ size: Size) -> CGFloat {
        #if os(macOS)
            macMetrics(size).spacing
        #else
            size == .feature ? 20 : 12
        #endif
    }

    fileprivate var backLabel: String { sides == .skip15 ? Self.backName : Self.startName }
    fileprivate var forwardLabel: String { sides == .skip15 ? Self.forwardName : Self.endName }
    fileprivate var backGlyph: String { sides == .skip15 ? "gobackward.15" : "backward.end.fill" }
    fileprivate var forwardGlyph: String { sides == .skip15 ? "goforward.15" : "forward.end.fill" }
    fileprivate var playLabel: String { isPlaying ? Self.pauseName : pausedPlayName }
    fileprivate var playGlyph: String { isPlaying ? "pause.fill" : pausedPlayGlyph }

    package var body: some View {
        #if os(macOS)
            MacTransport(transport: self)
        #else
            PhoneTransport(transport: self)
        #endif
    }

    #if os(macOS)
        /// The Mac transport's play disc and its glyph, its side circles and their glyph, and the
        /// gap between buttons.
        package static func macMetrics(_ size: Size) -> (
            disc: CGFloat, glyph: CGFloat, side: CGFloat, sideGlyph: CGFloat, spacing: CGFloat
        ) {
            switch size {
            case .feature: (MacStyle.transportDiameter, 20, 40, 22, 12)
            case .inline: (MacStyle.dockPlayDiameter, 12, 28, 15, 6)
            }
        }
    #endif
}

/// Previous or next track in a transport's side look, for a bar that offers the track buttons
/// while something other than its transport shows where play would be.
package struct TransportTrackButton: View {
    package enum Direction { case previous, next }

    private let direction: Direction
    private let size: Transport.Size
    private let name: String
    private let action: () -> Void

    package init(_ direction: Direction, size: Transport.Size, name: String? = nil, action: @escaping () -> Void) {
        self.direction = direction
        self.size = size
        self.name = name ?? (direction == .previous ? Transport.previousName : Transport.nextName)
        self.action = action
    }

    fileprivate static func glyph(_ direction: Direction) -> String {
        direction == .previous ? "backward.end.fill" : "forward.end.fill"
    }

    package var body: some View {
        #if os(macOS)
            MacTransportSide(name: name, glyph: Self.glyph(direction), size: size, action: action)
        #else
            PhoneTransportSide(name: name, glyph: Self.glyph(direction), size: size, action: action)
        #endif
    }
}

/// Turns a skip's arrow a short way and back each time `turns` grows.
private struct SkipTurn: ViewModifier {
    let turns: Int?
    let clockwise: Bool

    func body(content: Content) -> some View {
        if let turns {
            content.symbolEffect(
                clockwise ? .rotate.clockwise.byLayer : .rotate.counterClockwise.byLayer, value: turns)
        } else {
            content
        }
    }
}

#if os(macOS)
    private struct MacTransport: View {
        let transport: Transport

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var backTurns = 0
        @State private var forwardTurns = 0

        private var hasSides: Bool { transport.sides != .hidden }
        private var skips: Bool { transport.sides == .skip15 }
        private var backGlyph: String { transport.sides == .skip15 ? transport.backGlyph : "arrow.left.to.line" }
        private var forwardGlyph: String {
            transport.sides == .skip15 ? transport.forwardGlyph : "arrow.right.to.line"
        }

        var body: some View {
            let metrics = Transport.macMetrics(transport.size)
            HStack(spacing: metrics.spacing) {
                if let onPrevious = transport.onPrevious {
                    MacTransportSide(
                        name: transport.previousName, glyph: TransportTrackButton.glyph(.previous),
                        size: transport.size, isEnabled: transport.canGoPrevious, action: onPrevious)
                }
                if hasSides {
                    MacTransportSide(
                        name: transport.backLabel, glyph: backGlyph, size: transport.size,
                        isEnabled: transport.canGoBack, turns: skips ? backTurns : nil, clockwise: false
                    ) {
                        if !reduceMotion, skips { backTurns += 1 }
                        transport.onBack()
                    }
                }
                if let onPlayPause = transport.onPlayPause {
                    Button(action: onPlayPause) {
                        Label(transport.playLabel, systemImage: transport.playGlyph)
                            .labelStyle(.iconOnly)
                            .font(.system(size: metrics.glyph, weight: .semibold))
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(MacFocusEffectOff(MacTransportButtonBody(kind: .disc, diameter: metrics.disc)))
                    .help(transport.playLabel)
                    .disabled(!transport.canPlay)
                }
                if hasSides {
                    MacTransportSide(
                        name: transport.forwardLabel, glyph: forwardGlyph, size: transport.size,
                        isEnabled: transport.canGoForward, turns: skips ? forwardTurns : nil, clockwise: true
                    ) {
                        if !reduceMotion, skips { forwardTurns += 1 }
                        transport.onForward()
                    }
                }
                if let onNext = transport.onNext {
                    MacTransportSide(
                        name: transport.nextName, glyph: TransportTrackButton.glyph(.next), size: transport.size,
                        isEnabled: transport.canGoNext, action: onNext)
                }
            }
        }
    }

    /// A side or track button: an `accent` glyph in a circle that takes the tint under the
    /// pointer.
    private struct MacTransportSide: View {
        let name: String
        let glyph: String
        let size: Transport.Size
        var isEnabled = true
        /// How many times a skip has turned its arrow; nil for a button that never turns.
        var turns: Int?
        var clockwise = true
        let action: () -> Void

        var body: some View {
            let metrics = Transport.macMetrics(size)
            Button(action: action) {
                Label(name, systemImage: glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: metrics.sideGlyph))
                    .modifier(SkipTurn(turns: turns, clockwise: clockwise))
            }
            .buttonStyle(MacFocusEffectOff(MacTransportButtonBody(kind: .side, diameter: metrics.side)))
            .help(name)
            .disabled(!isEnabled)
        }
    }

    /// The transport's buttons on the Mac. A primitive style, so the system focus effect is off on
    /// the button itself.
    private struct MacTransportButtonBody: ButtonStyle {
        enum Kind { case disc, side }
        let kind: Kind
        let diameter: CGFloat

        func makeBody(configuration: Configuration) -> some View {
            MacTransportButtonLabel(configuration: configuration, kind: kind, diameter: diameter)
        }
    }

    private struct MacTransportButtonLabel: View {
        let configuration: ButtonStyle.Configuration
        let kind: MacTransportButtonBody.Kind
        let diameter: CGFloat

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.colorScheme) private var scheme
        @Environment(\.macPreviewFocused) private var previewFocused
        private var pointer = MacPointer()

        var body: some View {
            configuration.label
                .foregroundStyle(glyphColor)
                .frame(width: diameter, height: diameter)
                .background { fill }
                .contentShape(.circle)
                // A disabled disc reads as off by its outline; a side fades whole.
                .opacity(isEnabled || kind == .disc ? 1 : MacControl.disabledOpacity)
                .macFocusRing(isFocused || previewFocused, shape: Circle())
                .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }

        private var glyphColor: Color {
            switch kind {
            case .disc: isEnabled ? Palette.onAccentFill : Palette.onDisabled
            case .side: Palette.accent
            }
        }

        @ViewBuilder private var fill: some View {
            switch kind {
            case .disc:
                if isEnabled {
                    Circle().fill(Palette.accentFill)
                    Circle().fill(state.overlay)
                } else {
                    Circle().strokeBorder(Palette.disabledBorder, lineWidth: 1)
                }
            case .side:
                if state != .rest {
                    Circle().fill(MacControl.tintFill(state, scheme: scheme))
                }
            }
        }
    }
#endif

#if !os(macOS)
    private struct PhoneTransport: View {
        let transport: Transport

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @FocusState private var containerFocused: Bool
        @State private var backTurns = 0
        @State private var forwardTurns = 0

        private var isFeature: Bool { transport.size == .feature }
        private var target: CGFloat { isFeature ? 56 : minimumTapTarget }
        private var hasSides: Bool { transport.sides != .hidden }
        private var skips: Bool { transport.sides == .skip15 }

        var body: some View {
            HStack(spacing: Transport.spacing(transport.size)) {
                if let onPrevious = transport.onPrevious {
                    PhoneTransportSide(
                        name: transport.previousName, glyph: TransportTrackButton.glyph(.previous),
                        size: transport.size, isEnabled: transport.canGoPrevious, action: onPrevious)
                }
                if hasSides {
                    PhoneTransportSide(
                        name: transport.backLabel, glyph: transport.backGlyph, size: transport.size,
                        isEnabled: transport.canGoBack, turns: skips ? backTurns : nil, clockwise: false
                    ) {
                        if !reduceMotion, skips { backTurns += 1 }
                        transport.onBack()
                    }
                }
                play
                if hasSides {
                    PhoneTransportSide(
                        name: transport.forwardLabel, glyph: transport.forwardGlyph, size: transport.size,
                        isEnabled: transport.canGoForward, turns: skips ? forwardTurns : nil, clockwise: true
                    ) {
                        if !reduceMotion, skips { forwardTurns += 1 }
                        transport.onForward()
                    }
                }
                if let onNext = transport.onNext {
                    PhoneTransportSide(
                        name: transport.nextName, glyph: TransportTrackButton.glyph(.next), size: transport.size,
                        isEnabled: transport.canGoNext, action: onNext)
                }
            }
            .dynamicTypeSize(...DynamicTypeSize.large)
            // Arrows skip only while the container itself holds focus; a focused button or field
            // inside it keeps the system's arrow handling.
            .libraryFocus($containerFocused, shape: Capsule())
            .onKeyPress(.leftArrow) {
                guard containerFocused, hasSides, transport.canGoBack else { return .ignored }
                transport.onBack()
                return .handled
            }
            .onKeyPress(.rightArrow) {
                guard containerFocused, hasSides, transport.canGoForward else { return .ignored }
                transport.onForward()
                return .handled
            }
        }

        @ViewBuilder private var play: some View {
            if let onPlayPause = transport.onPlayPause {
                playButton(onPlayPause)
            }
        }

        @ViewBuilder private func playButton(_ onPlayPause: @escaping () -> Void) -> some View {
            if isFeature {
                Button(action: onPlayPause) {
                    Label(transport.playLabel, systemImage: transport.playGlyph)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 30, weight: .semibold))
                        .contentTransition(.symbolEffect(.replace))
                        // The play glyph sits optically left of center in its box.
                        .offset(x: transport.playGlyph == Transport.defaultPlayGlyph ? 1.5 : 0)
                        .foregroundStyle(transport.canPlay ? Palette.onAccentFill : Palette.onDisabled)
                        .frame(width: ControlMetrics.featureDiameter, height: ControlMetrics.featureDiameter)
                        .background(transport.canPlay ? Palette.accentFill : .clear, in: .circle)
                        .disabledCapsuleRing(!transport.canPlay)
                        .contentShape(.circle)
                }
                .buttonStyle(TransportButtonStyle(kind: .disc))
                .disabled(!transport.canPlay)
                .accessibilityShowsLargeContentViewer()
            } else {
                Button(action: onPlayPause) {
                    Label(transport.playLabel, systemImage: transport.playGlyph)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 28))
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: target, height: target)
                }
                .buttonStyle(TransportButtonStyle(kind: .side))
                .foregroundStyle(transport.canPlay ? Palette.accent : Palette.onDisabled)
                .disabled(!transport.canPlay)
                .accessibilityShowsLargeContentViewer()
            }
        }
    }

    /// A side or track button: an `accent` glyph at the side's size.
    private struct PhoneTransportSide: View {
        let name: String
        let glyph: String
        let size: Transport.Size
        var isEnabled = true
        /// How many times a skip has turned its arrow; nil for a button that never turns.
        var turns: Int?
        var clockwise = true
        let action: () -> Void

        private var isFeature: Bool { size == .feature }
        private var target: CGFloat { isFeature ? 56 : minimumTapTarget }

        var body: some View {
            Button(action: action) {
                Label(name, systemImage: glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: isFeature ? 38 : 28))
                    .modifier(SkipTurn(turns: turns, clockwise: clockwise))
                    .frame(width: target, height: target)
            }
            .buttonStyle(TransportButtonStyle(kind: .side))
            .foregroundStyle(isEnabled ? Palette.accent : Palette.onDisabled)
            .disabled(!isEnabled)
            .accessibilityShowsLargeContentViewer()
        }
    }

    /// Scales to 0.9 the moment a press starts and springs back on release; Reduce Motion leaves
    /// it still. A side button also shows a faint circle while pressed. The pointer's highlight
    /// takes the button's circle.
    private struct TransportButtonStyle: ButtonStyle {
        enum Kind { case side, disc }
        let kind: Kind

        @Environment(\.colorScheme) private var colorScheme

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .background {
                    if kind == .side, configuration.isPressed {
                        Circle().fill(Palette.tintSubtle(colorScheme))
                    }
                }
                .pressScale(configuration.isPressed, to: 0.9)
                .libraryHover(.circle)
                .contentShape(.circle)
        }
    }
#endif

#Preview("Transport") {
    @Previewable @State var isPlaying = false
    VStack(spacing: 24) {
        Transport(
            isPlaying: isPlaying, size: .feature, onPlayPause: { isPlaying.toggle() }, onBack: {}, onForward: {})
        Transport(
            isPlaying: isPlaying, size: .inline, onPlayPause: { isPlaying.toggle() }, onBack: {}, onForward: {})
    }
    .padding()
}
