import CrosstuneStore
import Foundation

/// A recording or link a tune can play.
public enum TuneSource: Hashable, Sendable {
    case recording(Recording)
    case link(RecordingLink)
}

/// The recording or link a user tune pins as the one lists play first.
public enum PlaySourcePin: Hashable, Sendable {
    case recording(id: String)
    case link(id: String)
}

/// Why a list leaves a tune out.
public enum PlaylistSkip: Hashable, Sendable {
    case nothing
    case noCapableLink
    case needsSubscription
    case needsConnection
    /// The tune's recordings are its only source a list can play, and none has audio here now.
    case recordingsNotHere
}

public enum PlaylistChoice: Hashable, Sendable {
    case play(TuneSource)
    case skip(PlaylistSkip)
}

/// The live recordings and links that belong to the user tune's tune, so a pin to a deleted row
/// or another tune's row never counts.
private func liveSources(
    of userTune: UserTune, recordings: [Recording], links: [RecordingLink]
) -> (recordings: [Recording], links: [RecordingLink]) {
    (
        recordings.filter { $0.deletedAt == nil && $0.tuneID == userTune.tuneID },
        links.filter { $0.deletedAt == nil && $0.tuneID == userTune.tuneID }
    )
}

private func isAppleMusicSong(_ link: RecordingLink) -> Bool {
    guard link.provider == "apple_music", case .song = appleMusicKind(link.url) else { return false }
    return true
}

/// What a list row plays for a tune: a valid pin, else the user's play-first choice, else
/// whatever exists. A pin counts only when its row is live and belongs to this tune.
public func rowSource(
    userTune: UserTune, recordings: [Recording], links: [RecordingLink], playFirst: String
) -> TuneSource? {
    let (recordings, links) = liveSources(of: userTune, recordings: recordings, links: links)

    if let pinned = recordings.first(where: { $0.id == userTune.playRecordingID }) { return .recording(pinned) }
    if let pinned = links.first(where: { $0.id == userTune.playLinkID }) { return .link(pinned) }

    let appleMusic = links.first { $0.provider == "apple_music" }
    if playFirst == UserSettings.playFirstAppleMusic, let appleMusic { return .link(appleMusic) }
    if let first = recordings.first { return .recording(first) }
    if let appleMusic { return .link(appleMusic) }
    return links.first.map(TuneSource.link)
}

/// What a list plays for a tune, or why it skips it. Only recordings and Apple Music songs
/// play in a list, and only the recordings in `playable`, the IDs with audio this device can
/// play now. A pin that cannot play here passes over to the next choice.
public func playlistSource(
    userTune: UserTune, recordings: [Recording], playable: Set<String>, links: [RecordingLink],
    playFirst: String, fullTracks: Bool, online: Bool
) -> PlaylistChoice {
    let (live, links) = liveSources(of: userTune, recordings: recordings, links: links)
    let recordings = live.filter { playable.contains($0.id) }
    let songs = links.filter(isAppleMusicSong)
    let playableSongs = fullTracks && online ? songs : []

    if let pinned = recordings.first(where: { $0.id == userTune.playRecordingID }) {
        return .play(.recording(pinned))
    }
    if let pinned = playableSongs.first(where: { $0.id == userTune.playLinkID }) { return .play(.link(pinned)) }

    if playFirst == UserSettings.playFirstAppleMusic, let song = playableSongs.first { return .play(.link(song)) }
    if let first = recordings.first { return .play(.recording(first)) }
    if let song = playableSongs.first { return .play(.link(song)) }

    if songs.isEmpty {
        if !live.isEmpty { return .skip(.recordingsNotHere) }
        return .skip(links.isEmpty ? .nothing : .noCapableLink)
    }
    return .skip(fullTracks ? .needsConnection : .needsSubscription)
}
