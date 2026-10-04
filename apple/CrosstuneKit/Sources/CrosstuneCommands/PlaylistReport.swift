import CrosstuneStore

/// Which tunes of a list play as a playlist and why the rest do not.
public struct PlaylistReport: Equatable, Sendable {
    /// Tune IDs in list order.
    public var playable: [String]
    /// Tune IDs per reason, in list order.
    public var skipped: [PlaylistSkip: [String]]
    public var total: Int

    public init(playable: [String], skipped: [PlaylistSkip: [String]], total: Int) {
        self.playable = playable
        self.skipped = skipped
        self.total = total
    }
}

/// One tune of a list with the sources a playlist chooses from.
public struct PlaylistEntry: Sendable {
    public var userTune: UserTune
    public var recordings: [Recording]
    /// The IDs of the recordings with audio this device can play now.
    public var playable: Set<String>
    public var links: [RecordingLink]

    public init(userTune: UserTune, recordings: [Recording], playable: Set<String>, links: [RecordingLink]) {
        self.userTune = userTune
        self.recordings = recordings
        self.playable = playable
        self.links = links
    }
}

/// Sorts a list's tunes into those a playlist plays and those it skips, by reason.
public func playlistReport(
    entries: [PlaylistEntry], playFirst: String, fullTracks: Bool, online: Bool
) -> PlaylistReport {
    var report = PlaylistReport(playable: [], skipped: [:], total: entries.count)
    for entry in entries {
        let choice = playlistSource(
            userTune: entry.userTune, recordings: entry.recordings, playable: entry.playable, links: entry.links,
            playFirst: playFirst, fullTracks: fullTracks, online: online)
        switch choice {
        case .play: report.playable.append(entry.userTune.tuneID)
        case .skip(let reason): report.skipped[reason, default: []].append(entry.userTune.tuneID)
        }
    }
    return report
}
