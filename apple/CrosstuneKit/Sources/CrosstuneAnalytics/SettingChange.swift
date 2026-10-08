import CrosstuneVocabulary

/// A setting the musician changed, named as the tracking plan's settings are. Each one is also
/// a person property, so a person's current choice is always at hand.
public enum SettingChange: Sendable, Equatable {
    case instruments([String])
    case audioQuality(AudioQuality)
    case searchProviders([LinkService])
    case playFirst(PlayFirst)
    case appearance(AppearanceChoice)
    case textSize(Int)
    case captureChannels(ChannelChoice)
    case downloadAll(Bool)

    public var name: String {
        switch self {
        case .instruments: "instruments"
        case .audioQuality: "audio_quality"
        case .searchProviders: "search_providers"
        case .playFirst: "play_first"
        case .appearance: "appearance"
        case .textSize: "text_size"
        case .captureChannels: "capture_channels"
        case .downloadAll: "download_all"
        }
    }

    public var value: AnalyticsValue {
        switch self {
        // Synced from the server, which can know an instrument before the plan does.
        case .instruments(let instruments): .strings(instruments.filter(Vocabulary.instruments.contains))
        case .searchProviders(let services): .strings(services.map(\.rawValue))
        case .audioQuality(let quality): .string(quality.rawValue)
        case .playFirst(let choice): .string(choice.rawValue)
        case .appearance(let choice): .string(choice.rawValue)
        case .captureChannels(let choice): .string(choice.rawValue)
        case .textSize(let size): .int(size)
        case .downloadAll(let on): .bool(on)
        }
    }

    /// The person property that holds this setting.
    var personProperty: String { "setting_\(name)" }
}

/// The app's appearance, as the setting reports it.
public enum AppearanceChoice: String, CaseIterable, Sendable {
    case system
    case light
    case dark
}

/// The channels a take records, as the setting reports it.
public enum ChannelChoice: String, CaseIterable, Sendable {
    case mono
    case stereo
}

/// One of the vocabulary's audio qualities. The app keeps a quality as a string, so this checks
/// it against the vocabulary rather than keeping a second list of qualities.
public struct AudioQuality: Sendable, Equatable {
    public let rawValue: String

    public init?(_ rawValue: String) {
        guard Vocabulary.audioQualities.contains(rawValue) else { return nil }
        self.rawValue = rawValue
    }
}

/// One of the vocabulary's play-first choices, checked as ``AudioQuality`` is.
public struct PlayFirst: Sendable, Equatable {
    public let rawValue: String

    public init?(_ rawValue: String) {
        guard Vocabulary.playFirsts.contains(rawValue) else { return nil }
        self.rawValue = rawValue
    }
}
