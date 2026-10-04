import Combine
import CrosstuneCommands
import Foundation
@preconcurrency import MusicKit
import Observation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "apple-music")

/// Plays Apple Music catalog songs in full for a subscriber. ``AppleMusicPlayer`` is the
/// device's; a test stands in its own.
@MainActor
public protocol MusicPlayback: PlaybackTransport {
    /// The current entry's title, nil with nothing queued.
    var trackTitle: String? { get }
    /// The current entry's artist, nil with nothing queued.
    var artistName: String? { get }
    /// The current entry's artwork, nil with nothing queued.
    var artwork: Artwork? { get }
    /// Whether the queue holds an album, whose tracks can be stepped through.
    var hasAlbum: Bool { get }

    /// Finds `kind` in the account's storefront and queues it, paused at its start. False when
    /// it is not found, the request fails, the calling task is cancelled, or a ``start()`` ran
    /// during the lookup, which leaves the queue as it was. `guarded`, for a song, queues it
    /// between two copies of itself, so MusicKit's next and previous move to a copy and the
    /// move is reported through ``PlaybackTransport/onTrackEnd``; an album ignores it.
    func load(_ kind: AppleMusicKind, guarded: Bool) async -> Bool
    /// Plays the loaded queue and says whether it started.
    func start() async -> Bool
    func skipTrack(forward: Bool)
    /// Stops and empties the queue, so the system's remote commands have nothing to start. For
    /// a guarded song, any play MusicKit starts after it is paused at once.
    func stop()
    /// Returns once MusicKit is done with the entry a previous moved to, so the next track
    /// can take the audio without MusicKit interrupting it.
    func settleAfterPrevious() async
}

extension MusicPlayback {
    public func load(_ kind: AppleMusicKind) async -> Bool {
        await load(kind, guarded: false)
    }
}

/// What the player needs to play Apple Music links in full. Without it every link plays in its
/// provider's embed.
@MainActor
public struct AppleMusic {
    public let access: any AppleMusicAccess
    public let player: any MusicPlayback

    public init(access: any AppleMusicAccess, player: any MusicPlayback) {
        self.access = access
        self.player = player
    }
}

/// `ApplicationMusicPlayer`, which plays inside this app and leaves the Music app's own queue
/// alone. MusicKit publishes what it plays to Now Playing and answers the remote commands itself.
///
/// A guarded song sits between two copies of itself, so MusicKit's next and previous move to a
/// copy rather than stopping or restarting it. The player watches for the move, pauses the copy
/// before it is heard, and reports the move as a ``TrackEnd``.
@MainActor
@Observable
public final class AppleMusicPlayer: MusicPlayback {
    /// Taken on the first load, so a musician who never plays Apple Music never wakes MusicKit.
    @ObservationIgnored private var player: ApplicationMusicPlayer?
    @ObservationIgnored private var stateObserver: AnyCancellable?
    @ObservationIgnored private var queueObserver: AnyCancellable?
    @ObservationIgnored private let isCapturing: @MainActor () -> Bool
    /// Moves on whenever MusicKit's state or queue changes, which it reports through Combine
    /// rather than Observation, so every property read here redraws its view.
    private var revision = 0

    public private(set) var hasAlbum = false
    @ObservationIgnored public var onTrackEnd: (@MainActor (TrackEnd) -> Void)?

    /// Whether the queue holds a guarded song whose moves are still to be reported.
    @ObservationIgnored private var guarded = false
    /// The middle entry of a guarded song, known only once it plays: MusicKit fills the queue
    /// after it is set, so it reads back empty until then.
    @ObservationIgnored private var realEntryID: String?
    @ObservationIgnored private var songDuration: TimeInterval?
    @ObservationIgnored private var position = SongPosition()
    @ObservationIgnored private var positionTicker: Task<Void, Never>?
    /// Set once the app is done with a guarded song. MusicKit can go on to play the entry a
    /// previous moved to whatever it is told, so any play it starts from then on is paused.
    @ObservationIgnored private var hasLetGo = false
    @ObservationIgnored private var strayPlays = StrayPlays()
    /// Moves on with each start, so a load that a play overtook leaves the playing queue alone.
    @ObservationIgnored private var plays = 0

    /// - Parameter isCapturing: Whether a take is being recorded now, when nothing may play.
    public init(isCapturing: @escaping @MainActor () -> Bool = { Recorder.hasActiveCapture }) {
        self.isCapturing = isCapturing
    }

    public var isPlaying: Bool {
        _ = revision
        return player?.state.playbackStatus == .playing
    }

    public var elapsed: TimeInterval { player?.playbackTime ?? 0 }

    public var duration: TimeInterval? {
        _ = revision
        guard case .song(let song) = player?.queue.currentEntry?.item else { return nil }
        return song.duration
    }

    public var trackTitle: String? {
        _ = revision
        return player?.queue.currentEntry?.title
    }

    public var artistName: String? {
        _ = revision
        return player?.queue.currentEntry?.subtitle
    }

    public var artwork: Artwork? {
        _ = revision
        return player?.queue.currentEntry?.artwork
    }

    public func play() {
        Task { _ = await start() }
    }

    public func start() async -> Bool {
        guard let player, !isCapturing() else { return false }
        plays += 1
        hasLetGo = false
        do {
            try await player.play()
            if guarded && realEntryID == nil { watchMoves(of: player) }
            return true
        } catch {
            logger.error("An Apple Music track did not start: \(error, privacy: .public)")
            return false
        }
    }

    public func pause() {
        player?.pause()
    }

    public func seek(to seconds: TimeInterval) {
        guard let player else { return }
        let place = clampedPosition(seconds, duration: duration)
        player.playbackTime = place
        if let realEntryID, player.queue.currentEntry?.id == realEntryID { position.seek(to: place) }
    }

    public func load(_ kind: AppleMusicKind, guarded: Bool) async -> Bool {
        let player = shared()
        let playsAtLoad = plays
        do {
            switch kind {
            case .song(let id):
                var request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(id))
                Self.findEquivalents(&request)
                guard let song = try await request.response().items.first else {
                    logger.notice("Apple Music has no song \(id, privacy: .public) in this storefront")
                    return false
                }
                // Each check sits on the main actor beside the write it guards, so a load whose
                // link was replaced never takes the queue from the link that replaced it.
                try Task.checkCancellation()
                guard plays == playsAtLoad else { return false }
                takeQueue(guarded: guarded)
                if guarded {
                    // No `startingAt:`: macOS rejects a start entry whose song repeats in the
                    // queue, and iOS ignores it, so the middle entry is chosen once prepared.
                    player.queue = ApplicationMusicPlayer.Queue([
                        MusicPlayer.Queue.Entry(song), MusicPlayer.Queue.Entry(song), MusicPlayer.Queue.Entry(song),
                    ])
                } else {
                    player.queue = [song]
                }
                hasAlbum = false
            case .album(let id):
                var request = MusicCatalogResourceRequest<Album>(matching: \.id, equalTo: MusicItemID(id))
                request.properties = [.tracks]
                Self.findEquivalents(&request)
                guard let album = try await request.response().items.first, let first = album.tracks?.first
                else {
                    logger.notice("Apple Music has no album \(id, privacy: .public) in this storefront")
                    return false
                }
                try Task.checkCancellation()
                guard plays == playsAtLoad else { return false }
                takeQueue(guarded: false)
                player.queue = ApplicationMusicPlayer.Queue(album: album, startingAt: first)
                hasAlbum = true
            }
            observeQueue(of: player)
            try await player.prepareToPlay()
            try Task.checkCancellation()
            if guarded, case .song = kind { startOnMiddleEntry(of: player) }
            return true
        } catch is CancellationError {
            return false
        } catch {
            logger.error("An Apple Music link could not be loaded: \(error, privacy: .public)")
            return false
        }
    }

    public func skipTrack(forward: Bool) {
        guard let player else { return }
        Task {
            if forward {
                try? await player.skipToNextEntry()
            } else {
                try? await player.skipToPreviousEntry()
            }
        }
    }

    public func stop() {
        guard let player else { return }
        if guarded { letGo() }
        player.stop()
        player.queue = []
        hasAlbum = false
        observeQueue(of: player)
    }

    /// Waits on iOS only: there MusicKit plays the entry its previous moved to about a second
    /// later, which would interrupt the next track's audio session. The Mac's MusicKit does not,
    /// and there is no session to interrupt.
    public func settleAfterPrevious() async {
        #if os(iOS)
            let start = ContinuousClock.now
            while !previousHasSettled(waitingSince: start, strayPausedAt: strayPlays.pausedAt, now: .now) {
                do {
                    try await Task.sleep(for: .milliseconds(50))
                } catch {
                    return
                }
            }
        #endif
    }

    // MARK: Guard

    /// Takes MusicKit back for a new queue, dropping any watch on the one it replaces.
    private func takeQueue(guarded: Bool) {
        stopWatching()
        hasLetGo = false
        self.guarded = guarded
    }

    private func startOnMiddleEntry(of player: ApplicationMusicPlayer) {
        let entries = player.queue.entries
        guard entries.count == 3 else {
            logger.notice("A guarded Apple Music queue holds \(entries.count, privacy: .public) entries")
            return
        }
        player.queue.currentEntry = entries[entries.index(after: entries.startIndex)]
    }

    private func watchMoves(of player: ApplicationMusicPlayer) {
        guard let entry = player.queue.currentEntry else { return }
        realEntryID = entry.id
        if case .song(let song) = entry.item { songDuration = song.duration } else { songDuration = nil }
        position = SongPosition()
        positionTicker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(SongPosition.interval))
                guard let self else { return }
                self.readPosition()
            }
        }
    }

    private func stopWatching() {
        positionTicker?.cancel()
        positionTicker = nil
        realEntryID = nil
        songDuration = nil
    }

    private func readPosition() {
        guard let player, let realEntryID, player.queue.currentEntry?.id == realEntryID else { return }
        position.reading(player.playbackTime)
    }

    private func letGo() {
        stopWatching()
        guarded = false
        if !hasLetGo {
            hasLetGo = true
            strayPlays = StrayPlays()
        }
    }

    /// Runs on each change MusicKit announces.
    private func changed() {
        revision += 1
        guard let player else { return }
        if hasLetGo {
            pauseStrayPlay(of: player)
        } else {
            reportMove(of: player)
        }
    }

    private func reportMove(of player: ApplicationMusicPlayer) {
        guard let realEntryID, let current = player.queue.currentEntry?.id, current != realEntryID else { return }
        let ids = player.queue.entries.map(\.id)
        guard let from = ids.firstIndex(of: realEntryID), let to = ids.firstIndex(of: current),
            let end = trackEnd(fromIndex: from, toIndex: to, positionBefore: position.seconds, duration: songDuration)
        else { return }
        player.pause()
        letGo()
        onTrackEnd?(end)
    }

    private func pauseStrayPlay(of player: ApplicationMusicPlayer) {
        guard strayPlays.status(playing: player.state.playbackStatus == .playing, at: .now) else { return }
        player.pause()
    }

    private func shared() -> ApplicationMusicPlayer {
        if let player { return player }
        let player = ApplicationMusicPlayer.shared
        self.player = player
        stateObserver = changes(of: player.state.objectWillChange)
        return player
    }

    /// Follows the queue object the player holds now; setting the queue can replace it.
    private func observeQueue(of player: ApplicationMusicPlayer) {
        queueObserver = changes(of: player.queue.objectWillChange)
    }

    /// Calls ``changed()`` after each change `publisher` announces. Combine announces a change
    /// before it lands, and MusicKit may announce from any thread, so it is read on the main
    /// queue's next turn.
    private func changes(of publisher: AnyPublisher<Void, Never>) -> AnyCancellable {
        publisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.changed() }
    }

    /// Asks for the same recording in the account's storefront when a link came from another
    /// country's store. Older systems look up the ID as given.
    private static func findEquivalents<Item>(_ request: inout MusicCatalogResourceRequest<Item>) {
        if #available(iOS 26.4, macOS 26.4, *) {
            request.options = [.findEquivalents]
        }
    }
}

/// How a guarded song's move from the entry at `fromIndex` to the one at `toIndex` ended it, nil
/// when it did not move. A natural end also moves forward, from a position near the end.
func trackEnd(
    fromIndex: Int, toIndex: Int, positionBefore: TimeInterval, duration: TimeInterval?
) -> TrackEnd? {
    if toIndex < fromIndex { return .previous(elapsed: positionBefore) }
    guard toIndex > fromIndex else { return nil }
    if let duration, positionBefore >= duration - 3 { return .finished }
    return .next
}

/// A guarded song's position, from readings taken while it plays. MusicKit resets the
/// position just before it reports a move, so a single reading that falls by more than a
/// second is set aside. A second low reading in a row is kept, as a scrub back gives.
struct SongPosition: Equatable {
    /// How often the position is read.
    static let interval: TimeInterval = 0.25

    private(set) var seconds: TimeInterval = 0
    private var setAside = false

    /// The app moved the position itself, so the next reading follows it rather than being set
    /// aside as a reset.
    mutating func seek(to seconds: TimeInterval) {
        self.seconds = seconds
        setAside = false
    }

    mutating func reading(_ reading: TimeInterval) {
        if reading < seconds - 1 && !setAside {
            setAside = true
            return
        }
        seconds = reading
        setAside = false
    }
}

/// The plays MusicKit starts after the app let go of a guarded song. Statuses still reading
/// playing from before the app's own pause are paused but not counted: only a play after a
/// stopped status is MusicKit starting the entry it moved to.
struct StrayPlays: Equatable {
    /// When the last counted play was paused.
    private(set) var pausedAt: ContinuousClock.Instant?
    private var sawStopped = false

    /// Notes a status MusicKit reported at `now`, and says whether to pause it.
    mutating func status(playing: Bool, at now: ContinuousClock.Instant) -> Bool {
        guard playing else {
            sawStopped = true
            return false
        }
        if sawStopped { pausedAt = now }
        return true
    }
}

/// Whether the hand-off after a MusicKit previous, waiting since `waitingSince`, may go ahead:
/// a stray play was paused a quarter second ago or more, or a second and a half has passed with
/// none.
func previousHasSettled(
    waitingSince: ContinuousClock.Instant, strayPausedAt: ContinuousClock.Instant?, now: ContinuousClock.Instant
) -> Bool {
    if let strayPausedAt, now >= strayPausedAt + .seconds(0.25) { return true }
    return now >= waitingSince + .seconds(1.5)
}
