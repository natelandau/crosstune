import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import Foundation
import Observation

public enum ListPlaybackText {
    /// Shown once every remaining tune in a playlist has failed to play in a row.
    public static let nothingLeft = "Nothing left in this list can play"
}

/// A list playing through as a playlist: its order, repeat and shuffle, and the player it drives
/// one tune at a time. Each tune's source is resolved when its turn comes, so a pin or setting
/// changed during play takes effect from the next tune.
@MainActor
@Observable
public final class ListPlayback: PlayerQueue {
    /// What a playlist plays for one tune: its source, and the tune's title, which the bar and
    /// Now Playing show in place of the source's own name.
    public struct Turn: Hashable, Sendable {
        public let title: String
        public let item: PlayerItem

        public init(title: String, item: PlayerItem) {
            self.title = title
            self.item = item
        }
    }

    /// Turns a tune of a list into what plays now, or nil to skip it. Set by the shell.
    @ObservationIgnored public var resolve: @MainActor (_ listID: String, _ tuneID: String) async -> Turn? = {
        _, _ in nil
    }
    public private(set) var listID: String?
    public private(set) var listName: String?
    public private(set) var currentTuneID: String?
    /// The title of the tune the player holds, once its source has loaded.
    public private(set) var title: String?
    /// The current tune's place in the play order, counting from 1.
    public private(set) var position = 0
    public private(set) var count = 0
    public private(set) var repeatMode: RepeatMode
    public private(set) var isShuffled: Bool
    /// Why the last playlist stopped on its own, until another starts or this one is ended.
    public private(set) var endMessage: String?

    public var isActive: Bool { listID != nil }
    /// Whether the player holds the current tune. False while a tune resolves, when the player
    /// still holds the one being left.
    public var isSettled: Bool { loadedGeneration == generation }

    static let repeatKey = "listPlayback.repeat"
    static let shuffleKey = "listPlayback.shuffle"
    /// Seconds into a tune past which previous restarts it rather than going back.
    static let restartAfter: TimeInterval = 3

    private let player: PlayerModel
    private let commands: any TrackCommands
    private let defaults: UserDefaults
    private let analytics: AnalyticsClient
    @ObservationIgnored private var rng: any RandomNumberGenerator
    @ObservationIgnored private var order: PlaylistOrder?
    /// Bumped by every turn and every change of course, so an answer that arrives after the
    /// playlist has moved on is dropped.
    private var generation = 0
    /// The generation whose item the player holds. The player's reports count only while it is
    /// the current one, since until a new turn loads, they are about the tune being left.
    private var loadedGeneration: Int?
    /// Tunes skipped in a row since one last played through or the musician moved.
    @ObservationIgnored private var skips = 0
    /// What started the turn under way. A tune that cannot play passes it on to the next.
    @ObservationIgnored private var trigger = PlaybackTrigger.tap
    /// The playlist's start, reported once its first tune loads, so a playlist that never plays
    /// is never counted.
    @ObservationIgnored private var unreportedStart: AnalyticsEvent?

    public init(
        player: PlayerModel, commands: any TrackCommands, defaults: UserDefaults = .standard,
        rng: any RandomNumberGenerator = SystemRandomNumberGenerator(), analytics: AnalyticsClient = .noop
    ) {
        self.player = player
        self.commands = commands
        self.defaults = defaults
        self.analytics = analytics
        self.rng = rng
        repeatMode = defaults.string(forKey: Self.repeatKey).flatMap(RepeatMode.init(rawValue:)) ?? .off
        isShuffled = defaults.bool(forKey: Self.shuffleKey)
        player.onPlayedOutsideQueue = { [weak self] in self?.endMessage = nil }
    }

    /// Plays the tunes `report` says will play, so the bar counts the same tunes as the list.
    /// Whatever was loaded stops at once rather than playing on while the first tune resolves.
    public func start(listID: String, name: String, report: PlaylistReport, shuffled: Bool) {
        player.close()
        start(listID: listID, name: name, tuneIDs: report.playable, shuffled: shuffled)
    }

    /// Plays `tuneIDs` from `tuneID`, or from the start or a random tune when nil, in place of
    /// any playlist already playing. A tune listed twice plays once, where it first appears.
    public func start(listID: String, name: String, tuneIDs: [String], shuffled: Bool, at tuneID: String? = nil) {
        var seen = Set<String>()
        let unique = tuneIDs.filter { seen.insert($0).inserted }
        setShuffledDefault(shuffled)
        order = PlaylistOrder(tuneIDs: unique, shuffled: shuffled, startAt: tuneID, using: &rng)
        self.listID = listID
        listName = name
        count = unique.count
        title = nil
        skips = 0
        endMessage = nil
        player.queue = self
        commands.enable(next: { [weak self] in self?.next() }, previous: { [weak self] in self?.previous() })
        unreportedStart = .playlistStarted(
            shuffle: shuffled, repeat: CrosstuneAnalytics.RepeatMode(repeatMode), count: unique.count, listID: listID)
        playCurrent(.tap)
    }

    /// Plays `tuneID` now. False when the tune is not in the playlist or has nothing to play;
    /// the caller then ends the playlist and plays the tune on its own.
    public func jump(to tuneID: String) async -> Bool {
        guard let listID, var probe = order, probe.jump(to: tuneID) else { return false }
        let settled = isSettled
        let turn = advanceGeneration()
        guard let resolved = await resolve(listID, tuneID) else {
            // The tune already playing still reports, unless something else moved meanwhile.
            if settled, turn == generation { loadedGeneration = turn }
            return false
        }
        // Something else took over while the tune resolved, and that stands.
        guard turn == generation, isActive, order?.jump(to: tuneID) == true else { return true }
        skips = 0
        trigger = .tap
        showCurrent()
        load(resolved, turn: turn)
        return true
    }

    /// Skips to the next tune. At the end with repeat off the playlist ends, paused on its last tune.
    public func next() {
        guard isActive else { return }
        skips = 0
        guard order?.next(repeat: repeatMode, using: &rng) != nil else {
            // While the next tune resolves, the player still holds the one being left.
            if player.queue === self { player.transport?.pause() }
            end()
            return
        }
        playCurrent(.skip)
    }

    /// Restarts the tune once it has played past ``restartAfter`` seconds, and at the first tune;
    /// otherwise goes back one tune.
    public func previous() {
        guard isActive else { return }
        skips = 0
        if isSettled, let transport = player.transport,
            transport.elapsed > Self.restartAfter || position == 1
        {
            transport.seek(to: 0)
            return
        }
        _ = order?.previous()
        playCurrent(.skip)
    }

    /// Off, then repeat the list, then repeat the tune, then off again.
    public func cycleRepeat() {
        repeatMode =
            switch repeatMode {
            case .off: .list
            case .list: .one
            case .one: .off
            }
        defaults.set(repeatMode.rawValue, forKey: Self.repeatKey)
    }

    /// Shuffles the tunes after the current one, or returns to list order from it.
    public func setShuffled(_ on: Bool) {
        setShuffledDefault(on)
        guard var order else { return }
        order.setShuffled(on, using: &rng)
        self.order = order
        if isSettled { position = order.position }
    }

    /// Stops driving the player and leaves whatever it holds as it is.
    public func end() {
        finish(message: nil)
    }

    // MARK: PlayerQueue

    public func playerTrackEnded(_ end: TrackEnd) {
        guard isActive, isSettled else { return }
        // A track with no length never counts as played, so repeat cannot go round without end
        // when every other tune fails.
        if end != .finished || (player.transport?.duration ?? 0) > 0 { skips = 0 }
        switch end {
        case .finished:
            guard order?.afterFinish(repeat: repeatMode, using: &rng) != nil else {
                self.end()
                return
            }
            playCurrent(.autoAdvance)
        case .next:
            next()
        case .previous(let elapsed):
            // MusicKit has already moved off the song, so either way the tune loads afresh. On
            // iOS MusicKit then plays the entry it moved to on its own, which would interrupt
            // whatever starts before it is done.
            let turn = advanceGeneration()
            Task { [weak self] in
                await self?.player.appleMusic?.player.settleAfterPrevious()
                guard let self, turn == generation, isActive else { return }
                if elapsed <= Self.restartAfter { _ = order?.previous() }
                playCurrent(.skip)
            }
        }
    }

    public func playerCouldNotPlay() {
        guard isActive, isSettled else { return }
        skip()
    }

    public func playerLeftQueue() {
        clear(message: nil)
    }

    // MARK: Turns

    /// Resolves the current tune and plays it as `trigger` started it, or skips it when it has
    /// nothing to play.
    private func playCurrent(_ trigger: PlaybackTrigger) {
        guard let listID, let tuneID = order?.current else {
            end()
            return
        }
        self.trigger = trigger
        showCurrent()
        let turn = advanceGeneration()
        Task { [weak self] in
            guard let self else { return }
            let resolved = await resolve(listID, tuneID)
            guard turn == generation, isActive else { return }
            guard let resolved else {
                skip()
                return
            }
            load(resolved, turn: turn)
        }
    }

    private func load(_ resolved: Turn, turn: Int) {
        loadedGeneration = turn
        title = resolved.title
        // The bar's title and subtitle change together, once the tune is the one held.
        position = order?.position ?? 0
        // Refused only while a take is recording, which the playlist gives way to.
        let origin = listID.map { PlayOrigin.list(id: $0) } ?? .dock
        let nowPlaying = NowPlaying(title: resolved.title, tuneTitle: listName)
        guard player.playQueued(resolved.item, nowPlaying: nowPlaying, origin: origin, trigger: trigger) else {
            end()
            return
        }
        if let unreportedStart {
            analytics.send(unreportedStart)
            self.unreportedStart = nil
        }
    }

    /// Moves past a tune that cannot play. Once every tune has failed in a row, or the end of a
    /// playlist that does not repeat is reached by failing, nothing left can play.
    private func skip() {
        skips += 1
        guard skips < count, order?.next(repeat: repeatMode, using: &rng) != nil else {
            finish(message: ListPlaybackText.nothingLeft)
            return
        }
        playCurrent(trigger)
    }

    private func showCurrent() {
        currentTuneID = order?.current
        // With no tune of the list shown yet, the position leads; afterwards it waits for its
        // title, so the bar never names one tune with another's place.
        if title == nil { position = order?.position ?? 0 }
    }

    private func advanceGeneration() -> Int {
        generation += 1
        return generation
    }

    private func setShuffledDefault(_ on: Bool) {
        isShuffled = on
        defaults.set(on, forKey: Self.shuffleKey)
    }

    /// Lets go of the player and clears the playlist. With a message, playback stops, since what
    /// the player holds is a tune the playlist has already left.
    private func finish(message: String?) {
        if player.queue === self { player.leaveQueue() }
        if message != nil { player.close() }
        clear(message: message)
    }

    private func clear(message: String?) {
        generation += 1
        loadedGeneration = nil
        commands.disable()
        order = nil
        listID = nil
        listName = nil
        currentTuneID = nil
        title = nil
        position = 0
        count = 0
        skips = 0
        unreportedStart = nil
        endMessage = message
    }
}
