import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import Foundation
import Observation

/// Opening links in their provider, and deciding how a loaded link plays: through MusicKit or
/// in its embed, within a deadline.
extension PlayerModel {
    /// Opens the loaded link in its provider's own app or site with `open`, and reports it.
    public func openLinkInProvider(with open: (URL) -> Void) {
        guard let item, let link = item.link, let url = link.providerURL else { return }
        analytics.linkOpened(provider: link.provider, linkID: item.id)
        open(url)
    }

    /// The loaded link's embed sent the musician on to `url`, reported only when it is the
    /// link's provider rather than a page such as a consent or sign-in prompt.
    public func embedOpened(_ url: URL) {
        guard let item, let link = item.link, Self.isProviderSite(url, provider: link.provider) else { return }
        analytics.linkOpened(provider: link.provider, linkID: item.id)
    }

    /// The domains each embedding provider's own pages live under. Wider than the hosts a pasted
    /// link is recognized by, since an embed links out to pages such as geo.music.apple.com.
    static let providerDomains: [String: [String]] = [
        "youtube": ["youtube.com", "youtu.be"],
        "spotify": ["spotify.com"],
        "apple_music": ["music.apple.com"],
        "tidal": ["tidal.com"],
        "soundcloud": ["soundcloud.com"],
        "bandcamp": ["bandcamp.com"],
        "internet_archive": ["archive.org"],
        "slippery_hill": ["slippery-hill.com"],
    ]

    static func isProviderSite(_ url: URL, provider: String) -> Bool {
        guard let host = url.host()?.lowercased(), let domains = providerDomains[provider] else { return false }
        return domains.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    /// Plays a just-loaded link: through MusicKit when it can, otherwise in its embed, in full.
    /// `autoplay` false leaves a MusicKit track paused at its start, `asksAccess` false plays the
    /// embed rather than show the access prompt, and `expandsOnFallBack` false leaves the player
    /// as it is shown when the embed plays instead.
    func startLink(
        _ item: PlayerItem, autoplay: Bool = true, asksAccess: Bool = true, expandsOnFallBack: Bool = true
    ) {
        guard let kind = item.link?.appleMusic, let appleMusic else {
            linkAudio = .embed
            isExpanded = item.link != nil
            return
        }
        let expands = expandsOnFallBack
        decide(
            item, kind: kind, appleMusic: appleMusic, queued: false, autoplay: autoplay, asksAccess: asksAccess
        ) { [weak self] emptyingQueue in
            self?.fallBack(emptyingQueue: emptyingQueue, expanding: expands)
        }
    }

    /// Finds, loads, and starts the Apple Music song `kind` for the link `item` through MusicKit,
    /// handing every outcome that cannot play it to `fail`, which takes whether the load left a
    /// queue to empty. `queued` plays it guarded, yielding the audio session first and never
    /// prompting for access; `autoplay` false leaves it paused at its start.
    func decide(
        _ item: PlayerItem, kind: AppleMusicKind, appleMusic: AppleMusic, queued: Bool, autoplay: Bool,
        asksAccess: Bool, fail: @escaping @MainActor (_ emptyingQueue: Bool) -> Void
    ) {
        linkAudio = .deciding
        holdsAutoplay = false
        if !queued { isExpanded = false }
        let id = item.id
        startDeadline(id) { fail(true) }
        deciding = Task { [weak self] in
            var access = await appleMusic.access.current()
            guard let self, isDeciding(id) else { return }
            if access == .notAsked && asksAccess {
                deadline?.cancel()
                analytics.appleMusicAnswered(await appleMusic.access.request())
                guard isDeciding(id) else { return }
                startDeadline(id) { fail(true) }
                // Read again under the deadline: the subscription lookup needs the network.
                access = await appleMusic.access.current()
                guard isDeciding(id) else { return }
            }
            guard access == .fullTracks else {
                fail(false)
                return
            }
            // Checked here as well as after the load: yielding would switch the session of a
            // take that started while access was looked up.
            guard !isCapturing() else {
                close()
                return
            }
            if queued { audio.yieldSessionToMusic() }
            var started = false
            defer { if queued && !started { playbackDidNotStart() } }
            guard await appleMusic.player.load(kind, guarded: queued), isDeciding(id) else {
                guard isDeciding(id) else { return }
                fail(true)
                return
            }
            guard !isCapturing() else {
                // A queue left behind would answer the headphones' play button during the take.
                close()
                return
            }
            // The queue left while the song loaded, so nothing watches this guard queue to play it.
            let abandoned = queued && queue == nil
            if autoplay && !abandoned && !holdsAutoplay {
                guard await appleMusic.player.start(), isDeciding(id) else {
                    guard isDeciding(id) else {
                        // A start that lands after the deadline or a close would play under the
                        // embed, or with no player shown, unless another link now owns MusicKit.
                        if linkAudio != .native && linkAudio != .deciding { appleMusic.player.stop() }
                        return
                    }
                    fail(true)
                    return
                }
                started = true
            }
            finishDeciding()
            linkAudio = .native
            loadedGuarded = queued
            // The queue may have left while the song loaded.
            releaseGuard()
        }
    }

    /// Whether the decision for link `id` still holds: not cancelled, and the link still loaded.
    func isDeciding(_ id: String) -> Bool {
        !Task.isCancelled && holds(.link, id: id) && linkAudio == .deciding
    }

    /// Runs `onTimeout` if link `id` is still being decided once the decision timeout passes.
    func startDeadline(_ id: String, onTimeout: @escaping @MainActor () -> Void) {
        deadline?.cancel()
        let timeout = decisionTimeout
        let sleep = sleep
        deadline = Task { [weak self] in
            try? await sleep(timeout)
            guard let self, isDeciding(id) else { return }
            onTimeout()
        }
    }

    /// Plays a queued Apple Music song through MusicKit, guarded so its own next and previous
    /// report to the queue. Never asks for access and never plays the embed: a song that
    /// cannot play here goes back to the queue.
    func startQueuedSong(_ item: PlayerItem, autoplay: Bool = true) {
        guard case .song? = item.link?.appleMusic, let kind = item.link?.appleMusic, let appleMusic else {
            queuedItemCannotPlay()
            return
        }
        decide(item, kind: kind, appleMusic: appleMusic, queued: true, autoplay: autoplay, asksAccess: false) {
            [weak self] emptyingQueue in
            guard let self else { return }
            if queue != nil {
                queuedItemCannotPlay()
            } else {
                // The queue left mid-decision, so this is a single song again.
                fallBack(emptyingQueue: emptyingQueue, expanding: false)
            }
        }
    }

    /// Lets go of a loaded item whose row is gone: a queue moves on to its next track, and
    /// otherwise the player closes.
    func dropGoneItem() {
        if queuedNowPlaying != nil {
            queuedItemCannotPlay()
        } else {
            close()
        }
    }

    /// Closes the queued item, which cannot play here, and tells the queue. The queue stays
    /// attached, with its session held, for the track it picks next, which the player shows as
    /// it was: in full or not.
    func queuedItemCannotPlay() {
        unloadItem(keepsExpansion: queue != nil)
        queue?.playerCouldNotPlay()
    }

    /// Ends the decision with the link's embed, in full unless `expanding` is false.
    /// `emptyingQueue` clears whatever a load left in the MusicKit queue; a decision that never
    /// loaded has nothing to clear.
    func fallBack(emptyingQueue: Bool = true, expanding: Bool) {
        finishDeciding()
        if emptyingQueue { appleMusic?.player.stop() }
        linkAudio = .embed
        guard expanding else { return }
        expandedWindow = nil
        isExpanded = true
    }

    func finishDeciding() {
        deciding?.cancel()
        deciding = nil
        deadline?.cancel()
        deadline = nil
    }
}
