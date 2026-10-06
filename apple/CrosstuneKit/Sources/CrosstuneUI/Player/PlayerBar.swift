import SwiftUI

/// The loaded item and a close button: the iPhone tab bar's bottom accessory, where a tap on the
/// item shows its player in full and a sideways swipe skips through a playing list, and the
/// header of the iPad player panel. A recording leads
/// with its play and pause control. The Mac docks its own bar, ``PlayerDockBar``.
public struct PlayerBar: View {
    public static let close = "Close player"
    /// The iPhone bar's name for the tap that shows the player in full.
    public static let show = "Show player"

    /// The link out to the provider's own page: "Open in YouTube".
    public static func openIn(_ providerName: String) -> String {
        "Open in \(providerName)"
    }

    private let player: PlayerModel
    private let isPanel: Bool

    @Environment(\.playerWindow) private var window
    @Environment(ListPlayback.self) private var playback: ListPlayback?
    /// How many tunes a swipe has skipped, which each skip's haptic follows.
    @State private var swipeSkips = 0

    /// - Parameter isPanel: The bar heads the iPad panel, which shows the player in
    ///   full under it and puts the link out to the provider in the bar. The iPhone's full
    ///   player carries that link instead.
    public init(player: PlayerModel, isPanel: Bool = false) {
        self.player = player
        self.isPanel = isPanel
    }

    /// The track playing from an Apple Music album link, shown under the link's title; nil for
    /// anything else, whose title already names what plays.
    static func subtitle(_ player: PlayerModel) -> String? {
        guard let music = player.music, music.hasAlbum else { return nil }
        return music.trackTitle
    }

    /// Where the playing list stands, shown under the tune's title; nil while no list plays.
    static func playlistSubtitle(_ playback: ListPlayback?) -> String? {
        guard let playback, playback.isActive, let name = playback.listName else { return nil }
        return PlaylistControlText.subtitle(listName: name, position: playback.position, count: playback.count)
    }

    /// The bar's title: the tune a playing list is on, otherwise the loaded item's name.
    static func title(_ player: PlayerModel, _ playback: ListPlayback?) -> String {
        if let playback, playback.isActive, let title = playback.title { return title }
        return player.title ?? ""
    }

    /// Whether the bar offers next, which only a list playing as a playlist has.
    static func showsNext(_ playback: ListPlayback?) -> Bool {
        playback?.isActive == true
    }

    /// Whether the player shows at all: while an item is loaded, and while a playlist that
    /// stopped with nothing loaded still has its message to show.
    static func isShown(_ player: PlayerModel, _ playback: ListPlayback?) -> Bool {
        player.isLoaded || playback?.endMessage != nil
    }

    /// Whether the bar leads with a static play glyph: only for a link in its embed, whose
    /// controls are the provider's.
    static func showsGlyph(_ player: PlayerModel) -> Bool {
        player.linkAudio == .embed
    }

    /// Whether a tap on the item shows its player in full. A link still deciding how to play
    /// has no player to show yet.
    static func canExpand(_ player: PlayerModel) -> Bool {
        player.linkAudio != .deciding
    }

    /// Show player and the item's name, an album's track, then a recording's speed and pitch
    /// when either is away from its default, since the button's name replaces the label's.
    static func showLabel(_ player: PlayerModel, playback: ListPlayback? = nil) -> String {
        let badge =
            player.item?.kind == .recording
            ? RecordingScreenText.badgeLabel(speedPercent: player.speedPercent, pitchCents: player.pitchCents) : nil
        return [show, title(player, playback), playlistSubtitle(playback) ?? subtitle(player), badge].compactMap(\.self)
            .joined(separator: ", ")
    }

    public var body: some View {
        if player.isLoaded {
            loadedBar
                .modifier(AccessoryRise(isEnabled: !isPanel))
        } else if let message = playback?.endMessage {
            messageBar(message)
        }
    }

    /// What stands where the tune was: why the playlist stopped, and Close player to dismiss it.
    private func messageBar(_ message: String) -> some View {
        HStack(spacing: 4) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            closeButton
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
    }

    private var closeButton: some View {
        PlayerCloseButton(player: player)
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
    }

    @ViewBuilder private var loadedBar: some View {
        let isRecording = player.item?.kind == .recording
        let glyph = Self.showsGlyph(player)
        HStack(spacing: 4) {
            if player.playsInBar {
                RecordingPlayButton(player: player)
            }
            // The panel shows a link's player under the bar; a recording opens its screen.
            if (isPanel && !isRecording) || !Self.canExpand(player) {
                itemLabel(glyph: glyph)
            } else {
                Button {
                    player.expand(in: window)
                } label: {
                    HStack(spacing: 8) {
                        itemLabel(glyph: glyph)
                        // The panel's player rises from here; the accessory's zooms out of it.
                        if isPanel {
                            Image(systemName: "chevron.up")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Self.showLabel(player, playback: playback))
            }
            if isRecording, player.loops.isRepeating, let name = player.loops.selectedName {
                RepeatBadge(player: player, name: name)
            }
            if isPanel, let link = player.item?.link, let url = link.providerURL {
                Link(destination: url) {
                    Label(Self.openIn(link.providerName), systemImage: "arrow.up.right")
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
                .help(Self.openIn(link.providerName))
            }
            if Self.showsNext(playback), let playback {
                Button(PlaylistControlText.next, systemImage: "forward.fill") { playback.next() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
                    .help(PlaylistControlText.next)
            }
            closeButton
        }
        .padding(.leading, player.playsInBar ? 6 : 16)
        .padding(.trailing, 4)
        .contentShape(.rect)
        // Ahead of the title's button, so a swipe skips without also opening the player; the
        // drag's least distance leaves taps to the buttons.
        .highPriorityGesture(swipeToSkip, including: isPanel ? .subviews : .all)
        .sensoryFeedback(.impact(weight: .light), trigger: swipeSkips)
    }

    /// A sideways swipe on the accessory skips through the playing list. A mostly vertical drag
    /// is left alone.
    private var swipeToSkip: some Gesture {
        DragGesture(minimumDistance: 20)
            .onEnded { value in
                let moved = value.translation
                guard abs(moved.width) > abs(moved.height), let playback, playback.endMessage == nil,
                    let skip = AccessorySwipe.skip(translation: moved.width, isPlayingList: Self.showsNext(playback)),
                    AccessorySwipe.hasPlace(
                        for: skip, position: playback.position, count: playback.count,
                        repeats: playback.repeatMode != .off)
                else { return }
                switch skip {
                case .next: playback.next()
                case .previous: playback.previous()
                }
                swipeSkips += 1
            }
    }

    private func itemLabel(glyph: Bool) -> some View {
        HStack(spacing: 12) {
            if glyph {
                Image(systemName: "play.fill")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(Self.title(player, playback))
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                if let subtitle = Self.playlistSubtitle(playback) ?? Self.subtitle(player) {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                // The panel shows the failure in its body under the bar instead.
                if !isPanel, let failure = player.failure {
                    PlayerFailureText(failure).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            if player.item?.kind == .recording {
                SettingsBadge(speedPercent: player.speedPercent, pitchCents: player.pitchCents)
            }
        }
    }
}

/// A recording's speed and pitch when either is away from its default: "75% +2".
struct SettingsBadge: View {
    let speedPercent: Int
    let pitchCents: Int

    var body: some View {
        if let badge = RecordingScreenText.badge(speedPercent: speedPercent, pitchCents: pitchCents),
            let label = RecordingScreenText.badgeLabel(speedPercent: speedPercent, pitchCents: pitchCents)
        {
            SettingsBadgeLabel(text: badge)
                .accessibilityLabel(label)
        }
    }
}

/// A small neutral capsule of figures, as "75% +2".
struct SettingsBadgeLabel: View {
    let text: String

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Text(text)
            .font(.caption)
            .monospacedDigit()
            .padding(.horizontal, 8)
            .frame(minHeight: 22)
            .background(neutralFill(colorScheme), in: .capsule)
            .fixedSize()
    }
}

/// While a loop repeats: "Repeating B part", which opens the recording's screen, and a Repeat
/// control that deselects the loop.
struct RepeatBadge: View {
    let player: PlayerModel
    let name: String

    /// About a third of an iPhone's bar at the default text size, so a long loop name truncates
    /// rather than pushing the player's own controls out; it grows with the caption it holds.
    @ScaledMetric(relativeTo: .caption) private var maxTextWidth: CGFloat = 120

    @Environment(\.playerWindow) private var window

    var body: some View {
        HStack(spacing: 0) {
            Button {
                if let item = player.item { player.open(item, in: window) }
            } label: {
                Text(PracticeText.repeating(name))
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: maxTextWidth)
                    .onSlateLabel()
                    .padding(.horizontal, 8)
                    .frame(minHeight: 22)
                    .background(.tint, in: .capsule)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Button {
                player.loops.select(nil)
            } label: {
                Label(PracticeText.repeatLoop(name), systemImage: "repeat")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.tint)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isSelected)
            .help(PracticeText.repeatLoop(name))
        }
        // The badge keeps its words up to its cap; the item's title beside it truncates first.
        .layoutPriority(1)
    }
}

/// Unloads the player: the bar's close control and the iPhone full player's.
struct PlayerCloseButton: View {
    let player: PlayerModel

    @Environment(ListPlayback.self) private var playback: ListPlayback?

    var body: some View {
        Button(PlayerBar.close, systemImage: "xmark") { PlayerBar.closePlayer(player, playback) }
            .help(PlayerBar.close)
    }
}

/// The iPad player: the bar, with a loaded link's player or a recording's scrubber under it.
/// Its sizes also bound the Mac's dock, which draws the player its own way.
struct PlayerPanel {
    /// The most of the window's height the panel takes, so a short window keeps its content.
    nonisolated static let maxShare: CGFloat = 0.4
    /// The web's width for a video player, so it is not stretched across the window.
    nonisolated static let videoWidth: CGFloat = 356
    /// The bar above the embed and the padding below it.
    nonisolated static let chrome: CGFloat = 44 + 12

    #if os(iOS)
        let player: PlayerModel
        let stage: EmbedStage
        /// The height of the window the panel floats in.
        let windowHeight: CGFloat
    #endif

    /// How big `embed` is drawn in a window `windowHeight` tall: its own height when there is
    /// room, otherwise as tall as keeps the panel within ``maxShare`` of the window. A video
    /// keeps its aspect ratio as it shrinks; `width` nil means the panel's full width.
    nonisolated static func embedSize(_ embed: Embed, windowHeight: CGFloat) -> (width: CGFloat?, height: CGFloat) {
        let natural = CGFloat(embed.points)
        let height = fitted(natural, windowHeight: windowHeight)
        guard embed.height == .video else { return (nil, height) }
        return (videoWidth * height / natural, height)
    }

    /// How tall the Apple Music card is drawn: as the Apple Music embed it plays in place of, so
    /// the panel keeps its size whichever one plays.
    nonisolated static func cardHeight(windowHeight: CGFloat) -> CGFloat {
        fitted(MusicPlayerCard.height, windowHeight: windowHeight)
    }

    /// `natural` when the window has room, otherwise as tall as keeps the panel within
    /// ``maxShare`` of the window.
    private nonisolated static func fitted(_ natural: CGFloat, windowHeight: CGFloat) -> CGFloat {
        min(natural, max(0, windowHeight * maxShare - chrome))
    }
}

#if os(iOS)
    extension PlayerPanel: View {
        var body: some View {
            VStack(spacing: 0) {
                PlayerBar(player: player, isPanel: true)
                if let embed = player.embed {
                    let size = Self.embedSize(embed, windowHeight: windowHeight)
                    EmbedView(stage: stage, embed: embed, prominence: .shown)
                        .frame(width: size.width, height: size.height)
                        .frame(maxWidth: size.width == nil ? .infinity : nil)
                        .clipShape(.rect(cornerRadius: 12))
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                } else if let music = player.music {
                    let height = Self.cardHeight(windowHeight: windowHeight)
                    if height > 0 {
                        // The bar above carries play and pause.
                        MusicPlayerCard(player: player, music: music, fixedHeight: height)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 12)
                    }
                } else if player.item?.kind == .recording {
                    HStack(spacing: 8) {
                        RecordingPlayerBody(player: player)
                        AudioRoutePicker()
                    }
                    .padding(.leading, 16)
                    .padding(.trailing, 4)
                    .padding(.bottom, 8)
                }
                PlaylistControlsRow()
            }
        }
    }
#endif

/// The iPhone's full player for a loaded link: its provider's player, the link out to the
/// provider, and Close player. Pulling it down leaves the bar, still playing.
struct LinkPlayerSheet: View {
    let player: PlayerModel
    let stage: EmbedStage

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let link = player.item?.link {
                    if let embed = player.embed {
                        Group {
                            if embed.height == .video {
                                EmbedView(stage: stage, embed: embed)
                                    .aspectRatio(16 / 9, contentMode: .fit)
                            } else {
                                EmbedView(stage: stage, embed: embed)
                                    .frame(height: CGFloat(embed.points))
                            }
                        }
                        .clipShape(.rect(cornerRadius: 12))
                    } else if let music = player.music {
                        MusicPlayerCard(player: player, music: music, showsPlay: true)
                    }
                    if let url = link.providerURL {
                        Link(destination: url) {
                            Label(PlayerBar.openIn(link.providerName), systemImage: "arrow.up.right")
                        }
                        .buttonStyle(.bordered)
                    }
                }
                PlaylistControlsRow()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .navigationTitle(player.title ?? "")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    PlayerCloseButton(player: player)
                }
            }
        }
        .partHeightSheet()
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
}

/// Holds a loaded link's player off screen while only the bar shows, so it keeps playing.
struct EmbedParking: ViewModifier {
    let player: PlayerModel
    let stage: EmbedStage

    func body(content: Content) -> some View {
        content.background(alignment: .bottom) {
            if let embed = player.embed {
                EmbedView(stage: stage, embed: embed, prominence: .parked)
                    .frame(width: 1, height: 1)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

#if os(iOS)
    extension View {
        /// The player panel floating at the bottom of the window while something is loaded.
        /// `frame` reports the room it takes in global space, empty when nothing is loaded, for the
        /// columns under it to clear with ``clearsPlayer(_:)``, since a split view's columns do not
        /// take a safe area inset from outside.
        func playerBar(_ player: PlayerModel, stage: EmbedStage, frame: Binding<CGRect>) -> some View {
            modifier(PlayerBarModifier(player: player, stage: stage, frame: frame))
        }

        /// Lifts this column's bottom edge clear of the player panel at `panel`, a frame from
        /// ``playerBar(_:stage:frame:)``, while the panel overlaps the column. The panel is narrower
        /// than a wide window, so a column beside it keeps its full height.
        func clearsPlayer(_ panel: CGRect) -> some View {
            modifier(ClearsPlayer(panel: panel))
        }
    }

    private struct ClearsPlayer: ViewModifier {
        let panel: CGRect

        @State private var frame = CGRect.zero

        func body(content: Content) -> some View {
            content
                .safeAreaPadding(.bottom, clearance)
                .onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: {
                    frame = $0
                }
        }

        private var clearance: CGFloat {
            guard !panel.isEmpty, panel.minX < frame.maxX, frame.minX < panel.maxX else { return 0 }
            return max(0, frame.maxY - panel.minY)
        }
    }

    private struct PlayerBarModifier: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage
        @Binding var frame: CGRect

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(ListPlayback.self) private var playback: ListPlayback?
        /// Unmeasured until the first layout, which shows the player at its own size rather than
        /// laying it out at no height.
        @State private var windowHeight: CGFloat = .infinity

        func body(content: Content) -> some View {
            content
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height + $0.safeAreaInsets.top + $0.safeAreaInsets.bottom
                } action: {
                    windowHeight = $0
                }
                .overlay(alignment: .bottom) {
                    if PlayerBar.isShown(player, playback) {
                        PlayerPanel(player: player, stage: stage, windowHeight: windowHeight)
                            .frame(maxWidth: 560)
                            .modifier(GlassPanel())
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                            .onGeometryChange(for: CGRect.self) {
                                $0.frame(in: .global)
                            } action: {
                                frame = $0
                            }
                            .onDisappear { frame = .zero }
                            .frame(maxWidth: .infinity)
                            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .animation(.default, value: PlayerBar.isShown(player, playback))
        }
    }

    /// The player panel's glass, a rounded rectangle around the bar and the player under it. A thick
    /// material where glass cannot be drawn.
    private struct GlassPanel: ViewModifier {
        @Environment(\.drawsGlass) private var drawsGlass

        func body(content: Content) -> some View {
            let shape = RoundedRectangle(cornerRadius: 24)
            if drawsGlass {
                content.glassEffect(.regular, in: shape)
            } else {
                content
                    .background(.thickMaterial, in: shape)
                    .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
            }
        }
    }
#endif

/// The accessory eases in when it first shows: a spring that scales it up, or a fade under
/// Reduce Motion. A scale shows inside the tab bar's container, which hosts the content and
/// owns its position.
private struct AccessoryRise: ViewModifier {
    let isEnabled: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var risen = false

    private var motion: PhoneMotion { isEnabled ? .resolve(reduceMotion: reduceMotion) : .none }

    func body(content: Content) -> some View {
        content
            .scaleEffect(risen || motion != .full ? 1 : 0.92)
            .opacity(risen || motion == .none ? 1 : 0)
            .onAppear {
                guard let animation = motion.animation(.spring(duration: 0.4, bounce: 0.25)) else { return }
                withAnimation(animation) { risen = true }
            }
    }
}
