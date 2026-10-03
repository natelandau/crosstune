import CrosstuneCommands
import CrosstuneStore
import Foundation
import SwiftUI

public enum ListRowText {
    /// Spoken after a row whose tune has nothing to play.
    public static let notPlayable = "No recordings or links"

    /// The play button's name: "Play Soldier's Joy", or "Close player for Soldier's Joy" once
    /// its item is loaded.
    public static func playLabel(tuneTitle: String, loaded: Bool) -> String {
        loaded ? "\(MediaText.closePlayer) for \(tuneTitle)" : "\(MediaText.play) \(tuneTitle)"
    }

    /// The control's name for an action: the play label, "Open <link>" as the tune screen names
    /// a link with no player, or "Downloading Soldier's Joy". Nil for an inert slot.
    public static func label(for action: ListRowPlay.Action, tuneTitle: String, loaded: Bool) -> String? {
        switch action {
        case .play: playLabel(tuneTitle: tuneTitle, loaded: loaded)
        case .open(_, let linkTitle): "\(LinkText.open) \(linkTitle)"
        case .downloading: "\(RecordingText.downloading) \(tuneTitle)"
        case .inert: nil
        }
    }
}

/// What a list row's play button does for a tune.
public enum ListRowPlay {
    public enum Action: Hashable, Sendable {
        /// Loads the item in the player: a recording or an Apple Music track plays from the bar,
        /// and an embed opens in full. A recording only the server holds is fetched as it plays.
        case play(PlayerItem)
        /// A link with no player goes to its provider's own site.
        case open(URL, linkTitle: String)
        /// The chosen recording is being fetched to this device.
        case downloading
        /// Something is chosen but cannot play or open now: a recording with no audio anywhere
        /// yet, or a link with neither a player nor a safe address.
        case inert
    }

    /// What the button does for the entry, or nil when the tune has no recording or link to use.
    /// `loaded` says whether the player holds a recording, which keeps its stop control through
    /// the fetch the player starts; `downloading` says whether a fetch of a recording is under way.
    public static func action(
        for entry: ListEntry, playFirst: String, loaded: (String) -> Bool = { _ in false },
        downloading: (String) -> Bool = { _ in false }
    ) -> Action? {
        guard
            let source = rowSource(
                userTune: entry.userTune, recordings: entry.recordings, links: entry.links, playFirst: playFirst)
        else { return nil }
        switch source {
        case .recording(let recording):
            let control = RecordingText.control(
                recording, file: entry.files[recording.id], loaded: loaded(recording.id),
                downloading: downloading(recording.id))
            switch control {
            case .play, .close, .download: return .play(.recording(recording, tuneTitle: entry.tune.title))
            case .downloading: return .downloading
            case .none: return .inert
            }
        case .link(let link):
            if let item = PlayerItem.link(link) { return .play(item) }
            guard let url = LinkText.outboundURL(link.url) else { return .inert }
            return .open(url, linkTitle: LinkText.title(link))
        }
    }

    /// Whether the action's item is the one the player holds, which the button shows as stop.
    static func isLoaded(_ action: Action, holds: (PlayerItem.Kind, String) -> Bool) -> Bool {
        guard case .play(let item) = action else { return false }
        return holds(item.kind, item.id)
    }

    /// Whether a take being recorded holds the control back. Only playing waits; a link out
    /// does not touch the audio session.
    static func isBlocked(_ action: Action, capturing: Bool) -> Bool {
        guard case .play = action else { return false }
        return capturing
    }

    /// The button's symbol, or nil for an action that shows no button.
    static func symbol(for action: Action, loaded: Bool) -> String? {
        switch action {
        case .play: loaded ? "stop.fill" : "play.fill"
        case .open: "arrow.up.right"
        case .downloading, .inert: nil
        }
    }
}

/// A list row's play button: play, stop for the loaded item, or the link out; a spinner while
/// the chosen recording downloads; an empty slot for a choice that cannot act; or a muted mark
/// when the tune has nothing to play.
struct ListRowPlayButton: View {
    let entry: ListEntry
    let action: ListRowPlay.Action?

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch action {
        case nil:
            Image(systemName: "circle.slash")
                .foregroundStyle(.secondary)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHidden(true)
        case .inert?:
            Color.clear
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)
        case .downloading?:
            ProgressView()
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(
                    ListRowText.label(for: .downloading, tuneTitle: entry.tune.title, loaded: false) ?? "")
        case let action?:
            let loaded = ListRowPlay.isLoaded(action) { player?.holds($0, id: $1) ?? false }
            Button {
                switch action {
                case .play(let item):
                    if loaded { player?.close() } else { player?.play(item) }
                case .open(let url, _): openURL(url)
                case .downloading, .inert: break
                }
            } label: {
                Image(systemName: ListRowPlay.symbol(for: action, loaded: loaded) ?? "play.fill")
                    .font(.title3)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(ListRowPlay.isBlocked(action, capturing: recorders?.isCapturing ?? false))
            .accessibilityLabel(ListRowText.label(for: action, tuneTitle: entry.tune.title, loaded: loaded) ?? "")
        }
    }
}
