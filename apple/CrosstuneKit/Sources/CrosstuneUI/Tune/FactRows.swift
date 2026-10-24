import CrosstuneCommands
import CrosstuneVocabulary
import Foundation

/// A fact the tune page shows, named so an edit lands on the right one.
public enum FactID: Hashable, Sendable {
    case status
    case key
    case tuning(String)
    case tuneType
    case timeSignature
    case partStructure
    case isCrooked
    case genre
    case composer
    case alternateTitles
    case learnedFrom
    case learnedOn
}

/// One fact row.
public struct FactRow: Hashable, Sendable, Identifiable {
    public enum Group: Hashable, Sendable {
        case tune
        case learned
    }

    public let id: FactID
    public let label: String
    /// Nil when the tune holds no value, so the row can offer to add one.
    public let text: String?
    public let group: Group
}

/// The ordered fact rows the tune page's rail and card show.
public enum FactRows {
    /// A letter per mode a tune can hold: A for the tune's own, then one per part from B.
    static let partLetters: [Character] = (0..<Vocabulary.Limits.Tune.modes).map { index in
        Character(UnicodeScalar(UInt8(ascii: "A") + UInt8(index)))
    }

    public static func rows(_ detail: TuneDetail, locale: Locale = .current) -> [FactRow] {
        let tune = detail.tune
        let userTune = detail.userTune
        func row(_ id: FactID, _ label: String, _ text: String?, _ group: FactRow.Group = .tune) -> FactRow {
            FactRow(id: id, label: label, text: text?.isEmpty == false ? text : nil, group: group)
        }
        let tunings = detail.tuningInstruments.map { instrument in
            row(
                .tuning(instrument), TuneFieldLabels.tuning(instrument),
                tuningDisplay(tune.tunings, instrument: instrument))
        }
        return [
            row(.status, TuneFieldLabels.status, StatusStyle.label(userTune.status)),
            row(.key, TuneFieldLabels.key, keyText(key: tune.key, modes: tune.modes)),
        ] + tunings + [
            row(.tuneType, TuneFieldLabels.tuneType, tune.tuneType),
            row(.timeSignature, TuneFieldLabels.timeSignature, tune.timeSignature),
            row(.partStructure, TuneFieldLabels.partStructure, tune.partStructure),
        ] + (tune.isCrooked ? [row(.isCrooked, TuneFieldLabels.isCrooked, TuneFieldLabels.isCrooked)] : []) + [
            row(.genre, TuneFieldLabels.genre, tune.genre),
            row(.composer, TuneFieldLabels.composer, tune.composer),
            row(.alternateTitles, TuneFieldLabels.alternateTitles, detail.alternateTitles),
            row(.learnedFrom, TuneFieldLabels.learnedFrom, userTune.learnedFrom, .learned),
            row(
                .learnedOn, TuneFieldLabels.learnedOn,
                userTune.learnedOn.flatMap { $0.isEmpty ? nil : TuneDetail.learnedOn($0, locale: locale) },
                .learned),
        ]
    }

    /// The rows a narrow card shows up front: status, key, tunings, and type with its parts
    /// folded in. Everything else waits behind "more", the parts row too, so it stays editable.
    public static func card(_ rows: [FactRow]) -> (shown: [FactRow], more: [FactRow]) {
        let parts = rows.first { $0.id == .partStructure }?.text
        var shown: [FactRow] = []
        var more: [FactRow] = []
        for row in rows {
            switch row.id {
            case .tuneType:
                let folded = [row.text, parts].compactMap { $0 }.joined(separator: " · ")
                shown.append(
                    FactRow(id: row.id, label: row.label, text: folded.isEmpty ? nil : folded, group: row.group))
            case .status, .key, .tuning:
                shown.append(row)
            default:
                more.append(row)
            }
        }
        return (shown, more)
    }

    /// The key with each part's mode: the first mode is the tune's, later ones name their part.
    /// A mode the key text cannot name, or `other`, is left out.
    private static func keyText(key: String?, modes: [String]) -> String? {
        guard let first = KeyModeText(key: key, modes: modes) else { return nil }
        let parts = modes.dropFirst().enumerated().compactMap { index, mode -> String? in
            guard KeyModeText.isNamed(mode), index + 1 < partLetters.count else { return nil }
            return "\(partLetters[index + 1]) part \(mode)"
        }
        return ([first.spoken] + parts).joined(separator: ", ")
    }
}
