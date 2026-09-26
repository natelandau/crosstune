import CrosstuneStore

/// What a tune row says: its title, then its key and mode, status, tunings for the instruments
/// played, and whether it is archived, each left out when unset.
public struct TuneRowText: Hashable, Sendable {
    public static let archived = "Archived"
    /// Spoken before the key, so "D" is not heard as a stray letter.
    public static let keyPrefix = "Key"

    public let title: String
    public let key: KeyModeText?
    /// The status as the row shows it, a known vocabulary value.
    public let status: String
    public let tunings: String?
    public let isArchived: Bool

    public init(tune: Tune, userTune: UserTune, instruments: Set<String>) {
        title = tune.title
        key = KeyModeText(key: tune.key, modes: tune.modes)
        status = StatusStyle.normalized(userTune.status)
        tunings = TuningText.row(tune.tunings, instruments: instruments)
        isArchived = userTune.archivedAt != nil
    }

    /// The second line's parts as a screen reader hears them.
    public var spokenDetails: [String] {
        var parts: [String] = []
        if let key { parts.append("\(Self.keyPrefix) \(key.spoken)") }
        parts.append(StatusStyle.label(status))
        if let tunings { parts.append(tunings) }
        if isArchived { parts.append(Self.archived) }
        return parts
    }

    /// The whole row as one spoken name, a comma between parts. `position` leads for a row in
    /// a list.
    public func accessibilityLabel(position: Int? = nil) -> String {
        let lead = position.map { ["\($0)"] } ?? []
        return (lead + [title] + spokenDetails).joined(separator: ", ")
    }
}
