import CrosstuneAudio
import CrosstuneStore
import Foundation
import Observation

/// Something the player can load: one of the musician's recordings or a link, by id, with the
/// title the player shows.
public struct PlayerItem: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case recording
        case link
    }

    public let kind: Kind
    public let id: String
    public let title: String
    /// The tune a recording belongs to, for the system's Now Playing; nil for a link.
    public let tuneTitle: String?
    /// What a link plays and where its provider shows it; nil for a recording.
    public let link: LinkPlayback?

    public init(kind: Kind, id: String, title: String, tuneTitle: String? = nil, link: LinkPlayback? = nil) {
        self.kind = kind
        self.id = id
        self.title = title
        self.tuneTitle = tuneTitle
        self.link = link
    }
}

/// A loaded link's player and the provider's own page for it.
public struct LinkPlayback: Hashable, Sendable {
    public let embed: Embed
    /// The provider's name, for "Open in YouTube".
    public let providerName: String
    /// The provider's page for the link, or nil when the stored URL must not be opened.
    public let providerURL: URL?

    public init(embed: Embed, providerName: String, providerURL: URL?) {
        self.embed = embed
        self.providerName = providerName
        self.providerURL = providerURL
    }
}

extension PlayerItem {
    /// A recording as the player names it: its label, then its tune's title, then when it was
    /// made. The player stands apart from any heading, so the tune is never dropped.
    public static func recording(
        _ recording: Recording, tuneTitle: String?, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> PlayerItem {
        PlayerItem(
            kind: .recording, id: recording.id,
            title: RecordingText.title(recording, tuneTitle: tuneTitle, locale: locale, timeZone: timeZone),
            tuneTitle: tuneTitle)
    }

    /// A link as the player loads it, or nil when it has no player and can only open elsewhere.
    /// Only a play tap loads the player, so the embed always starts playing.
    public static func link(_ link: RecordingLink) -> PlayerItem? {
        guard link.deletedAt == nil, let embed = Embed.for(link, autoplay: true) else { return nil }
        return PlayerItem(
            kind: .link, id: link.id, title: LinkText.title(link),
            link: LinkPlayback(
                embed: embed, providerName: LinkText.providerLabel(link.provider),
                providerURL: LinkText.outboundURL(link.url)))
    }
}

/// Where a loaded recording's audio stands.
public enum RecordingAudio: Equatable, Sendable {
    /// Looking for the audio on this device, or fetching it from the server.
    case fetching
    /// In the audio player, playing or paused.
    case loaded
    /// Neither on this device nor fetched: offline, not ready, or the fetch failed.
    case unavailable
}

/// What is loaded in the player, shared by every screen that can start playback. At most one
/// item is loaded, and it stays loaded while the musician browses until they close it. Only one
/// thing plays at a time: loading a recording takes a link's player away, and loading a link
/// stops a recording.
@MainActor
@Observable
public final class PlayerModel {
    /// Finds a recording's audio file on this device, fetching it first when it is not here.
    /// Nil when there is nothing to play.
    public typealias AudioSource = @MainActor (_ recordingID: String) async -> URL?

    /// The loaded item, or nil when nothing is loaded.
    public private(set) var item: PlayerItem?
    /// Whether the iPhone shows the loaded item's player in full rather than only its bar.
    /// The split view always shows it in full and keeps this false, so a window that turns
    /// compact opens on the bar.
    public var isExpanded = false
    /// Where the loaded recording's audio stands; nil unless a recording is loaded.
    public private(set) var recordingAudio: RecordingAudio?
    /// Plays a loaded recording's audio.
    public let audio: any AudioPlayback
    /// Where a recording's audio comes from. The shell sets it once it has a store; until then
    /// a recording has no audio to play, and a recording loaded before it arrives looks again.
    @ObservationIgnored public var audioSource: AudioSource? {
        didSet {
            guard let item, item.kind == .recording, recordingAudio != .loaded else { return }
            loadAudio(item)
        }
    }

    /// Whether a take is being recorded, when nothing may play: playback would change the
    /// audio session under the microphone, or be recorded into the take. The shell answers it
    /// from every window's record sheet; the audio player also stays silent during a take.
    @ObservationIgnored public var isCapturing: @MainActor () -> Bool = { false }

    @ObservationIgnored private var fetch: Task<Void, Never>?

    /// The loaded item's title, or nil when nothing is loaded.
    public var title: String? { item?.title }

    public var isLoaded: Bool { item != nil }

    /// - Parameter audio: Plays recordings; nil is the device's player.
    public init(audio: (any AudioPlayback)? = nil) {
        self.audio = audio ?? AudioPlayer()
    }

    /// Whether `kind` with `id` is the loaded item.
    public func holds(_ kind: PlayerItem.Kind, id: String) -> Bool {
        item?.kind == kind && item?.id == id
    }

    /// Loads an item and starts it, in place of whatever was loaded. Only a play tap calls this:
    /// opening a screen never loads the player. A link opens in full, since its provider's player
    /// is what plays it; a recording plays from the bar. Refused, returning false, while a take
    /// is being recorded.
    @discardableResult
    public func play(_ item: PlayerItem) -> Bool {
        guard !isCapturing() else { return false }
        stopAudio()
        self.item = item
        isExpanded = item.link != nil
        if item.kind == .recording { loadAudio(item) }
        return true
    }

    /// Shows the loaded item's player in full.
    public func expand() {
        guard item != nil else { return }
        isExpanded = true
    }

    /// Unloads the item, which stops it and takes the player off screen.
    public func close() {
        stopAudio()
        item = nil
        isExpanded = false
    }

    /// Tries the loaded recording's audio again after it could not be found or fetched.
    public func retryAudio() {
        guard let item, item.kind == .recording, recordingAudio == .unavailable else { return }
        loadAudio(item)
    }

    /// Follows the stored row of the loaded link `id`: a new title or player replaces the
    /// loaded one, and a row that is gone, deleted, or no longer playable closes the player.
    /// Does nothing when another item is loaded.
    public func linkChanged(id: String, to row: RecordingLink?) {
        guard holds(.link, id: id) else { return }
        guard let row, let next = PlayerItem.link(row) else {
            close()
            return
        }
        if next != item { item = next }
    }

    /// Follows the stored row of the loaded recording `id` and the title of its tune: a new
    /// name shows in place, and a row that is gone or deleted closes the player. The audio
    /// already playing carries on. Does nothing when another item is loaded.
    public func recordingChanged(
        id: String, to row: Recording?, tuneTitle: String?, locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        guard holds(.recording, id: id) else { return }
        guard let row, row.deletedAt == nil else {
            close()
            return
        }
        let next = PlayerItem.recording(row, tuneTitle: tuneTitle, locale: locale, timeZone: timeZone)
        guard next != item else { return }
        item = next
        if recordingAudio == .loaded {
            audio.retitle(NowPlaying(title: next.title, tuneTitle: next.tuneTitle))
        }
    }

    private func loadAudio(_ item: PlayerItem) {
        fetch?.cancel()
        recordingAudio = .fetching
        let source = audioSource
        let id = item.id
        fetch = Task { [weak self] in
            let url = await source?(id)
            guard let self, !Task.isCancelled, holds(.recording, id: id) else { return }
            guard let url else {
                recordingAudio = .unavailable
                return
            }
            let loaded = self.item ?? item
            audio.load(url, nowPlaying: NowPlaying(title: loaded.title, tuneTitle: loaded.tuneTitle))
            // A take started while the audio was fetched keeps the microphone to itself.
            if !isCapturing() { audio.play() }
            recordingAudio = .loaded
        }
    }

    private func stopAudio() {
        fetch?.cancel()
        fetch = nil
        if recordingAudio == .loaded { audio.unload() }
        recordingAudio = nil
    }
}
