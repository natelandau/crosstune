import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

/// Speed and pitch: applied at once, held per recording, and written to the row once they settle.
extension PlayerModel {
    /// Plays the loaded recording at `percent` of normal speed now, and writes it once it settles.
    public func setSpeed(_ percent: Int) {
        change(.speed, to: percent)
    }

    /// Shifts the loaded recording's pitch by `cents` now, and writes it once it settles.
    public func setPitch(_ cents: Int) {
        change(.pitch, to: cents)
    }

    /// Plays `settings` for recording `id` in place of its own until let go with nil. A field
    /// left nil plays the recording's own.
    public func hold(_ id: String, _ settings: PlaybackSettings?) {
        held[id] = settings
        guard holds(.recording, id: id) else { return }
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    /// Writes every speed or pitch change still settling now.
    public func flushSettings() {
        guard let item, item.kind == .recording else { return }
        for setting in PlaybackSetting.allCases where settling[setting] != nil {
            settle(setting, id: item.id)
        }
    }

    /// Writes every change still settling and returns once every write has landed, so the store
    /// can be left with nothing still writing to it.
    public func finishSettings() async {
        flushSettings()
        while let (id, write) = writing.first {
            await write.value
            writing[id] = nil
        }
    }

    func setting(_ setting: PlaybackSetting) -> Int {
        edits[setting] ?? item?.recording.map(setting.value(of:)) ?? setting.standard
    }

    /// Tells the audio player what `setting` should play now, when that has changed.
    func apply(_ setting: PlaybackSetting) {
        guard recordingAudio == .loaded, let id = item?.id else { return }
        let value = setting.value(of: held[id]) ?? self.setting(setting)
        guard applied[setting] != value else { return }
        applied[setting] = value
        switch setting {
        case .speed: audio.setRate(value)
        case .pitch: audio.setPitch(cents: value)
        }
    }

    func change(_ setting: PlaybackSetting, to value: Int) {
        guard let item, item.kind == .recording else { return }
        edits[setting] = value
        failure = nil
        apply(setting)
        settling[setting]?.cancel()
        let id = item.id
        let delay = settleDelay
        settling[setting] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.settle(setting, id: id)
        }
    }

    /// Writes `setting`'s edit for recording `id`, unless the row already holds it.
    func settle(_ setting: PlaybackSetting, id: String) {
        settling.removeValue(forKey: setting)?.cancel()
        guard holds(.recording, id: id), let value = edits[setting] else { return }
        guard value != item?.recording.map(setting.value(of:)) else {
            edits[setting] = nil
            return
        }
        guard let saveSettings else { return }
        let key = UUID()
        writing[key] = Task { [weak self] in
            defer { self?.writing[key] = nil }
            do {
                try await saveSettings(id, setting.change(value))
            } catch CommandError.recordingNotFound {
                // The recording is gone, and the player goes with it.
            } catch {
                guard let self, holds(.recording, id: id) else { return }
                failure = setting.notSaved
                // What plays and shows goes back to what the row holds, unless a newer change
                // has been made since.
                if edits[setting] == value && settling[setting] == nil {
                    edits[setting] = nil
                    apply(setting)
                }
            }
        }
    }

    /// Takes the row's new value for `setting`, unless an edit made here is still settling. An
    /// edit the row now holds, or one already written that a newer value from elsewhere
    /// replaced, gives way to the row. The caller applies it.
    func follow(_ setting: PlaybackSetting, row: Recording) {
        if let edit = edits[setting], settling[setting] == nil || edit == setting.value(of: row) {
            edits[setting] = nil
        }
    }

    func releaseHolds() {
        guard !held.isEmpty else { return }
        held = [:]
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    func cancelSettling() {
        for task in settling.values { task.cancel() }
        settling = [:]
        edits = [:]
    }
}
