import CrosstuneStore

/// A recording's speed and pitch, where nil leaves that one as it is.
public struct PlaybackSettings: Equatable, Sendable {
    public var speedPercent: Int?
    public var pitchCents: Int?

    public init(speedPercent: Int? = nil, pitchCents: Int? = nil) {
        self.speedPercent = speedPercent
        self.pitchCents = pitchCents
    }
}

/// The settings the recording screen changes while the recording plays.
enum PlaybackSetting: CaseIterable, Sendable {
    case speed
    case pitch

    var standard: Int {
        switch self {
        case .speed: 100
        case .pitch: 0
        }
    }

    func value(of recording: Recording) -> Int {
        switch self {
        case .speed: recording.speedPercent
        case .pitch: recording.pitchCents
        }
    }

    func value(of settings: PlaybackSettings?) -> Int? {
        switch self {
        case .speed: settings?.speedPercent
        case .pitch: settings?.pitchCents
        }
    }

    func change(_ value: Int) -> PlaybackSettings {
        switch self {
        case .speed: PlaybackSettings(speedPercent: value)
        case .pitch: PlaybackSettings(pitchCents: value)
        }
    }

    var notSaved: String {
        switch self {
        case .speed: RecordingScreenText.speedNotSaved
        case .pitch: RecordingScreenText.pitchNotSaved
        }
    }
}
