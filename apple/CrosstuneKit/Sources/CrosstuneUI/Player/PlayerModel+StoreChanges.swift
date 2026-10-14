import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

/// Following the stored rows of the loaded item as they change.
extension PlayerModel {
    /// Follows the stored row of the loaded link `id`: a new title or player replaces the
    /// loaded one, and a row that is gone, deleted, or no longer playable closes the player, or
    /// moves a queue on to its next track. Does nothing when another item is loaded.
    public func linkChanged(id: String, to row: RecordingLink?) {
        guard holds(.link, id: id) else { return }
        guard let row, let next = PlayerItem.link(row) else {
            dropGoneItem()
            return
        }
        guard next.link?.appleMusic == item?.link?.appleMusic else {
            if let nowPlaying = queuedNowPlaying {
                // A queued link plays only as a guarded song, and the queue moves on when it cannot.
                // A paused song stays paused, as with a single link.
                if case .song? = next.link?.appleMusic {
                    let autoplay = linkAudio == .deciding || music?.isPlaying == true
                    // The same link at a new address is still the play under way.
                    _ = loadQueued(
                        next, nowPlaying: nowPlaying, autoplay: autoplay, origin: activity.plays.origin ?? .dock,
                        trigger: activity.plays.attribution?.trigger ?? .autoAdvance, keepsPlay: true)
                } else {
                    queuedItemCannotPlay()
                }
                return
            }
            // A new address can mean another track, or one MusicKit cannot play. The player
            // stays as the musician left it: shown or not, and playing or not. A sync never
            // starts MusicKit or its access prompt; only a play tap still being decided does.
            let wasExpanded = isExpanded
            let wasDeciding = linkAudio == .deciding
            let wasPlaying = music?.isPlaying == true
            stopAudio()
            item = next
            startLink(
                next, autoplay: wasDeciding || wasPlaying, asksAccess: wasDeciding, expandsOnFallBack: wasExpanded)
            isExpanded = wasExpanded
            return
        }
        if next != item { item = next }
    }

    /// Follows the stored row of the loaded recording `id`, its audio file on this device, and
    /// the title of its tune: a new name shows in place, and a row that is gone or deleted
    /// closes the player, or moves a queue on to its next track. The audio already playing
    /// carries on, taking a new trim, speed, or pitch in place, and a new file of the audio
    /// reloads at the same position. Does nothing when another item is loaded.
    public func recordingChanged(
        id: String, to row: Recording?, audioFile: RecordingAudioFile?, tuneTitle: String?,
        locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        guard holds(.recording, id: id) else { return }
        guard let row, row.deletedAt == nil else {
            dropGoneItem()
            return
        }
        let previous = item
        let next = PlayerItem.recording(row, tuneTitle: tuneTitle, locale: locale, timeZone: timeZone)
        if next != previous { item = next }
        let before = previous?.recording
        let changed = PlaybackSetting.allCases.filter { before.map($0.value(of:)) != $0.value(of: row) }
        for setting in changed { follow(setting, row: row) }
        guard recordingAudio == .loaded else { return }
        if next.title != previous?.title || next.tuneTitle != previous?.tuneTitle {
            audio.retitle(nowPlaying(for: next))
        }
        // Each revision of the audio is a new file, so a new URL is the only change that reloads.
        if let audioFile, audioFile.url != loadedFile?.audio.url {
            let position = audio.elapsed
            let wasPlaying = audio.isPlaying
            start(audioFile, next, keepLoop: true)
            audio.seek(to: position)
            if wasPlaying { audio.play() }
            return
        }
        if before.map(Self.trim) != Self.trim(row), let window = window(row) {
            audio.setWindow(window)
            loops.trimMoved(to: row.trimStartMs)
        }
        for setting in changed { apply(setting) }
    }

    /// Follows the loops of the loaded recording `id`. Does nothing when another item is loaded.
    public func loopsChanged(id: String, to rows: [RecordingLoop]) {
        guard holds(.recording, id: id) else { return }
        loops.follow(rows)
    }

    static func trim(_ row: Recording) -> [Int64?] {
        [row.trimStartMs, row.trimEndMs, row.sourceDurationMs]
    }
}
