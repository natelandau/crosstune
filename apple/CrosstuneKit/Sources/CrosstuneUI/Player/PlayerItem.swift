import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation

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
    /// A recording's stored row, whose trim, speed, and pitch it plays; nil for a link.
    public let recording: Recording?

    public init(
        kind: Kind, id: String, title: String, tuneTitle: String? = nil, link: LinkPlayback? = nil,
        recording: Recording? = nil
    ) {
        self.kind = kind
        self.id = id
        self.title = title
        self.tuneTitle = tuneTitle
        self.link = link
        self.recording = recording
    }
}

/// A loaded link's player and the provider's own page for it.
public struct LinkPlayback: Hashable, Sendable {
    public let embed: Embed
    /// The stored provider, such as `youtube`.
    public let provider: String
    /// The tune the link belongs to.
    public let tuneID: String
    /// The provider's name, for "Open in YouTube".
    public let providerName: String
    /// The provider's page for the link, or nil when the stored URL must not be opened.
    public let providerURL: URL?
    /// What MusicKit can play in place of the embed, nil for anything but an Apple Music song or
    /// album.
    public let appleMusic: AppleMusicKind?

    public init(
        embed: Embed, provider: String, tuneID: String, providerName: String, providerURL: URL?,
        appleMusic: AppleMusicKind? = nil
    ) {
        self.embed = embed
        self.provider = provider
        self.tuneID = tuneID
        self.providerName = providerName
        self.providerURL = providerURL
        self.appleMusic = appleMusic
    }
}

/// How a loaded link plays.
public enum LinkAudio: Equatable, Sendable {
    /// Asking for Apple Music access or finding the track, with nothing playing yet.
    case deciding
    /// In full through MusicKit, from the bar like a recording.
    case native
    /// In the provider's embed.
    case embed
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
            tuneTitle: tuneTitle, recording: recording)
    }

    /// A link as the player loads it, or nil when it has no player and can only open elsewhere.
    /// Only a play tap loads the player, so the embed always starts playing.
    public static func link(_ link: RecordingLink) -> PlayerItem? {
        guard link.deletedAt == nil, let embed = Embed.for(link, autoplay: true) else { return nil }
        return PlayerItem(
            kind: .link, id: link.id, title: LinkText.title(link),
            link: LinkPlayback(
                embed: embed, provider: link.provider, tuneID: link.tuneID,
                providerName: LinkText.providerLabel(link.provider),
                providerURL: LinkText.outboundURL(link.url),
                appleMusic: link.provider == "apple_music" ? appleMusicKind(link.url) : nil))
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

/// A recording's audio file on this device, with the file row that says where in the source
/// its audio starts.
public struct RecordingAudioFile: Equatable, Sendable {
    public let url: URL
    public let file: RecordingFile

    public init(url: URL, file: RecordingFile) {
        self.url = url
        self.file = file
    }
}
