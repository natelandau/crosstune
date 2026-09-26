import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// A field the bulk edit sheet sets across many tunes. A field whose value belongs to one tune
/// alone, such as a title, a composer, or notes, is never here.
public enum EditField: Hashable, Sendable {
    case status
    case key
    case mode
    case tuning(String)
    case genre
    case tuneType
    case timeSignature
    case partStructure
    case isCrooked
    case learnedFrom
    case learnedOn

    /// How a field is set: picked from a list, typed, picked as a day, or yes or no.
    public enum Kind: Sendable {
        case choice
        case text
        case date
        case yesNo
    }

    /// Every field, in the order the sheet reads.
    public static let all: [EditField] =
        [.status, .key, .mode] + Vocabulary.instruments.map(EditField.tuning)
        + [.genre, .tuneType, .timeSignature, .partStructure, .isCrooked, .learnedFrom, .learnedOn]

    /// The field's name, as the tune form calls it.
    public var label: String {
        switch self {
        case .status: TuneFieldLabels.status
        case .key: TuneFieldLabels.key
        case .mode: TuneFieldLabels.partMode(0)
        case .tuning(let instrument): TuneFieldLabels.tuning(instrument)
        case .genre: TuneFieldLabels.genre
        case .tuneType: TuneFieldLabels.tuneType
        case .timeSignature: TuneFieldLabels.timeSignature
        case .partStructure: TuneFieldLabels.partStructure
        case .isCrooked: TuneFieldLabels.isCrooked
        case .learnedFrom: TuneFieldLabels.learnedFrom
        case .learnedOn: TuneFieldLabels.learnedOn
        }
    }

    public var kind: Kind {
        switch self {
        case .isCrooked: .yesNo
        case .learnedFrom: .text
        case .learnedOn: .date
        default: .choice
        }
    }

    /// The instrument whose tuning this field sets, or nil for a column.
    public var instrument: String? {
        if case .tuning(let instrument) = self { return instrument }
        return nil
    }
}

/// One field's value on one tune: text for a text, choice, or date field, a flag for yes or no.
public enum EditValue: Hashable, Sendable {
    case text(String)
    case flag(Bool)
}

/// What the selected tunes hold in one field.
public enum EditSummary: Hashable, Sendable {
    /// Every tune holds this value.
    case shared(EditValue)
    /// The tunes disagree.
    case mixed
    /// No tune holds a value.
    case empty
}

/// A field the musician has touched: a value to write, or clear to empty it on every tune.
public enum TouchedValue: Hashable, Sendable {
    case text(String)
    case flag(Bool)
    case clear
}

/// The bulk edit sheet's rules: what the selected tunes share, which fields it offers, when a
/// touch changes nothing, and the one write a save makes.
public enum BatchEdit {
    /// The value `entry` holds in `field`, or nil. A value from a newer server that this build
    /// does not know reads as none, rather than being trusted as one of the known choices.
    static func value(_ entry: CatalogEntry, _ field: EditField) -> EditValue? {
        let tune = entry.tune
        let userTune = entry.userTune
        switch field {
        case .status:
            return Vocabulary.statusLabels[userTune.status] == nil ? nil : .text(userTune.status)
        case .key: return tune.key.map(EditValue.text)
        case .mode:
            let modes = tune.modes.filter(Vocabulary.modes.contains)
            return modes.isEmpty ? nil : .text(modes.joined(separator: ", "))
        case .tuning(let instrument):
            return tuningEntry(tune.tunings, instrument: instrument).tuning.map(EditValue.text)
        case .genre: return tune.genre.map(EditValue.text)
        case .tuneType: return tune.tuneType.map(EditValue.text)
        case .timeSignature:
            guard let signature = tune.timeSignature, Vocabulary.timeSignatures.contains(signature) else { return nil }
            return .text(signature)
        case .partStructure: return tune.partStructure.map(EditValue.text)
        case .isCrooked: return .flag(tune.isCrooked)
        case .learnedFrom: return userTune.learnedFrom.map(EditValue.text)
        case .learnedOn: return userTune.learnedOn.map(EditValue.text)
        }
    }

    /// What the tunes share in every field.
    public static func summarize(_ entries: [CatalogEntry]) -> [EditField: EditSummary] {
        var summaries: [EditField: EditSummary] = [:]
        for field in EditField.all {
            let values = entries.map { value($0, field) }
            let first = values.first ?? nil
            if !values.allSatisfy({ $0 == first }) {
                summaries[field] = .mixed
            } else {
                summaries[field] = first.map(EditSummary.shared) ?? .empty
            }
        }
        return summaries
    }

    /// Every field, less a tuning for an instrument the musician does not play and no selected
    /// tune has a tuning for. A capo alone does not count.
    public static func visibleFields(_ entries: [CatalogEntry], instruments: Set<String>) -> [EditField] {
        EditField.all.filter { field in
            guard let instrument = field.instrument else { return true }
            return instruments.contains(instrument)
                || entries.contains { tuningEntry($0.tune.tunings, instrument: instrument).tuning != nil }
        }
    }

    /// True when saving `value` would leave every tune as it is. Compares the raw text, not the
    /// trimmed text a save writes, so a space typed mid-word does not snap the row back to
    /// untouched.
    public static func isUnchanged(_ summary: EditSummary, _ value: TouchedValue) -> Bool {
        switch value {
        case .clear, .text(""): summary == .empty
        case .text(let text): summary == .shared(.text(text))
        case .flag(let flag): summary == .shared(.flag(flag))
        }
    }

    /// The write for the touched fields. A value outside its field's vocabulary is skipped, so
    /// it never reaches the outbox, and status is never cleared.
    public static func patch(_ touched: [EditField: TouchedValue]) -> BulkPatch {
        var patch = BulkPatch()
        for field in EditField.all {
            guard let raw = touched[field] else { continue }
            let text: String?
            let flag: Bool?
            switch raw {
            case .text(let value):
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                text = trimmed.isEmpty ? nil : trimmed
                flag = nil
            case .flag(let value):
                text = nil
                flag = value
            case .clear:
                text = nil
                flag = nil
            }
            switch field {
            case .status:
                if let text, Vocabulary.statuses.contains(text) { patch.userTune.status = .value(text) }
            case .learnedFrom: patch.userTune.learnedFrom = .value(text)
            case .learnedOn: patch.userTune.learnedOn = .value(text)
            case .mode:
                if let text {
                    if Vocabulary.modes.contains(text) { patch.tune.modes = .value([text]) }
                } else {
                    patch.tune.modes = .value([])
                }
            case .timeSignature:
                if text.map(Vocabulary.timeSignatures.contains) ?? true { patch.tune.timeSignature = .value(text) }
            case .isCrooked:
                if let flag { patch.tune.isCrooked = .value(flag) }
            case .key: patch.tune.key = .value(text)
            case .genre: patch.tune.genre = .value(text)
            case .tuneType: patch.tune.tuneType = .value(text)
            case .partStructure: patch.tune.partStructure = .value(text)
            case .tuning(let instrument): patch.tunings[instrument] = .value(text)
            }
        }
        return patch
    }
}

/// The bulk edit sheet's state: what the selected tunes share and what the musician has
/// touched. Only a touched field is written.
public struct BulkEditForm: Equatable, Sendable {
    public static let mixed = "Mixed"
    /// A choice row's empty choice, which empties the field on every tune.
    public static let clear = "Clear"
    /// A yes or no row's empty choice, which leaves every tune as it is.
    public static let keep = "Keep"
    public static let yes = "Yes"
    public static let no = "No"
    public static let footnote = "Only fields you change are saved."

    public let summaries: [EditField: EditSummary]
    /// The fields offered, in order.
    public let fields: [EditField]
    public private(set) var touched: [EditField: TouchedValue] = [:]

    public init(entries: [CatalogEntry], instruments: Set<String>) {
        summaries = BatchEdit.summarize(entries)
        fields = BatchEdit.visibleFields(entries, instruments: instruments)
    }

    public func summary(_ field: EditField) -> EditSummary {
        summaries[field] ?? .empty
    }

    /// Sets a field, or leaves it untouched when `value` is nil or would change no tune.
    public mutating func touch(_ field: EditField, _ value: TouchedValue?) {
        if let value, !BatchEdit.isUnchanged(summary(field), value) {
            touched[field] = value
        } else {
            touched[field] = nil
        }
    }

    /// Whether anything would be written, which is what makes Save live.
    public var isEdited: Bool { !touched.isEmpty }

    /// The save's write.
    public var patch: BulkPatch { BatchEdit.patch(touched) }

    /// The row's value: the touched one, else the one every tune shares, else nil.
    public func value(_ field: EditField) -> EditValue? {
        switch touched[field] {
        case .text(let text): return text.isEmpty ? nil : .text(text)
        case .flag(let flag): return .flag(flag)
        case .clear: return nil
        case nil:
            if case .shared(let value) = summary(field) { return value }
            return nil
        }
    }

    /// The row's value as text, empty when it has none.
    public func text(_ field: EditField) -> String {
        if case .text(let text) = value(field) { return text }
        return ""
    }

    /// Whether the row still stands for tunes that disagree.
    public func isMixed(_ field: EditField) -> Bool {
        touched[field] == nil && summary(field) == .mixed
    }

    /// What the row says when it holds no value: Mixed for tunes that disagree, else Not set.
    public func placeholder(_ field: EditField) -> String {
        isMixed(field) ? Self.mixed : TuneFieldLabels.notSet
    }

    /// What the row shows: its value, Not set, or Mixed.
    public func shown(_ field: EditField) -> String {
        switch value(field) {
        case .text(let text): field == .status ? StatusStyle.label(text) : text
        case .flag(let flag): flag ? Self.yes : Self.no
        case nil: placeholder(field)
        }
    }
}
