import CrosstuneDesign
import CrosstuneStore

/// What a tune row says: its title, then its key and mode, status, tunings for the instruments
/// played, whether it is archived, and a note from the screen showing it, each left out when unset.
public struct TuneRowText: Hashable, Sendable {
    public static let archived = "Archived"
    /// Spoken before the key, so "D" is not heard as a stray letter.
    public static let keyPrefix = "Key"

    public let title: String
    public let key: KeyModeText?
    /// The status as the row shows it, a known vocabulary value.
    public let status: String
    public let tunings: String?
    /// ``tunings`` one instrument at a time.
    public let tuningParts: [String]
    public let isArchived: Bool
    /// Said last, shown and spoken, such as a list's word for a tune with nothing to play.
    public let note: String?

    public init(tune: Tune, userTune: UserTune, instruments: Set<String>, note: String? = nil) {
        title = tune.title
        key = KeyModeText(key: tune.key, modes: tune.modes)
        status = StatusStyle.normalized(userTune.status)
        tuningParts = TuningText.rowParts(tune.tunings, instruments: instruments)
        tunings = TuningText.row(tune.tunings, instruments: instruments)
        isArchived = userTune.archivedAt != nil
        self.note = note
    }

    /// The line under the title on iPhone and iPad, or nil when there is nothing beyond the
    /// glyph, title, and key to say: the tunings and capos, whether it is archived, then the note.
    public var secondLine: String? {
        let parts = [tunings, isArchived ? Self.archived : nil, note].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The second line's parts as a screen reader hears them.
    public var spokenDetails: [String] {
        var parts: [String] = []
        if let key { parts.append("\(Self.keyPrefix) \(key.spoken)") }
        parts.append(StatusStyle.label(status))
        if let tunings { parts.append(tunings) }
        if isArchived { parts.append(Self.archived) }
        if let note { parts.append(note) }
        return parts
    }

    /// The whole row as one spoken name, a comma between parts. `position` leads for a row in
    /// a list.
    public func accessibilityLabel(position: Int? = nil) -> String {
        let lead = position.map { ["\($0)"] } ?? []
        return (lead + [title] + spokenDetails).joined(separator: ", ")
    }
}
