import CrosstuneAudio

/// Drives the player one track at a time, as a list playing through.
@MainActor
public protocol PlayerQueue: AnyObject {
    /// The track ended on its own or MusicKit moved off it.
    func playerTrackEnded(_ end: TrackEnd)
    /// The track just queued cannot play here, and nothing is loaded.
    func playerCouldNotPlay()
    /// Something other than the queue took over the player, which has let go of the queue.
    func playerLeftQueue()
}
