import CrosstuneStore
import CrosstuneVocabulary

/// A recording's speed, pitch, and isolate setting, where nil leaves that one as it is.
public struct PlaybackSettings: Equatable, Sendable {
    public var speedPercent: Int?
    public var pitchCents: Int?
    public var isolate: IsolateSetting?

    /// Normal speed and pitch with nothing isolated, which the trim and split screens hold so
    /// what is heard is what is cut.
    public static let normal = PlaybackSettings(speedPercent: 100, pitchCents: 0, isolate: .standard)

    public init(speedPercent: Int? = nil, pitchCents: Int? = nil, isolate: IsolateSetting? = nil) {
        self.speedPercent = speedPercent
        self.pitchCents = pitchCents
        self.isolate = isolate
    }
}

/// The settings the recording screen changes while the recording plays, each edited, settled,
/// and followed the same way in ``PlayerModel``.
enum PlaybackSetting: CaseIterable, Sendable {
    case speed
    case pitch
    case isolate
}

/// One playback setting with its value type: where it sits in a row and in
/// ``PlaybackSettings``, its default, and what shows when a change to it is not saved.
struct PlaybackField<Value: Equatable & Sendable>: Sendable {
    let setting: PlaybackSetting
    let field: WritableKeyPath<PlaybackSettings, Value?> & Sendable
    let row: KeyPath<Recording, Value> & Sendable
    let standard: Value
    let notSaved: String

    /// Settings that change only this one, to `value`.
    func change(_ value: Value) -> PlaybackSettings {
        var settings = PlaybackSettings()
        settings[keyPath: field] = value
        return settings
    }
}

extension PlaybackField where Value == Int {
    static var speed: Self {
        Self(
            setting: .speed, field: \.speedPercent, row: \.speedPercent, standard: 100,
            notSaved: RecordingScreenText.speedNotSaved)
    }

    static var pitch: Self {
        Self(
            setting: .pitch, field: \.pitchCents, row: \.pitchCents, standard: 0,
            notSaved: RecordingScreenText.pitchNotSaved)
    }
}

extension PlaybackField where Value == IsolateSetting {
    static var isolate: Self {
        Self(
            setting: .isolate, field: \.isolate, row: \.isolate, standard: .standard,
            notSaved: RecordingScreenText.isolateNotSaved)
    }
}
