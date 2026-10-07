import CrosstuneAnalytics

#if os(macOS)
    import CrosstuneAuth
    import SwiftUI

    /// The Mac player: a glass bar docked edge to edge across the foot of the detail column, so
    /// its controls sit under the tune they play. A loaded link's player or the Apple Music card
    /// grows up out of the bar.
    struct PlayerDock: View {
        /// How tall an embed or card that wants `wanted` points is drawn in a detail column
        /// `columnHeight` tall: its own height when there is room, otherwise as tall as keeps
        /// the whole dock within ``maxShare`` of the column, so a short window keeps
        /// its page.
        nonisolated static func embedHeight(columnHeight: CGFloat, wanted: CGFloat) -> CGFloat {
            min(wanted, max(0, columnHeight * maxShare - chrome))
        }

        /// The most of the column's height the dock takes.
        nonisolated static let maxShare: CGFloat = 0.4
        /// The web's width for a video player, so it is not stretched across the column.
        nonisolated static let videoWidth: CGFloat = 356

        /// The gap around an embed or card above the bar.
        nonisolated static let inset: CGFloat = 12
        /// The bar under an embed or card and the gap above it.
        nonisolated static let chrome: CGFloat = MacStyle.dockHeight + inset

        let player: PlayerModel
        let stage: EmbedStage
        /// The detail column's full height, infinite until it is measured.
        let columnHeight: CGFloat

        @Environment(\.appearsActive) private var appearsActive
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            VStack(spacing: 0) {
                upper
                PlayerDockBar(player: player)
            }
            .frame(maxWidth: .infinity)
            .macGlass(in: Rectangle())
            // The glass alone barely parts from a white page; the hairline gives the dock an edge.
            .overlay(alignment: .top) { Divider() }
            .animation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.15), value: upperKind)
        }

        /// What grows above the bar, so a change of it springs and a window resize does not.
        private var upperKind: Int {
            if let embed = player.embed { return embed.hashValue }
            return player.music == nil ? 0 : 1
        }

        @ViewBuilder private var upper: some View {
            if let embed = player.embed {
                let height = Self.embedHeight(columnHeight: columnHeight, wanted: CGFloat(embed.points))
                if height > 0 {
                    // A video keeps its shape as it shrinks; anything else spans the column.
                    let width: CGFloat? =
                        embed.height == .video ? Self.videoWidth * height / CGFloat(embed.points) : nil
                    EmbedView(stage: stage, embed: embed, prominence: appearsActive ? .focused : .shown)
                        .frame(width: width, height: height)
                        .clipShape(.rect(cornerRadius: 10))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding([.horizontal, .top], Self.inset)
                        .transition(.opacity)
                } else {
                    // No room to show the player, so it plays on out of sight.
                    Color.clear.frame(height: 0).modifier(EmbedParking(player: player, stage: stage))
                }
            } else if let music = player.music {
                let height = Self.embedHeight(columnHeight: columnHeight, wanted: MusicPlayerCard.height)
                if height > 0 {
                    // The bar carries play and pause, the track, and its artist.
                    MusicPlayerCard(player: player, music: music, fixedHeight: height, showsTitle: false)
                        .padding([.horizontal, .top], Self.inset)
                        .transition(.opacity)
                }
            }
        }
    }

    /// The dock's one line: play and pause between previous and next while a list plays, the
    /// item's title, a recording's scrubber, then shuffle and repeat, the link out, Expand, and
    /// Close.
    struct PlayerDockBar: View {
        let player: PlayerModel

        @Environment(\.playerWindow) private var window
        @Environment(ListPlayback.self) private var playback: ListPlayback?
        @Environment(AccountSession.self) private var session: AccountSession?

        var body: some View {
            HStack(spacing: 8) {
                if player.isLoaded {
                    loaded
                } else if let message = playback?.endMessage {
                    Text(message)
                        .font(MacStyle.body)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 6)
                    close
                }
            }
            .padding(.horizontal, 10)
            .frame(height: MacStyle.dockHeight)
        }

        private var isRecording: Bool { player.item?.kind == .recording }
        private var listPlays: Bool { playback?.isActive == true }

        @ViewBuilder private var loaded: some View {
            HStack(spacing: 0) {
                if listPlays, let playback {
                    DockButton(PlaylistControlText.previous, systemImage: "backward.fill") { playback.previous() }
                }
                if player.playsInBar {
                    RecordingPlayButton(player: player, font: .system(size: 17))
                        .frame(width: 36)
                } else if PlayerBar.showsGlyph(player) {
                    // The embed's own controls play and pause; this only marks what is playing.
                    Image(systemName: "play.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .frame(width: 36)
                        .accessibilityHidden(true)
                }
                if listPlays, let playback {
                    DockButton(PlaylistControlText.next, systemImage: "forward.fill") { playback.next() }
                }
            }
            // A recording's title keeps its natural width, so a short one leaves the scrubber the
            // room and a long one truncates at no more than half of it.
            titleBlock
                .frame(maxWidth: isRecording ? nil : .infinity, alignment: .leading)
            if isRecording {
                SettingsBadge(speedPercent: player.speedPercent, pitchCents: player.pitchCents)
                if player.loops.isRepeating, let name = player.loops.selectedName {
                    RepeatBadge(player: player, name: name)
                }
                recordingBody
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 8)
            }
            HStack(spacing: 0) {
                if listPlays, let playback {
                    DockButton(
                        PlaylistControlText.shuffle, systemImage: "shuffle", highlighted: playback.isShuffled
                    ) {
                        playback.setShuffled(!playback.isShuffled)
                    }
                    DockButton(
                        PlaylistControlText.repeatLabel(playback.repeatMode),
                        systemImage: PlaylistControlText.repeatSymbol(playback.repeatMode),
                        highlighted: playback.repeatMode != .off
                    ) {
                        playback.cycleRepeat()
                    }
                }
                if let link = player.item?.link, let url = link.providerURL {
                    Link(destination: url) {
                        DockGlyph(systemImage: "arrow.up.right", highlighted: false)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(PlayerBar.openIn(link.providerName))
                    .help(PlayerBar.openIn(link.providerName))
                }
                if isRecording, PlayerBar.canExpand(player) {
                    DockButton(
                        PlayerBar.showLabel(player, playback: playback),
                        systemImage: "arrow.up.left.and.arrow.down.right", help: PlayerBar.show
                    ) {
                        player.expand(in: window, source: .dock)
                    }
                }
                close
            }
        }

        private var close: some View {
            DockButton(PlayerBar.close, systemImage: "xmark") { PlayerBar.closePlayer(player, playback) }
        }

        private var titleBlock: some View {
            VStack(alignment: .leading, spacing: 1) {
                Text(PlayerBar.title(player, playback))
                    .font(MacStyle.body.weight(.medium))
                    .lineLimit(1)
                if let failure = player.failure {
                    Text(failure)
                        .font(MacStyle.secondary)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                } else if let subtitle {
                    Text(subtitle)
                        .font(MacStyle.secondary)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.leading, 4)
        }

        /// Where a playing list stands, an album's track, the artist, or a recording's tune.
        private var subtitle: String? {
            PlayerBar.playlistSubtitle(playback) ?? PlayerBar.subtitle(player) ?? player.music?.artistName
                ?? player.item?.tuneTitle
        }

        @ViewBuilder private var recordingBody: some View {
            if let message = RecordingPlayerText.status(
                player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
            {
                RecordingPlayerStatus(player: player, message: message)
            } else {
                PlaybackScrubber(audio: player.audio, inline: true)
            }
        }
    }

    /// A glyph-only dock control, ringed while the pointer is over it.
    private struct DockButton: View {
        let title: String
        let systemImage: String
        var highlighted = false
        var help: String?
        let action: () -> Void

        init(
            _ title: String, systemImage: String, highlighted: Bool = false, help: String? = nil,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.systemImage = systemImage
            self.highlighted = highlighted
            self.help = help
            self.action = action
        }

        var body: some View {
            Button(action: action) {
                DockGlyph(systemImage: systemImage, highlighted: highlighted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityAddTraits(highlighted ? .isSelected : [])
            .help(help ?? title)
        }
    }

    private struct DockGlyph: View {
        let systemImage: String
        let highlighted: Bool

        @State private var hovering = false

        var body: some View {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(highlighted ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 30, height: 30)
                .background(hovering ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .circle)
                .contentShape(.circle)
                .onHover { hovering = $0 }
        }
    }

    /// The Mac scrubber's track: a thin line, filled to the position, with a coral playhead.
    /// A click jumps there and a drag carries it along; `onEnd` gets where it was let go.
    struct ScrubberTrack: View {
        /// How far along, from 0 to 1.
        let fraction: Double
        let onDrag: (Double) -> Void
        let onEnd: (Double) -> Void

        @State private var hovering = false
        @State private var dragging = false

        private static let lineHeight: CGFloat = 3
        /// Taller than the line, so a pointer grabs it without aiming at three points.
        private static let height: CGFloat = 20

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let knob: CGFloat = hovering || dragging ? 12 : 9
                let x = width * min(max(fraction, 0), 1)
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                        .frame(height: Self.lineHeight)
                    Capsule().fill(.secondary)
                        .frame(width: x, height: Self.lineHeight)
                    Circle()
                        .fill(MacStyle.coral)
                        .frame(width: knob, height: knob)
                        .offset(x: min(max(0, x - knob / 2), width - knob))
                }
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .onHover { hovering = $0 }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            dragging = true
                            onDrag(Self.fraction(at: value.location.x, width: width))
                        }
                        .onEnded { value in
                            dragging = false
                            onEnd(Self.fraction(at: value.location.x, width: width))
                        }
                )
            }
            .frame(height: Self.height)
        }

        private static func fraction(at x: CGFloat, width: CGFloat) -> Double {
            width > 0 ? Double(min(max(x / width, 0), 1)) : 0
        }
    }

    extension View {
        /// Docks the player across the foot of this detail column while something is loaded.
        /// The dock is the column's bottom bar, so a page scrolls to its end above it.
        func playerDock(_ player: PlayerModel, stage: EmbedStage) -> some View {
            modifier(PlayerDockModifier(player: player, stage: stage))
        }
    }

    private struct PlayerDockModifier: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(ListPlayback.self) private var playback: ListPlayback?
        @State private var columnHeight: CGFloat = .infinity

        func body(content: Content) -> some View {
            let shown = PlayerBar.isShown(player, playback)
            content
                .scrollEdgeEffectStyle(.soft, for: .bottom)
                .safeAreaBar(edge: .bottom, spacing: 0) {
                    if shown {
                        PlayerDock(player: player, stage: stage, columnHeight: columnHeight)
                            .transition(reduceMotion ? .identity : .move(edge: .bottom))
                    }
                }
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height + $0.safeAreaInsets.top + $0.safeAreaInsets.bottom
                } action: {
                    columnHeight = $0
                }
                .animation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.1), value: shown)
        }
    }
#endif
