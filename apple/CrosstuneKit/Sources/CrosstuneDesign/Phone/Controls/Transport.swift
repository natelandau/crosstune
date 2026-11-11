import SwiftUI

/// Back, play and pause, and forward as one control, with previous and next track at its ends
/// where a screen plays a list. `.feature` is the large practice transport with a filled play
/// disc; `.inline` is the small one for a bar. Sides `.hidden` leaves play and pause alone, for a
/// bar with room for one control. No play action draws no play button, for a group whose play
/// is elsewhere on the screen, or `playPlaceholder` in its place.
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
    fileprivate var placeholder: AnyView?

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

    /// What shows where play would be while there is no play action, such as a spinner while
    /// the audio loads.
    package func playPlaceholder(@ViewBuilder _ placeholder: () -> some View) -> Transport {
        var transport = self
        transport.placeholder = AnyView(placeholder())
        return transport
    }

    #if os(macOS)
        private static let startGlyph = "arrow.left.to.line"
        private static let endGlyph = "arrow.right.to.line"
    #else
        private static let startGlyph = "backward.end.fill"
        private static let endGlyph = "forward.end.fill"
    #endif

    fileprivate var hasSides: Bool { sides != .hidden }
    fileprivate var skips: Bool { sides == .skip15 }
    fileprivate var backLabel: String { skips ? Self.backName : Self.startName }
    fileprivate var forwardLabel: String { skips ? Self.forwardName : Self.endName }
    fileprivate var backGlyph: String { skips ? "gobackward.15" : Self.startGlyph }
    fileprivate var forwardGlyph: String { skips ? "goforward.15" : Self.endGlyph }
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

/// Previous or next track in a transport's side look, for a bar that shows a track button with
/// no transport beside it.
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
        let side = TransportSide(label: name, glyph: Self.glyph(direction), action: action)
        #if os(macOS)
            MacTransportSide(side: side, size: size)
        #else
            PhoneTransportSide(side: side, size: size)
        #endif
    }
}

/// A side or track button for a platform to draw.
private struct TransportSide {
    let label: String
    let glyph: String
    var isEnabled = true
    /// How many times a skip has turned its arrow; nil for a button that never turns.
    var turns: Int?
    var clockwise = true
    let action: () -> Void
}

/// Previous track, back, play, forward, and next track in that order, each only where the
/// transport offers it. Each platform draws the side buttons and play.
private struct TransportRow<Side: View, Play: View>: View {
    let transport: Transport
    let spacing: CGFloat
    @ViewBuilder let side: (TransportSide) -> Side
    @ViewBuilder let play: (_ onPlayPause: @escaping () -> Void) -> Play

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var backTurns = 0
    @State private var forwardTurns = 0

    var body: some View {
        HStack(spacing: spacing) {
            if let onPrevious = transport.onPrevious {
                side(
                    TransportSide(
                        label: transport.previousName, glyph: TransportTrackButton.glyph(.previous),
                        isEnabled: transport.canGoPrevious, action: onPrevious))
            }
            if transport.hasSides {
                side(
                    TransportSide(
                        label: transport.backLabel, glyph: transport.backGlyph, isEnabled: transport.canGoBack,
                        turns: transport.skips ? backTurns : nil, clockwise: false
                    ) {
                        if !reduceMotion, transport.skips { backTurns += 1 }
                        transport.onBack()
                    })
            }
            if let onPlayPause = transport.onPlayPause {
                play(onPlayPause)
            } else if let placeholder = transport.placeholder {
                placeholder
            }
            if transport.hasSides {
                side(
                    TransportSide(
                        label: transport.forwardLabel, glyph: transport.forwardGlyph,
                        isEnabled: transport.canGoForward, turns: transport.skips ? forwardTurns : nil,
                        clockwise: true
                    ) {
                        if !reduceMotion, transport.skips { forwardTurns += 1 }
                        transport.onForward()
                    })
            }
            if let onNext = transport.onNext {
                side(
                    TransportSide(
                        label: transport.nextName, glyph: TransportTrackButton.glyph(.next),
                        isEnabled: transport.canGoNext, action: onNext))
            }
        }
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

        var body: some View {
            let metrics = Transport.macMetrics(transport.size)
            TransportRow(transport: transport, spacing: metrics.spacing) { side in
                MacTransportSide(side: side, size: transport.size)
            } play: { onPlayPause in
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
        }
    }

    /// A side or track button: an `accent` glyph in a circle that takes the tint under the
    /// pointer.
    private struct MacTransportSide: View {
        let side: TransportSide
        let size: Transport.Size

        var body: some View {
            let metrics = Transport.macMetrics(size)
            Button(action: side.action) {
                Label(side.label, systemImage: side.glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: metrics.sideGlyph))
                    .modifier(SkipTurn(turns: side.turns, clockwise: side.clockwise))
            }
            .buttonStyle(MacFocusEffectOff(MacTransportButtonBody(kind: .side, diameter: metrics.side)))
            .help(side.label)
            .disabled(!side.isEnabled)
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

        @FocusState private var containerFocused: Bool

        private var isFeature: Bool { transport.size == .feature }
        private var target: CGFloat { isFeature ? 56 : minimumTapTarget }

        var body: some View {
            TransportRow(transport: transport, spacing: isFeature ? 20 : 12) { side in
                PhoneTransportSide(side: side, size: transport.size)
            } play: { onPlayPause in
                playButton(onPlayPause)
            }
            .dynamicTypeSize(...DynamicTypeSize.large)
            // Arrows skip only while the container itself holds focus; a focused button or field
            // inside it keeps the system's arrow handling. A placeholder alone with the track
            // buttons is no focus stop, since nothing in it answers the arrows or play.
            .libraryFocus(
                $containerFocused, isFocusable: transport.hasSides || transport.onPlayPause != nil,
                shape: Capsule()
            )
            .onKeyPress(.leftArrow) {
                guard containerFocused, transport.hasSides, transport.canGoBack else { return .ignored }
                transport.onBack()
                return .handled
            }
            .onKeyPress(.rightArrow) {
                guard containerFocused, transport.hasSides, transport.canGoForward else { return .ignored }
                transport.onForward()
                return .handled
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
        let side: TransportSide
        let size: Transport.Size

        private var isFeature: Bool { size == .feature }
        private var target: CGFloat { isFeature ? 56 : minimumTapTarget }

        var body: some View {
            Button(action: side.action) {
                Label(side.label, systemImage: side.glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: isFeature ? 38 : 28))
                    .modifier(SkipTurn(turns: side.turns, clockwise: side.clockwise))
                    .frame(width: target, height: target)
            }
            .buttonStyle(TransportButtonStyle(kind: .side))
            .foregroundStyle(side.isEnabled ? Palette.accent : Palette.onDisabled)
            .disabled(!side.isEnabled)
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
