import CrosstuneCommands
import CrosstuneStore
import Foundation

// A compiled Regex is immutable once built but is not itself Sendable; these are never mutated
// after this file finishes loading, so sharing them across tasks is safe.
private nonisolated(unsafe) let spotifyRefPattern = #/(track|album|episode|playlist):([A-Za-z0-9]+)/#
private nonisolated(unsafe) let tidalRefPattern = #/(track|album|playlist|video):([0-9A-Fa-f-]+)/#
private nonisolated(unsafe) let bandcampRefPattern = #/(album|track):([0-9]+)/#
private nonisolated(unsafe) let archiveRefPattern = #/[A-Za-z0-9._-]+/#
private nonisolated(unsafe) let soundcloudHostPattern = #/(?:www\.|m\.)?soundcloud\.com/#

/// A provider's own player for a link, built from the stored provider, provider ref, and URL
/// with no network call. The page it loads is the provider's embed, framed with the same
/// permissions the provider's embed code asks for.
public struct Embed: Hashable, Sendable {
    /// How tall the player is.
    public enum Height: Hashable, Sendable {
        /// A fixed height in points.
        case points(Int)
        /// A video player, 200 points tall.
        case video
    }

    public static let videoHeight = 200

    public let src: String
    public let height: Height
    /// The frame's `allow` permissions.
    public let allow: String
    /// The frame's `sandbox` flags, or nil for an unsandboxed frame.
    public let sandbox: String?

    public init(src: String, height: Height, allow: String, sandbox: String? = nil) {
        self.src = src
        self.height = height
        self.allow = allow
        self.sandbox = sandbox
    }

    /// The player's height in points.
    public var points: Int {
        switch height {
        case .points(let points): points
        case .video: Self.videoHeight
        }
    }

    static let basicAllow = "autoplay; encrypted-media"
    static let youtubeAllow = "autoplay; encrypted-media; picture-in-picture; fullscreen"
    static let spotifyAllow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
    static let appleAllow = "autoplay *; encrypted-media *"
    static let appleSandbox =
        "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
    static let tidalAllow =
        "autoplay; encrypted-media; fullscreen; clipboard-write https://embed.tidal.com; web-share"
    static let tidalSandbox =
        "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
    static let archiveAllow = "autoplay; encrypted-media; fullscreen"

    /// The in-app player for a link, or nil when the link can only open elsewhere.
    public static func `for`(_ link: RecordingLink, autoplay: Bool = false) -> Embed? {
        self.for(provider: link.provider, providerRef: link.providerRef, url: link.url, autoplay: autoplay)
    }

    /// The in-app player for a link's stored fields, or nil when the link can only open elsewhere.
    public static func `for`(provider: String, providerRef: String?, url: String, autoplay: Bool = false) -> Embed? {
        let ref = providerRef ?? ""
        switch provider {
        case "youtube":
            guard let id = youtubeID(provider: provider, providerRef: providerRef) else { return nil }
            return Embed(
                src: "https://www.youtube-nocookie.com/embed/\(id)?playsinline=1\(autoplay ? "&autoplay=1" : "")",
                height: .video, allow: youtubeAllow)
        case "spotify":
            guard let match = ref.wholeMatch(of: spotifyRefPattern) else { return nil }
            return Embed(
                src: "https://open.spotify.com/embed/\(match.1)/\(match.2)", height: .points(152), allow: spotifyAllow)
        case "apple_music":
            guard var components = webURL(url), components.host == "music.apple.com" else { return nil }
            components.scheme = "https"
            components.host = "embed.music.apple.com"
            // A web address's path is never empty, as a browser's URL parser reads it.
            if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
            guard let src = components.string else { return nil }
            return Embed(src: src, height: .points(175), allow: appleAllow, sandbox: appleSandbox)
        case "tidal":
            guard let match = ref.wholeMatch(of: tidalRefPattern) else { return nil }
            let height: Height =
                switch match.1 {
                case "track": .points(120)
                case "video": .video
                default: .points(150)
                }
            return Embed(
                src: "https://embed.tidal.com/\(match.1)s/\(match.2)", height: height, allow: tidalAllow,
                sandbox: tidalSandbox)
        case "soundcloud":
            guard let host = webURL(url)?.host, host.wholeMatch(of: soundcloudHostPattern) != nil else { return nil }
            return Embed(
                src:
                    "https://w.soundcloud.com/player/?url=\(encodeURIComponent(url))\(autoplay ? "&auto_play=true" : "")",
                height: .points(166), allow: basicAllow)
        case "bandcamp":
            guard let match = ref.wholeMatch(of: bandcampRefPattern) else { return nil }
            return Embed(
                src:
                    "https://bandcamp.com/EmbeddedPlayer/\(match.1)=\(match.2)/size=large/artwork=small/tracklist=false/transparent=true/",
                height: .points(120), allow: basicAllow)
        case "internet_archive":
            guard ref.wholeMatch(of: archiveRefPattern) != nil else { return nil }
            return Embed(src: "https://archive.org/embed/\(ref)", height: .points(60), allow: archiveAllow)
        default:
            return nil
        }
    }

    /// An absolute URL with a host, the host lowercased as a browser's URL parser reads it.
    private static func webURL(_ raw: String) -> URLComponents? {
        guard var components = URLComponents(string: raw), components.scheme != nil,
            let host = components.host, !host.isEmpty
        else { return nil }
        components.host = host.lowercased()
        return components
    }

    /// JavaScript's `encodeURIComponent`: everything but letters, digits, and `-_.!~*'()`.
    private static func encodeURIComponent(_ text: String) -> String {
        var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        allowed.insert(charactersIn: "-_.!~*'()")
        return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
    }
}
