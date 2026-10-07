import CrosstuneAnalytics
import SwiftUI

/// The loaded item and a close button, as the player's bar on iPhone and iPad, where a tap on the
/// item shows its player in full and a sideways swipe skips through a playing list. A recording
/// leads with its play and pause control. The Mac docks its own bar, ``PlayerDockBar``.
public struct PlayerBar: View {
    public static let close = "Close player"
    /// The bar's name for the tap that shows the player in full.
    public static let show = "Show player"

    /// The link out to the provider's own page: "Open in YouTube".
    public static func openIn(_ providerName: String) -> String {
        "Open in \(providerName)"
    }

    private let player: PlayerModel

    @Environment(\.playerWindow) private var window
    @Environment(ListPlayback.self) private var playback: ListPlayback?
    /// How many tunes a swipe has skipped, which each skip's haptic follows.
    @State private var swipeSkips = 0

    public init(player: PlayerModel) {
        self.player = player
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
                .modifier(AccessoryRise())
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
                .frame(maxWidth: .infinity, minHeight: minimumTapTarget, alignment: .leading)
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
            .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
            .contentShape(.rect)
    }

    @ViewBuilder private var loadedBar: some View {
        let isRecording = player.item?.kind == .recording
        let glyph = Self.showsGlyph(player)
        HStack(spacing: 4) {
            if player.playsInBar {
                RecordingPlayButton(player: player)
            }
            if !Self.canExpand(player) {
                itemLabel(glyph: glyph)
            } else {
                Button {
                    player.expand(in: window, source: .dock)
                } label: {
                    itemLabel(glyph: glyph)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Self.showLabel(player, playback: playback))
            }
            if isRecording, player.loops.isRepeating, let name = player.loops.selectedName {
                RepeatBadge(player: player, name: name)
            }
            if Self.showsNext(playback), let playback {
                Button(PlaylistControlText.next, systemImage: "forward.fill") { playback.next() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
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
        .highPriorityGesture(swipeToSkip)
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
                    .contentMask()
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                if let subtitle = Self.playlistSubtitle(playback) ?? Self.subtitle(player) {
                    Text(subtitle)
                        .contentMask()
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let failure = player.failure {
                    PlayerFailureText(failure).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: minimumTapTarget, alignment: .leading)
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
                if let item = player.item { player.open(item, in: window, source: .dock) }
            } label: {
                Text(PracticeText.repeating(name))
                    .contentMask()
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: maxTextWidth)
                    .onSlateLabel()
                    .padding(.horizontal, 8)
                    .frame(minHeight: 22)
                    .background(.tint, in: .capsule)
                    .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Button {
                player.loops.select(nil)
            } label: {
                Label(PracticeText.repeatLoop(name), systemImage: "repeat")
                    .contentMask()
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.tint)
                    .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
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

/// The iPhone accessory eases in when it first shows: a spring that scales it up, or a fade
/// under Reduce Motion. A scale shows inside the tab bar's accessory, which hosts the content and
/// owns its position. A host that brings the bar in with a motion of its own turns this off with
/// ``EnvironmentValues/playerBarRises``.
private struct AccessoryRise: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.playerBarRises) private var rises
    @State private var risen = false

    private var motion: PhoneMotion { .resolve(reduceMotion: reduceMotion) }

    func body(content: Content) -> some View {
        if rises { rising(content) } else { content }
    }

    private func rising(_ content: Content) -> some View {
        content
            .scaleEffect(risen || motion != .full ? 1 : 0.92)
            .opacity(risen || motion == .none ? 1 : 0)
            .onAppear {
                guard let animation = motion.animation(.spring(duration: 0.4, bounce: 0.25)) else { return }
                withAnimation(animation) { risen = true }
            }
    }
}

extension EnvironmentValues {
    /// Whether the player's bar eases in by itself when it first shows. Off where its host
    /// brings it in.
    @Entry var playerBarRises = true
}
