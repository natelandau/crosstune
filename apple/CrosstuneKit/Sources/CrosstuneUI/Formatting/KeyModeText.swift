import CrosstuneVocabulary
import Foundation

/// A tune's key with its first mode, as a row shows it and as a screen reader should hear it.
public struct KeyModeText: Hashable, Sendable {
    /// The key as stored, trimmed.
    public let key: String
    /// What follows the key on a row: `m`, ` dor`, ` mix`, ` modal`, or nothing for major.
    public let suffix: String
    /// The full name, "E dorian". A mode this build cannot name, or `other`, leaves the key alone.
    public let spoken: String

    /// Nil for a tune with no key, which shows no mode either.
    public init?(key: String?, modes: [String]) {
        guard let key = key?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else { return nil }
        self.key = key
        guard let mode = modes.first, mode != "other", let suffix = Vocabulary.modeAbbreviations[mode] else {
            suffix = ""
            spoken = key
            return
        }
        self.suffix = suffix
        spoken = "\(key) \(mode)"
    }

    /// The key and its abbreviated mode together: `Dm`, `E dor`, `G`.
    public var shown: String { key + suffix }
}
