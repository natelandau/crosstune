import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import os

extension ListPlayback {
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "list-playback")

    /// Resolves a tune of a list from `store` the way the list plays it: its pin, else the
    /// play-first choice, within what this device can play now. Nil for a tune that is gone, no
    /// longer in the list, or has nothing to play.
    public static func resolver(
        store: CrosstuneStore, access: any AppleMusicAccess, online: @escaping @MainActor () -> Bool,
        playFirst: @escaping @MainActor () -> String
    ) -> @MainActor (_ listID: String, _ tuneID: String) async -> Turn? {
        { listID, tuneID in
            let entry: ListEntry?
            do {
                entry = try await store.read { db in
                    try ListContents.fetch(db, listID: listID)?.entries.first { $0.tune.id == tuneID }
                }
            } catch {
                logger.error("A playing list's tune could not be read: \(error, privacy: .public)")
                return nil
            }
            guard let entry else { return nil }
            let isOnline = online()
            // The subscription lookup needs the network, and only a song needs it.
            let wantsSong = isOnline && entry.links.contains { $0.provider == "apple_music" }
            let fullTracks = wantsSong ? await access.current() == .fullTracks : false
            let sources = entry.playlistEntry(online: isOnline)
            let choice = playlistSource(
                userTune: sources.userTune, recordings: sources.recordings, playable: sources.playable,
                links: sources.links, playFirst: playFirst(), fullTracks: fullTracks, online: isOnline)
            let title = entry.tune.title
            switch choice {
            case .play(.recording(let recording)):
                return Turn(title: title, item: .recording(recording, tuneTitle: title))
            case .play(.link(let link)): return PlayerItem.link(link).map { Turn(title: title, item: $0) }
            case .skip: return nil
            }
        }
    }
}

extension ListEntry {
    /// The entry as a playlist reads it, with the recordings this device can play now.
    func playlistEntry(online: Bool) -> PlaylistEntry {
        PlaylistEntry(
            userTune: userTune, recordings: recordings,
            playable: Set(RecordingText.playlistCapable(recordings, files: files, online: online).map(\.id)),
            links: links)
    }
}
