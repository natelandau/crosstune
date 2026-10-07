import CrosstuneAudio
import SwiftUI

/// Words the playlist controls show. A tune is never a song here.
public enum PlaylistControlText {
    public static let shuffle = ListPlayText.shuffle
    public static let previous = "Previous tune"
    public static let next = "Next tune"
    public static let repeatOff = "Repeat off"
    public static let repeatList = "Repeat list"
    public static let repeatOne = "Repeat tune"

    /// Under the tune's title in the bar: "Session set · 2 of 5".
    public static func subtitle(listName: String, position: Int, count: Int) -> String {
        "\(listName) \u{B7} \(position) of \(count)"
    }

    public static func repeatLabel(_ mode: RepeatMode) -> String {
        switch mode {
        case .off: repeatOff
        case .list: repeatList
        case .one: repeatOne
        }
    }

    public static func repeatSymbol(_ mode: RepeatMode) -> String {
        mode == .one ? "repeat.1" : "repeat"
    }
}

/// The full player's row for a list playing as a playlist: shuffle, previous, next, and repeat.
/// Empty while no playlist plays.
public struct PlaylistControls: View {
    private let playback: ListPlayback

    public init(playback: ListPlayback) {
        self.playback = playback
    }

    public var body: some View {
        if playback.isActive {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                button(
                    PlaylistControlText.shuffle, symbol: "shuffle", highlighted: playback.isShuffled,
                    selected: playback.isShuffled
                ) {
                    playback.setShuffled(!playback.isShuffled)
                }
                button(PlaylistControlText.previous, symbol: "backward.fill") { playback.previous() }
                button(PlaylistControlText.next, symbol: "forward.fill") { playback.next() }
                button(
                    PlaylistControlText.repeatLabel(playback.repeatMode),
                    symbol: PlaylistControlText.repeatSymbol(playback.repeatMode),
                    highlighted: playback.repeatMode != .off, selected: playback.repeatMode != .off
                ) {
                    playback.cycleRepeat()
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func button(
        _ title: String, symbol: String, highlighted: Bool = false, selected: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .imageScale(.large)
                .foregroundStyle(highlighted ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help(title)
    }
}

/// The controls row in a view that shows the player in full, drawn only while a playlist plays.
struct PlaylistControlsRow: View {
    @Environment(ListPlayback.self) private var playback: ListPlayback?

    var body: some View {
        if let playback {
            PlaylistControls(playback: playback)
        }
    }
}

extension PlayerBar {
    /// Closes the player and ends the playlist driving it, and clears a message left by a
    /// playlist that stopped with nothing loaded.
    static func closePlayer(_ player: PlayerModel, _ playback: ListPlayback?) {
        player.close()
        playback?.end()
    }
}

extension ListPlayback {
    /// The app's playlist on this device's remote commands.
    public static func device(player: PlayerModel) -> ListPlayback {
        ListPlayback(player: player, commands: RemoteTrackCommands())
    }
}
