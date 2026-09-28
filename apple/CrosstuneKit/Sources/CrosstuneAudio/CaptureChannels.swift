import Foundation

/// Mono or stereo capture. Chosen per device because stereo depends on the hardware, so it
/// lives in `UserDefaults` rather than the synced settings row.
public enum CaptureChannels: String, CaseIterable, Identifiable, Sendable {
    case mono
    case stereo

    /// The `UserDefaults` key the choice is stored under.
    public static let storageKey = "crosstune.captureChannels"

    public var id: Self { self }

    /// The number of channels this choice records.
    public var count: Int {
        switch self {
        case .mono: 1
        case .stereo: 2
        }
    }

    /// The stored choice, or mono when nothing valid is stored.
    public static func stored(in defaults: UserDefaults = .standard) -> CaptureChannels {
        defaults.string(forKey: storageKey).flatMap(CaptureChannels.init(rawValue:)) ?? .mono
    }

    /// The channel count to record: two only when stereo is chosen and the input has them.
    public static func resolve(_ preferred: CaptureChannels, inputChannels: Int) -> Int {
        preferred == .stereo && inputChannels >= 2 ? 2 : 1
    }

    /// The encoder rate for a channel count, scaled from the per-channel rate.
    public static func bitrate(mono: Int, channels: Int) -> Int {
        mono * min(max(channels, 1), 2)
    }
}
