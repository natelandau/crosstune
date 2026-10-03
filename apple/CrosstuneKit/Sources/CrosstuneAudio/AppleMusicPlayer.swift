import Combine
import CrosstuneCommands
import Foundation
@preconcurrency import MusicKit
import Observation

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
    /// it is not found or the request fails.
    func load(_ kind: AppleMusicKind) async -> Bool
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
    @ObservationIgnored private let player = ApplicationMusicPlayer.shared
    @ObservationIgnored private var observers: Set<AnyCancellable> = []
    /// Moves on whenever MusicKit's state or queue changes, which it reports through Combine
    /// rather than Observation, so every property read here redraws its view.
    private var revision = 0

    public private(set) var hasAlbum = false

    public init() {
        for publisher in [player.state.objectWillChange, player.queue.objectWillChange] {
            publisher
                .sink { [weak self] in
                    // Combine announces the change before it lands; read it on the next turn.
                    Task { @MainActor in self?.revision += 1 }
                }
                .store(in: &observers)
        }
    }

    public var isPlaying: Bool {
        _ = revision
        return player.state.playbackStatus == .playing
    }

    public var elapsed: TimeInterval { player.playbackTime }

    public var duration: TimeInterval? {
        _ = revision
        guard case .song(let song) = player.queue.currentEntry?.item else { return nil }
        return song.duration
    }

    public var trackTitle: String? {
        _ = revision
        return player.queue.currentEntry?.title
    }

    public var artwork: Artwork? {
        _ = revision
        return player.queue.currentEntry?.artwork
    }

    public func play() {
        Task { try? await player.play() }
    }

    public func pause() {
        player.pause()
    }

    public func seek(to seconds: TimeInterval) {
        player.playbackTime = clampedPosition(seconds, duration: duration)
    }

    public func load(_ kind: AppleMusicKind) async -> Bool {
        do {
            switch kind {
            case .song(let id):
                var request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(id))
                Self.findEquivalents(&request)
                guard let song = try await request.response().items.first else { return false }
                player.queue = [song]
                hasAlbum = false
            case .album(let id):
                var request = MusicCatalogResourceRequest<Album>(matching: \.id, equalTo: MusicItemID(id))
                request.properties = [.tracks]
                Self.findEquivalents(&request)
                guard let album = try await request.response().items.first, let first = album.tracks?.first
                else { return false }
                player.queue = ApplicationMusicPlayer.Queue(album: album, startingAt: first)
                hasAlbum = true
            }
            try await player.prepareToPlay()
            return true
        } catch {
            return false
        }
    }

    public func skipTrack(forward: Bool) {
        Task {
            if forward {
                try? await player.skipToNextEntry()
            } else {
                try? await player.skipToPreviousEntry()
            }
        }
    }

    public func stop() {
        player.stop()
        player.queue = []
        hasAlbum = false
    }

    /// Asks for the same recording in the account's storefront when a link came from another
    /// country's store. Older systems look up the ID as given.
    private static func findEquivalents<Item>(_ request: inout MusicCatalogResourceRequest<Item>) {
        if #available(iOS 26.4, macOS 26.4, *) {
            request.options = [.findEquivalents]
        }
    }
}
