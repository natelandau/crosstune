import SwiftUI

/// Back, play and pause, and forward as one control. `.feature` is the large practice transport
/// with a filled play disc; `.inline` is three equal glyphs for a bar. Sides `.hidden` leaves
/// play and pause alone, for a bar with room for one control. On the Mac it draws the Mac
/// transport `macLook` names.
package struct Transport: View {
    package enum Size { case feature, inline }
    package enum Sides { case skip15, edges, hidden }
    /// The Mac transport drawn: `.disc`, the practice transport with an accent play disc;
    /// `.glyphs`, three borderless glyphs with a large play glyph, as the Trim and Split screens
    /// draw it.
    package enum MacLook { case disc, glyphs }

    package static let playName = "Play"
    package static let pauseName = "Pause"
    package static let backName = "Back 15 seconds"
    package static let forwardName = "Forward 15 seconds"
    package static let startName = "Go to start"
    package static let endName = "Go to end"
    package static let defaultPlayGlyph = "play.fill"

    package let isPlaying: Bool
    package let size: Size
    package let sides: Sides
    package let macLook: MacLook
    /// The play button's name while paused, for a screen whose play button names its scope.
    package let pausedPlayName: String
    /// The play button's glyph while paused, for a screen whose play repeats a part.
    package let pausedPlayGlyph: String
    package let canPlay: Bool
    package let canGoBack: Bool
    package let canGoForward: Bool
    package let onPlayPause: () -> Void
    package let onBack: () -> Void
    package let onForward: () -> Void

    package init(
        isPlaying: Bool, size: Size, sides: Sides = .skip15, macLook: MacLook = .disc,
        playName: String = Transport.playName,
        playGlyph: String = Transport.defaultPlayGlyph, canPlay: Bool = true, canGoBack: Bool = true,
        canGoForward: Bool = true, onPlayPause: @escaping () -> Void, onBack: @escaping () -> Void = {},
        onForward: @escaping () -> Void = {}
    ) {
        self.isPlaying = isPlaying
        self.size = size
        self.sides = sides
        self.macLook = macLook
        self.pausedPlayName = playName
        self.pausedPlayGlyph = playGlyph
        self.canPlay = canPlay
        self.canGoBack = canGoBack
        self.canGoForward = canGoForward
        self.onPlayPause = onPlayPause
        self.onBack = onBack
        self.onForward = onForward
    }

    fileprivate var backLabel: String { sides == .skip15 ? Self.backName : Self.startName }
    fileprivate var forwardLabel: String { sides == .skip15 ? Self.forwardName : Self.endName }
    fileprivate var backGlyph: String { sides == .skip15 ? "gobackward.15" : "backward.end.fill" }
    fileprivate var forwardGlyph: String { sides == .skip15 ? "goforward.15" : "forward.end.fill" }
    fileprivate var playLabel: String { isPlaying ? Self.pauseName : pausedPlayName }
    fileprivate var playGlyph: String { isPlaying ? "pause.fill" : pausedPlayGlyph }

    package var body: some View {
        #if os(macOS)
            macBody
        #else
            PhoneTransport(transport: self)
        #endif
    }

    #if os(macOS)
        private var macBackGlyph: String { sides == .skip15 ? backGlyph : "arrow.left.to.line" }
        private var macForwardGlyph: String { sides == .skip15 ? forwardGlyph : "arrow.right.to.line" }

        @ViewBuilder private var macBody: some View {
            switch macLook {
            case .disc:
                HStack(spacing: 20) {
                    if sides != .hidden { macSide(backLabel, macBackGlyph, canGoBack, onBack) }
                    macDisc
                    if sides != .hidden { macSide(forwardLabel, macForwardGlyph, canGoForward, onForward) }
                }
            case .glyphs:
                HStack(spacing: 40) {
                    if sides != .hidden { macEdge(backLabel, macBackGlyph, canGoBack, onBack) }
                    Button(playLabel, systemImage: playGlyph, action: onPlayPause)
                        .help(playLabel)
                        .font(.platform(.largeTitle, mac: .columnTitle))
                        .contentTransition(.symbolEffect(.replace))
                        .frame(minWidth: 64, minHeight: 64)
                        .disabled(!canPlay)
                    if sides != .hidden { macEdge(forwardLabel, macForwardGlyph, canGoForward, onForward) }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .font(.platform(.title2))
            }
        }

        private var macDisc: some View {
            Button(action: onPlayPause) {
                Image(systemName: playGlyph)
                    .font(.system(size: 18, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .foregroundStyle(Palette.onAccentFill)
                    .frame(width: MacStyle.transportDiameter, height: MacStyle.transportDiameter)
                    .background(Palette.accentFill, in: .circle)
                    .opacity(canPlay ? 1 : MacButtonStyle.disabledOpacity)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playLabel)
            .help(playLabel)
            .disabled(!canPlay)
        }

        private func macSide(_ name: String, _ glyph: String, _ enabled: Bool, _ action: @escaping () -> Void)
            -> some View
        {
            Button(action: action) {
                Label(name, systemImage: glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: 15))
            }
            .buttonStyle(.mac(.icon, size: .large))
            .help(name)
            .disabled(!enabled)
        }

        private func macEdge(_ name: String, _ glyph: String, _ enabled: Bool, _ action: @escaping () -> Void)
            -> some View
        {
            Button(name, systemImage: glyph, action: action)
                .help(name)
                .disabled(!enabled)
        }
    #endif
}

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

        var body: some View {
            HStack(spacing: isFeature ? 20 : 12) {
                if hasSides {
                    side(
                        transport.backGlyph, transport.backLabel, enabled: transport.canGoBack, turns: backTurns,
                        clockwise: false
                    ) {
                        if !reduceMotion, transport.sides == .skip15 { backTurns += 1 }
                        transport.onBack()
                    }
                }
                play
                if hasSides {
                    side(
                        transport.forwardGlyph, transport.forwardLabel, enabled: transport.canGoForward,
                        turns: forwardTurns, clockwise: true
                    ) {
                        if !reduceMotion, transport.sides == .skip15 { forwardTurns += 1 }
                        transport.onForward()
                    }
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

        private func side(
            _ glyph: String, _ name: String, enabled: Bool, turns: Int, clockwise: Bool,
            action: @escaping () -> Void
        ) -> some View {
            Button(action: action) {
                Label(name, systemImage: glyph)
                    .labelStyle(.iconOnly)
                    .font(.system(size: isFeature ? 38 : 28))
                    .symbolEffect(
                        clockwise ? .rotate.clockwise.byLayer : .rotate.counterClockwise.byLayer,
                        value: turns
                    )
                    .frame(width: target, height: target)
            }
            .buttonStyle(TransportButtonStyle(kind: .side))
            .foregroundStyle(enabled ? Palette.accent : Palette.onDisabled)
            .disabled(!enabled)
            .accessibilityShowsLargeContentViewer()
        }

        @ViewBuilder private var play: some View {
            if isFeature {
                Button(action: transport.onPlayPause) {
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
                Button(action: transport.onPlayPause) {
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
