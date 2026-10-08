import CrosstuneAnalytics
import CrosstuneAudio
import Foundation

/// The settings this device keeps in its own defaults, as the person property values they stand
/// for. A setting never chosen reads as its default.
public enum DeviceSettings {
    public static func current(defaults: UserDefaults = .standard) -> [SettingChange] {
        let appearance = defaults.string(forKey: Appearance.storageKey).flatMap(Appearance.init(rawValue:)) ?? .system
        let channels =
            defaults.string(forKey: CaptureChannels.storageKey).flatMap(CaptureChannels.init(rawValue:)) ?? .mono
        return [
            .appearance(AppearanceChoice(appearance)), .textSize(defaults.integer(forKey: TextSize.storageKey)),
            .captureChannels(ChannelChoice(channels)),
        ]
    }
}

extension AppearanceChoice {
    init(_ appearance: Appearance) {
        self =
            switch appearance {
            case .system: .system
            case .light: .light
            case .dark: .dark
            }
    }
}

extension ChannelChoice {
    init(_ channels: CaptureChannels) {
        self =
            switch channels {
            case .mono: .mono
            case .stereo: .stereo
            }
    }
}
