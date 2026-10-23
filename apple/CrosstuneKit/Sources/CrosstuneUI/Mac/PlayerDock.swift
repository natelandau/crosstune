import CrosstuneAnalytics

#if os(macOS)
    import CrosstuneAuth
    import SwiftUI

    /// The Mac player: an opaque bar docked edge to edge across the foot of the detail column,
    /// so its controls sit under the tune they play. A loaded link's player or the Apple Music card
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
        nonisolated static let inset: CGFloat = MacStyle.dockInset
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
            .background(Palette.surface)
            .macSurfaceContainer()
            .overlay(alignment: .top) {
                Palette.hairline.frame(height: 1)
            }
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
        @Environment(\.openURL) private var openURL

        var body: some View {
            HStack(spacing: 8) {
                if player.isLoaded {
                    loaded
                } else if let message = playback?.endMessage {
                    Text(message)
                        .font(MacStyle.body)
                        .foregroundStyle(.inkSecondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 6)
                    close
                }
            }
            .padding(.horizontal, MacStyle.dockInset)
            .frame(height: MacStyle.dockHeight)
        }

        /// What stands where play would be while an embed's own controls play it.
        static let nowPlayingSymbol = "waveform"

        private var isRecording: Bool { player.item?.kind == .recording }
        private var listPlays: Bool { playback?.isActive == true }

        @ViewBuilder private var loaded: some View {
            HStack(spacing: 0) {
                if listPlays, let playback {
                    DockButton(PlaylistControlText.previous, systemImage: "backward.fill") { playback.previous() }
                }
                if player.playsInBar {
                    DockPlayButton(player: player)
                } else if PlayerBar.showsGlyph(player) {
                    // The embed's own controls play and pause; this only marks what is playing,
                    // so it never looks like a play button.
                    Image(systemName: Self.nowPlayingSymbol)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Palette.inkSecondary)
                        .frame(width: MacStyle.dockPlayDiameter, height: MacStyle.dockPlayDiameter)
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
                if let link = player.item?.link, link.providerURL != nil {
                    DockButton(PlayerBar.openIn(link.providerName), systemImage: "arrow.up.right") {
                        player.openLinkInProvider { openURL($0) }
                    }
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
                        .foregroundStyle(.inkSecondary)
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

    /// Play or pause as a filled disc, or what stands in for it while a recording's audio is
    /// fetched or missing, each the disc's size.
    private struct DockPlayButton: View {
        let player: PlayerModel

        var body: some View {
            if let transport = player.transport {
                let playing = transport.isPlaying
                Button {
                    transport.toggle()
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.ground)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: MacStyle.dockPlayDiameter, height: MacStyle.dockPlayDiameter)
                        .background(Palette.ink, in: .circle)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? RecordingPlayerText.pause : RecordingPlayerText.play)
                .help(playing ? RecordingPlayerText.pause : RecordingPlayerText.play)
            } else if player.recordingAudio == .fetching {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: MacStyle.dockPlayDiameter, height: MacStyle.dockPlayDiameter)
                    .accessibilityLabel(RecordingText.downloading)
            } else {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 15))
                    .foregroundStyle(Palette.inkSecondary)
                    .frame(width: MacStyle.dockPlayDiameter, height: MacStyle.dockPlayDiameter)
                    .accessibilityHidden(true)
            }
        }
    }

    /// A glyph-only dock control: the Mac icon button, its glyph in the accent while the
    /// setting it toggles is on.
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
                Image(systemName: systemImage)
                    // One size for every glyph, so repeat and its repeat-one form match.
                    .font(.system(size: 13, weight: .medium))
                    .imageScale(.medium)
                    // On the label, which wins over the icon style's secondary ink.
                    .foregroundStyle(highlighted ? Palette.accent : Palette.inkSecondary)
                    .frame(width: 16, height: 16)
            }
            .buttonStyle(.mac(.icon))
            .accessibilityLabel(title)
            .accessibilityAddTraits(highlighted ? .isSelected : [])
            .help(help ?? title)
        }
    }

    /// The Mac scrubber's track: a hairline, filled in ink to the position, with a coral playhead.
    /// A click jumps there and a drag carries it along; `onEnd` gets where it was let go.
    struct ScrubberTrack: View {
        /// How far along, from 0 to 1.
        let fraction: Double
        let onDrag: (Double) -> Void
        let onEnd: (Double) -> Void

        @State private var hovering = false
        @State private var dragging = false

        private static let lineHeight: CGFloat = 3
        /// The played part's ink, quieter than text so the coral playhead leads.
        static let fillOpacity: Double = 0.55
        /// Taller than the line, so a pointer grabs it without aiming at three points.
        private static let height: CGFloat = 20

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let knob: CGFloat = hovering || dragging ? 12 : 9
                let x = width * min(max(fraction, 0), 1)
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.hairline)
                        .frame(height: Self.lineHeight)
                    Capsule().fill(Palette.ink.opacity(ScrubberTrack.fillOpacity))
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
