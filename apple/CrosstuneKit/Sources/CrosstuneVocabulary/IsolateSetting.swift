/// A recording's isolate choice: which part of the stereo field and frequency range is kept
/// (`solo`) or removed (`mute`).
public struct IsolateSetting: Hashable, Sendable {
    public var effect: Vocabulary.IsolateEffect
    public var panStart: Int
    public var panEnd: Int
    public var lowHz: Int
    public var highHz: Int

    public init(effect: Vocabulary.IsolateEffect, panStart: Int, panEnd: Int, lowHz: Int, highHz: Int) {
        self.effect = effect
        self.panStart = panStart
        self.panEnd = panEnd
        self.lowHz = lowHz
        self.highHz = highHz
    }

    /// Solo over the full pan and frequency ranges, which passes the audio unchanged.
    public static let standard = IsolateSetting(
        effect: .solo,
        panStart: Vocabulary.Ranges.Recording.isolatePanStart.lowerBound,
        panEnd: Vocabulary.Ranges.Recording.isolatePanEnd.upperBound,
        lowHz: Vocabulary.Ranges.Recording.isolateLowHz.lowerBound,
        highHz: Vocabulary.Ranges.Recording.isolateHighHz.upperBound
    )

    public var isDefault: Bool { self == .standard }

    /// The setting as it sounds: mono audio has no stereo picture, so its pan is full. Badges,
    /// Reset, and whether the mask runs read this; the stored pan stays for a stereo copy.
    public func effective(isMono: Bool) -> IsolateSetting {
        guard isMono else { return self }
        var heard = self
        heard.panStart = Self.standard.panStart
        heard.panEnd = Self.standard.panEnd
        return heard
    }
}
