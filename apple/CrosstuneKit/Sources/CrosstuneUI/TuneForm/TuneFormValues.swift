import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// One instrument's tuning and capo as the tune form holds them.
public struct TuningValues: Hashable, Sendable {
    /// Empty when unset.
    public var tuning: String
    public var capo: Int64?

    public init(tuning: String = "", capo: Int64? = nil) {
        self.tuning = tuning
        self.capo = capo
    }
}

/// Everything the tune form edits, as its controls hold it: text empty when unset, one mode row
/// per part with an empty row for a part with no mode yet.
public struct TuneFormValues: Hashable, Sendable {
    public var title = ""
    /// The other names, comma separated.
    public var alternateTitles = ""
    public var key = ""
    public var modes: [String] = []
    public var composer = ""
    /// Per instrument; an instrument missing here is unset.
    public var tunings: [String: TuningValues] = [:]
    public var genre = ""
    public var tuneType = ""
    public var partStructure = ""
    /// A new tune starts in 4/4; empty is not set.
    public var timeSignature = "4/4"
    public var isCrooked = false
    public var lyrics = ""
    public var status = "want_to_learn"
    public var learnedFrom = ""
    /// A calendar date, `YYYY-MM-DD`, or empty.
    public var learnedOn = ""
    public var notes = ""

    /// A new tune: want to learn, in 4/4, and nothing else set.
    public init() {}

    /// The form's values for a stored tune and the musician's own row for it. A mode, time
    /// signature, or status this build does not know reads as unset rather than as one of the
    /// form's own choices.
    public init(tune: Tune, userTune: UserTune) {
        title = tune.title
        alternateTitles = tune.alternateTitles.joined(separator: ", ")
        key = tune.key ?? ""
        modes = tune.modes.filter(Vocabulary.modes.contains)
        composer = tune.composer ?? ""
        tunings = Dictionary(
            uniqueKeysWithValues: Vocabulary.instruments.map { instrument in
                let entry = tuningEntry(tune.tunings, instrument: instrument)
                return (instrument, TuningValues(tuning: entry.tuning ?? "", capo: entry.capo))
            })
        genre = tune.genre ?? ""
        tuneType = tune.tuneType ?? ""
        partStructure = tune.partStructure ?? ""
        timeSignature = Self.timeSignature(tune.timeSignature)
        isCrooked = tune.isCrooked
        lyrics = tune.lyrics ?? ""
        status = StatusStyle.normalized(userTune.status)
        learnedFrom = userTune.learnedFrom ?? ""
        learnedOn = userTune.learnedOn ?? ""
        notes = userTune.notes ?? ""
    }

    /// A time signature the form offers, or empty for one it does not.
    public static func timeSignature(_ value: String?) -> String {
        value.flatMap { Vocabulary.timeSignatures.contains($0) ? $0 : nil } ?? ""
    }

    /// The form's mode rows: one per part, and one empty row for a tune with no mode.
    public var modeRows: [String] { modes.isEmpty ? [""] : modes }

    /// Sets one part's mode, or empties it for a value this build does not know.
    public mutating func setMode(_ mode: String, part index: Int) {
        var rows = modeRows
        guard rows.indices.contains(index) else { return }
        rows[index] = Vocabulary.modes.contains(mode) ? mode : ""
        modes = rows
    }

    /// Adds an empty row for the next part.
    public mutating func addModeRow() {
        modes = modeRows + [""]
    }

    /// Takes one part's row away, leaving at least the first.
    public mutating func removeModeRow(at index: Int) {
        var rows = modeRows
        guard rows.indices.contains(index) else { return }
        rows.remove(at: index)
        modes = rows
    }

    /// Whether another part's mode row can be added: the parts the API allows are not all used,
    /// and the last row holds a mode.
    public var canAddModeRow: Bool {
        let rows = modeRows
        return rows.count < Vocabulary.Limits.Tune.modes && rows.last != ""
    }

    /// Sets the type. The type's own time signature replaces one the player has not chosen: an
    /// empty one, or a new tune's untouched default. A time signature the player chose stays.
    public mutating func setType(_ type: String, isNew: Bool, timeSignatureTouched: Bool) {
        tuneType = type
        let replaceable = timeSignature.isEmpty || (isNew && !timeSignatureTouched)
        if replaceable, let fill = TuneSuggestions.timeSignature(for: type) { timeSignature = fill }
    }

    /// The instrument's tuning and capo, empty when unset.
    public func tuning(_ instrument: String) -> TuningValues {
        tunings[instrument] ?? TuningValues()
    }

    /// A new tune to create from these values.
    public var tuneInput: TuneInput {
        TuneInput(
            title: trimmed(title), alternateTitles: splitTitles(alternateTitles), genre: blankToNil(genre),
            lyrics: blankToNil(lyrics), key: blankToNil(key), tuneType: blankToNil(tuneType),
            modes: modes.filter { !$0.isEmpty }, composer: blankToNil(composer), tunings: tuningsMap(stored: [:]),
            partStructure: blankToNil(partStructure), timeSignature: timeSignature.isEmpty ? nil : timeSignature,
            isCrooked: isCrooked)
    }

    /// The musician's own row to create beside a new tune.
    public var userTuneInput: UserTuneInput {
        UserTuneInput(
            status: status, learnedFrom: blankToNil(learnedFrom), learnedOn: learnedOn.isEmpty ? nil : learnedOn,
            notes: blankToNil(notes))
    }

    /// The stored map with each instrument the form changed written over it. A key this build
    /// does not know, and every entry the form left as stored, survives unchanged.
    public func tuningsMap(stored: JSONObject) -> JSONObject {
        var map = stored
        for instrument in Vocabulary.instruments {
            guard let entry = tunings[instrument] else { continue }
            let tuning = blankToNil(entry.tuning)
            let current = tuningEntry(stored, instrument: instrument)
            if tuning == current.tuning && entry.capo == current.capo { continue }
            map = setTuning(map, instrument: instrument, tuning: tuning, capo: entry.capo)
        }
        return map
    }

    /// The edit to save: only the fields whose saved value differs from what `opened` would
    /// save, so a save never writes over a field the musician left alone.
    public func patches(from opened: TuneFormValues, storedTunings: JSONObject) -> (
        tune: TunePatch, userTune: UserTunePatch
    ) {
        let next = tuneInput
        let before = opened.tuneInput
        var tune = TunePatch()
        tune.title = changed(next.title, before.title)
        tune.alternateTitles = changed(next.alternateTitles, before.alternateTitles)
        tune.genre = changed(next.genre, before.genre)
        tune.lyrics = changed(next.lyrics, before.lyrics)
        tune.key = changed(next.key, before.key)
        tune.tuneType = changed(next.tuneType, before.tuneType)
        tune.modes = changed(next.modes, before.modes)
        tune.composer = changed(next.composer, before.composer)
        tune.tunings = changed(tuningsMap(stored: storedTunings), storedTunings)
        tune.partStructure = changed(next.partStructure, before.partStructure)
        tune.timeSignature = changed(next.timeSignature, before.timeSignature)
        tune.isCrooked = changed(next.isCrooked, before.isCrooked)

        let nextUser = userTuneInput
        let beforeUser = opened.userTuneInput
        var userTune = UserTunePatch()
        userTune.status = changed(nextUser.status, beforeUser.status)
        userTune.learnedFrom = changed(nextUser.learnedFrom, beforeUser.learnedFrom)
        userTune.learnedOn = changed(nextUser.learnedOn, beforeUser.learnedOn)
        userTune.notes = changed(nextUser.notes, beforeUser.notes)
        return (tune, userTune)
    }
}

private func changed<Value: Equatable & Sendable>(_ next: Value, _ before: Value) -> Patch<Value> {
    next == before ? .keep : .value(next)
}

private func trimmed(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func blankToNil(_ value: String) -> String? {
    let value = trimmed(value)
    return value.isEmpty ? nil : value
}

private func splitTitles(_ value: String) -> [String] {
    value.split(separator: ",").map { trimmed(String($0)) }.filter { !$0.isEmpty }
}
