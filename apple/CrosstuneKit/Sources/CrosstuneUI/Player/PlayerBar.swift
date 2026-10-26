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

    /// The playing list's name and position, shown under the tune's title; nil while no list plays.
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
    /// when either is away from its default, and a failure the bar shows, since the button's
    /// name replaces the label's.
    static func showLabel(_ player: PlayerModel, playback: ListPlayback? = nil) -> String {
        let badge =
            player.item?.kind == .recording
            ? RecordingScreenText.badgeLabel(speedPercent: player.speedPercent, pitchCents: player.pitchCents) : nil
        return [show, title(player, playback), playlistSubtitle(playback) ?? subtitle(player), badge, player.failure]
            .compactMap(\.self)
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

    /// What shows where the tune was: why the playlist stopped, and Close player to dismiss it.
    private func messageBar(_ message: String) -> some View {
        HStack(spacing: 4) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.inkSecondary)
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
            .foregroundStyle(.inkSecondary)
            .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
            .contentShape(.rect)
    }

    @ViewBuilder private var loadedBar: some View {
        let isRecording = player.item?.kind == .recording
        let glyph = Self.showsGlyph(player)
        HStack(spacing: 4) {
            if player.playsInBar {
                RecordingPlayButton(player: player)
                    .dynamicTypeSize(...DynamicTypeSize.large)
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
                    .foregroundStyle(.inkSecondary)
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
                        .foregroundStyle(.inkSecondary)
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

/// Unloads the player: the bar's close control and the iPhone full player's.
struct PlayerCloseButton: View {
    let player: PlayerModel

    @Environment(ListPlayback.self) private var playback: ListPlayback?

    var body: some View {
        Button(PlayerBar.close, systemImage: "xmark") { PlayerBar.closePlayer(player, playback) }
            .help(PlayerBar.close)
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
