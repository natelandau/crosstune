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
    /// The current entry's artwork, nil with nothing queued.
    var artwork: Artwork? { get }
    /// Whether the queue holds an album, whose tracks can be stepped through.
    var hasAlbum: Bool { get }

    /// Finds `kind` in the account's storefront and queues it, paused at its start. False when
    /// it is not found, the request fails, or the calling task is cancelled, which leaves the
    /// queue as it was.
    func load(_ kind: AppleMusicKind) async -> Bool
    /// Plays the loaded queue and says whether it started.
    func start() async -> Bool
    func skipTrack(forward: Bool)
    /// Stops and empties the queue, so the system's remote commands have nothing to start.
    func stop()
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

    public var artwork: Artwork? {
        _ = revision
        return player?.queue.currentEntry?.artwork
    }

    public func play() {
        Task { _ = await start() }
    }

    public func start() async -> Bool {
        guard let player, !isCapturing() else { return false }
        do {
            try await player.play()
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
        player?.playbackTime = clampedPosition(seconds, duration: duration)
    }

    public func load(_ kind: AppleMusicKind) async -> Bool {
        let player = shared()
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
                player.queue = [song]
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
                player.queue = ApplicationMusicPlayer.Queue(album: album, startingAt: first)
                hasAlbum = true
            }
            observeQueue(of: player)
            try await player.prepareToPlay()
            try Task.checkCancellation()
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
        player.stop()
        player.queue = []
        hasAlbum = false
        observeQueue(of: player)
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

    /// Moves ``revision`` on after each change `publisher` announces. Combine announces a change
    /// before it lands, and MusicKit may announce from any thread, so it is read on the main
    /// queue's next turn.
    private func changes(of publisher: AnyPublisher<Void, Never>) -> AnyCancellable {
        publisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.revision += 1 }
    }

    /// Asks for the same recording in the account's storefront when a link came from another
    /// country's store. Older systems look up the ID as given.
    private static func findEquivalents<Item>(_ request: inout MusicCatalogResourceRequest<Item>) {
        if #available(iOS 26.4, macOS 26.4, *) {
            request.options = [.findEquivalents]
        }
    }
}
