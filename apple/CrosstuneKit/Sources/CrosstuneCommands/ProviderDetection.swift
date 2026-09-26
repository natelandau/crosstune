import Foundation

// A compiled Regex is immutable once built but is not itself Sendable; these are never mutated
// after this file finishes loading, so sharing them across tasks is safe.
private nonisolated(unsafe) let youtubeIDPattern = #/^[A-Za-z0-9_-]{11}$/#
private nonisolated(unsafe) let spotifyPathPattern =
    #/^\/(?:intl-[a-z]{2}\/)?(track|album|episode|playlist)\/([A-Za-z0-9]+)/#
// listen.tidal.com nests a track under its album; the track is the recording.
private nonisolated(unsafe) let tidalPathPattern =
    #/^\/(?:browse\/)?(?:album\/\d+\/)?(track|album|playlist|video)\/([0-9A-Fa-f-]+)/#
private nonisolated(unsafe) let archivePathPattern = #/^\/details\/([A-Za-z0-9._-]+)/#

/// What a pasted URL turns out to be: a known provider and, when the link names one item, a
/// `type:id` reference into it.
public struct DetectedProvider: Equatable, Sendable {
    public let provider: String
    public let providerRef: String?

    public init(provider: String, providerRef: String?) {
        self.provider = provider
        self.providerRef = providerRef
    }
}

private func typedRef<Pattern: RegexComponent>(_ pattern: Pattern, in path: String) -> String?
where Pattern.RegexOutput == (Substring, Substring, Substring) {
    guard let match = path.firstMatch(of: pattern) else { return nil }
    return "\(match.output.1):\(match.output.2)"
}

private func firstCapture<Pattern: RegexComponent>(_ pattern: Pattern, in path: String) -> String?
where Pattern.RegexOutput == (Substring, Substring) {
    guard let match = path.firstMatch(of: pattern) else { return nil }
    return String(match.output.1)
}

private func host(of url: URL) -> String {
    let raw = (url.host ?? "").lowercased()
    guard raw.hasPrefix("www.") || raw.hasPrefix("m."), let dot = raw.firstIndex(of: ".") else { return raw }
    return String(raw[raw.index(after: dot)...])
}

private func trimSlashes(_ path: String) -> String {
    var trimmed = Substring(path)
    if trimmed.hasPrefix("/") { trimmed.removeFirst() }
    if trimmed.hasSuffix("/") { trimmed.removeLast() }
    return String(trimmed)
}

private func queryItem(_ name: String, in url: URL) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
}

private func youtubeRef(_ url: URL) -> String? {
    let path = url.path
    var candidate: String?
    if path == "/watch" {
        candidate = queryItem("v", in: url)
    } else if ["/shorts/", "/embed/", "/live/"].contains(where: { path.hasPrefix($0) }) {
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        candidate = segments.count > 2 ? String(segments[2]) : nil
    }
    guard let candidate, candidate.wholeMatch(of: youtubeIDPattern) != nil else { return nil }
    return candidate
}

private func appleRef(_ url: URL) -> String? {
    if let item = queryItem("i", in: url), !item.isEmpty { return item }
    var path = Substring(url.path)
    if path.hasSuffix("/") { path.removeLast() }
    let last = path.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
    return !last.isEmpty && last.allSatisfy({ $0.isASCII && $0.isNumber }) ? last : nil
}

/// What `raw` points to: a known provider's site, with a `type:id` reference where the link
/// names one track, album, or item, or `other` for anything else, including text that does not
/// parse as an absolute URL.
public func detectProvider(_ raw: String) -> DetectedProvider {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: trimmed), url.scheme != nil else {
        return DetectedProvider(provider: "other", providerRef: nil)
    }
    let host = host(of: url)
    if host == "youtube.com" || host == "youtube-nocookie.com" || host == "music.youtube.com" {
        return DetectedProvider(provider: "youtube", providerRef: youtubeRef(url))
    }
    if host == "youtu.be" {
        let id = trimSlashes(url.path)
        return DetectedProvider(provider: "youtube", providerRef: id.wholeMatch(of: youtubeIDPattern) != nil ? id : nil)
    }
    if host == "open.spotify.com" {
        return DetectedProvider(provider: "spotify", providerRef: typedRef(spotifyPathPattern, in: url.path))
    }
    if host == "music.apple.com" {
        return DetectedProvider(provider: "apple_music", providerRef: appleRef(url))
    }
    if host == "bandcamp.com" || host.hasSuffix(".bandcamp.com") {
        return DetectedProvider(provider: "bandcamp", providerRef: nil)
    }
    if host == "soundcloud.com" {
        return DetectedProvider(provider: "soundcloud", providerRef: nil)
    }
    if host == "tidal.com" || host == "listen.tidal.com" {
        return DetectedProvider(provider: "tidal", providerRef: typedRef(tidalPathPattern, in: url.path))
    }
    if host == "archive.org" {
        return DetectedProvider(
            provider: "internet_archive", providerRef: firstCapture(archivePathPattern, in: url.path))
    }
    return DetectedProvider(provider: "other", providerRef: nil)
}

/// The id a YouTube link's player embeds, or nil for any other provider or an unrecognized
/// reference.
public func youtubeID(provider: String, providerRef: String?) -> String? {
    guard provider == "youtube", let providerRef, providerRef.wholeMatch(of: youtubeIDPattern) != nil else {
        return nil
    }
    return providerRef
}
