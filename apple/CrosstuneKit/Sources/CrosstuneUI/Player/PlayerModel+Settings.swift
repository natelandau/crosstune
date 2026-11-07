import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Observation

/// What the isolate unit was last told: the setting and whether the audio is mono.
struct AppliedIsolate: Equatable {
    let setting: IsolateSetting
    let isMono: Bool
}

/// A recording's speed, pitch, and isolate setting as the player plays it.
struct PlayedSettings: Equatable {
    let speedPercent: Int
    let pitchCents: Int
    let isolate: IsolateSetting
}

/// Speed, pitch, and isolate: applied at once, held per recording, and written to the row once
/// they settle.
extension PlayerModel {
    /// Plays the loaded recording at `percent` of normal speed now, and writes it once it settles.
    public func setSpeed(_ percent: Int) {
        change(.speed, to: percent)
    }

    /// Shifts the loaded recording's pitch by `cents` now, and writes it once it settles.
    public func setPitch(_ cents: Int) {
        change(.pitch, to: cents)
    }

    /// Plays the loaded recording with `setting` now, and writes it once it settles.
    public func setIsolate(_ setting: IsolateSetting) {
        change(.isolate, to: setting)
    }

    /// Plays `settings` for recording `id` in place of its own until let go with nil. A field
    /// left nil plays the recording's own.
    public func hold(_ id: String, _ settings: PlaybackSettings?) {
        held[id] = settings
        guard holds(.recording, id: id) else { return }
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    /// Recording `id`'s settings: as they play while it is loaded, else as they were when the
    /// player last let it go, else nil. While its audio loads again, the row may not yet hold a
    /// change that played, so the settings it was let go with stand until the audio is back.
    func playedSettings(of id: String) -> PlayedSettings? {
        let left = settingsLeft?.id == id ? settingsLeft?.settings : nil
        if holds(.recording, id: id), recordingAudio == .loaded || left == nil {
            return PlayedSettings(speedPercent: speedPercent, pitchCents: pitchCents, isolate: isolate)
        }
        return left
    }

    /// Wants the isolate outline while any requester holds it, so one screen letting go never
    /// drops it under another that still shows the Isolate panel, whatever order they go in.
    func requestIsolateOutline(_ on: Bool, by requester: UUID) {
        let wasWanted = !outlineRequesters.isEmpty
        if on { outlineRequesters.insert(requester) } else { outlineRequesters.remove(requester) }
        if wasWanted != !outlineRequesters.isEmpty { audio.setIsolateOutlineWanted(!outlineRequesters.isEmpty) }
    }

    /// Writes every speed, pitch, or isolate change still settling now.
    public func flushSettings() {
        guard let item, item.kind == .recording else { return }
        for setting in PlaybackSetting.allCases where settling[setting] != nil {
            switch setting {
            case .speed: settle(PlaybackField.speed, id: item.id)
            case .pitch: settle(PlaybackField.pitch, id: item.id)
            case .isolate: settle(PlaybackField.isolate, id: item.id)
            }
        }
    }

    /// Writes every change still settling and returns once every write has landed, so the store
    /// can be left with nothing still writing to it.
    public func finishSettings() async {
        flushSettings()
        cancelMeasuring()
        while let (id, write) = writing.first {
            await write.value
            writing[id] = nil
        }
    }

    /// `field`'s value for the loaded recording, with a change made here ahead of its row.
    func value<Value>(_ field: PlaybackField<Value>) -> Value {
        edits[keyPath: field.field] ?? item?.recording?[keyPath: field.row] ?? field.standard
    }

    /// Tells the audio player what `setting` should play now, when that has changed.
    func apply(_ setting: PlaybackSetting) {
        switch setting {
        case .speed: apply(.speed) { audio.setRate($0) }
        case .pitch: apply(.pitch) { audio.setPitch(cents: $0) }
        case .isolate: applyIsolate()
        }
    }

    private func apply(_ field: PlaybackField<Int>, by send: (Int) -> Void) {
        guard recordingAudio == .loaded, let id = item?.id else { return }
        let value = held[id]?[keyPath: field.field] ?? self.value(field)
        guard applied[field.setting] != value else { return }
        applied[field.setting] = value
        send(value)
    }

    /// Tells the audio player what isolate setting and mono flag should play now, when either
    /// has changed. Audio not known to be mono plays as stereo.
    func applyIsolate() {
        guard recordingAudio == .loaded, let id = item?.id else { return }
        let target = AppliedIsolate(setting: held[id]?.isolate ?? isolate, isMono: isMono ?? false)
        guard appliedIsolate != target else { return }
        appliedIsolate = target
        audio.setIsolate(target.setting, isMono: target.isMono)
    }

    func change<Value>(_ field: PlaybackField<Value>, to value: Value) {
        guard let item, item.kind == .recording else { return }
        edits[keyPath: field.field] = value
        failure = nil
        apply(field.setting)
        settling[field.setting]?.cancel()
        let id = item.id
        let delay = settleDelay
        let sleep = sleep
        settling[field.setting] = Task { [weak self] in
            try? await sleep(delay)
            guard !Task.isCancelled else { return }
            self?.settle(field, id: id)
        }
    }

    /// Writes `field`'s edit for recording `id`, unless the row already holds it.
    func settle<Value>(_ field: PlaybackField<Value>, id: String) {
        settling.removeValue(forKey: field.setting)?.cancel()
        guard holds(.recording, id: id), let value = edits[keyPath: field.field] else { return }
        guard value != item?.recording?[keyPath: field.row] else {
            edits[keyPath: field.field] = nil
            return
        }
        guard let saveSettings else { return }
        let change = field.change(value)
        let key = UUID()
        writing[key] = Task { [weak self] in
            defer { self?.writing[key] = nil }
            do {
                try await saveSettings(id, change)
            } catch CommandError.recordingNotFound {
                // The recording is gone, and the player goes with it.
            } catch {
                guard let self, holds(.recording, id: id) else { return }
                failure = field.notSaved
                // What plays and shows goes back to what the row holds, unless a newer change
                // has been made since.
                if edits[keyPath: field.field] == value && settling[field.setting] == nil {
                    edits[keyPath: field.field] = nil
                    apply(field.setting)
                }
            }
        }
    }

    /// Takes the row's new value for `field` when it changed from `before`, unless an edit made
    /// here is still settling. An edit the row now holds, or one already written that a newer
    /// value from elsewhere replaced, gives way to the row. The caller applies it.
    func follow<Value>(_ field: PlaybackField<Value>, from before: Recording?, to row: Recording) {
        guard before?[keyPath: field.row] != row[keyPath: field.row] else { return }
        if let edit = edits[keyPath: field.field], settling[field.setting] == nil || edit == row[keyPath: field.row] {
            edits[keyPath: field.field] = nil
        }
    }

    func cancelSettling() {
        for task in settling.values { task.cancel() }
        settling = [:]
        edits = PlaybackSettings()
        cancelMeasuring()
    }

    /// Stops every mono measurement under way, so none saves after the store is let go.
    func cancelMeasuring() {
        for task in measuring.values { task.cancel() }
        measuring = [:]
    }

    /// Measures whether `row`'s audio at `url` is mono when neither its row nor an earlier
    /// measurement says, and saves the answer. A failed measurement leaves it unknown.
    func measureMonoIfUnknown(_ row: Recording, url: URL) {
        guard row.isMono == nil, measuredMono == nil, url.isFileURL, measuring[row.id] == nil else { return }
        let id = row.id
        measuring[id] = Task { [weak self, audio] in
            let isMono = try? await audio.measureMono(url: url)
            guard let self, !Task.isCancelled else { return }
            measuring[id] = nil
            if let isMono { monoMeasured(id, isMono) }
        }
    }

    /// Plays recording `id` with its measured mono flag while it is still loaded, and saves the
    /// flag even when it is not.
    private func monoMeasured(_ id: String, _ isMono: Bool) {
        if holds(.recording, id: id), item?.recording?.isMono == nil {
            measuredMono = isMono
            applyIsolate()
        }
        guard let saveMono else { return }
        let key = UUID()
        writing[key] = Task { [weak self] in
            defer { self?.writing[key] = nil }
            // A flag that fails to save is measured again the next time the recording loads.
            try? await saveMono(id, isMono)
        }
    }
}
