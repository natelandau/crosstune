import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// Play, skip, speed, pitch, and isolate: the player's while it holds the recording, and the
/// model's own, written to the row, while it holds another.
extension PracticeModel {
    var speedPercent: Int { isCurrent ? player.speedPercent : ownValue(.speed) }
    var pitchCents: Int { isCurrent ? player.pitchCents : ownValue(.pitch) }
    var isolate: IsolateSetting { isCurrent ? player.isolate : ownValue(.isolate) }
    /// Whether the recording's audio is mono, nil while unknown.
    var isMono: Bool? { isCurrent ? player.isMono : recording.isMono }
    /// The isolate setting as it sounds, which an unknown mono flag reads as stereo.
    var effectiveIsolate: IsolateSetting { isolate.effective(isMono: isMono == true) }

    func setSpeed(_ percent: Int) {
        if isCurrent { player.setSpeed(percent) } else { changeOwn(.speed, to: percent) }
    }

    func setPitch(_ cents: Int) {
        if isCurrent { player.setPitch(cents) } else { changeOwn(.pitch, to: cents) }
    }

    func setIsolate(_ setting: IsolateSetting) {
        if isCurrent { player.setIsolate(setting) } else { changeOwn(.isolate, to: setting) }
    }

    /// The settings the recording plays with: the player's while it holds the recording, or the
    /// ones it let the recording go with, else the row's with the changes made here.
    var playedSettings: PlayedSettings? {
        if isCurrent || ownEdits == PlaybackSettings(), let played = player.playedSettings(of: recording.id) {
            return played
        }
        return PlayedSettings(speedPercent: speedPercent, pitchCents: pitchCents, isolate: isolate)
    }

    /// Play and pause. A recording the player does not hold loads at the playhead with the loop
    /// selected here, and plays at the speed, pitch, and isolate set here.
    func togglePlay() {
        guard !isCurrent else {
            player.audio.toggle()
            return
        }
        var row = recording
        if let speed = ownEdits.speedPercent { row.speedPercent = speed }
        if let pitch = ownEdits.pitchCents { row.pitchCents = pitch }
        if let isolate = ownEdits.isolate { row.isolate = isolate }
        flushOwnSettings()
        let selection = ownSelectedID
        let position = TimeInterval(ownPositionMs) / 1000
        guard
            player.play(
                .recording(row, tuneTitle: tuneTitle), at: position, origin: .dock, source: .recordingScreen,
                page: page)
        else { return }
        ownEdits = PlaybackSettings()
        if let selection { player.loops.select(selection) }
    }

    /// Moves the playhead by `seconds`, as the transport's skip buttons do.
    func skip(by seconds: TimeInterval) {
        if isCurrent {
            player.audio.skip(by: seconds)
        } else {
            seek(byMs: Int64((seconds * 1000).rounded()))
        }
    }

    /// Moves the playhead the model keeps while the player holds another recording.
    func moveOwnPlayhead(toMs ms: Int64) {
        ownPositionMs = min(max(ms, 0), lengthMs)
    }

    /// Writes every speed, pitch, or isolate change made here and still settling now.
    func flushOwnSettings() {
        for setting in PlaybackSetting.allCases where ownSettling[setting] != nil {
            switch setting {
            case .speed: settleOwn(PlaybackField.speed)
            case .pitch: settleOwn(PlaybackField.pitch)
            case .isolate: settleOwn(PlaybackField.isolate)
            }
        }
    }

    /// Lets go of each change made here that the row now holds.
    func followOwnEdits(_ row: Recording) {
        if ownEdits.speedPercent == row.speedPercent { ownEdits.speedPercent = nil }
        if ownEdits.pitchCents == row.pitchCents { ownEdits.pitchCents = nil }
        if ownEdits.isolate == row.isolate { ownEdits.isolate = nil }
    }

    private func ownValue<Value>(_ field: PlaybackField<Value>) -> Value {
        ownEdits[keyPath: field.field] ?? recording[keyPath: field.row]
    }

    private func changeOwn<Value>(_ field: PlaybackField<Value>, to value: Value) {
        ownEdits[keyPath: field.field] = value
        failure = nil
        ownSettling[field.setting]?.cancel()
        let delay = player.settleDelay
        let sleep = player.sleep
        ownSettling[field.setting] = Task { [weak self] in
            try? await sleep(delay)
            guard !Task.isCancelled else { return }
            self?.settleOwn(field)
        }
    }

    /// Writes `field`'s change made here, unless the row already holds it. A refused write shows
    /// why and goes back to the row, unless a newer change has been made since.
    private func settleOwn<Value>(_ field: PlaybackField<Value>) {
        ownSettling.removeValue(forKey: field.setting)?.cancel()
        guard let value = ownEdits[keyPath: field.field] else { return }
        guard value != recording[keyPath: field.row] else {
            ownEdits[keyPath: field.field] = nil
            return
        }
        guard let save = player.saveSettings else { return }
        let id = recording.id
        run { [self] in
            do {
                try await save(id, field.change(value))
            } catch CommandError.recordingNotFound {
                // The recording is gone, and its page with it.
            } catch {
                failure = field.notSaved
                if ownEdits[keyPath: field.field] == value && ownSettling[field.setting] == nil {
                    ownEdits[keyPath: field.field] = nil
                }
            }
        }
    }
}
