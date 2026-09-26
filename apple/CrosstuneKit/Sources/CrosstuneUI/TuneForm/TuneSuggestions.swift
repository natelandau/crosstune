import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// What the tune form suggests for the open vocabularies, drawn from the vocabulary and from the
/// catalog's own use. Values that differ only in case or accents count as one.
public enum TuneSuggestions {
    /// The composer a player writes for a tune with no known author.
    public static let traditional = "Traditional"

    /// Type suggestions for a tune: its genre's types, else the catalog's by use, then the rest
    /// alphabetically.
    public static func types(genre: String, tunes: [Tune]) -> [String] {
        let own = lookup(Vocabulary.genreTypes, trimmed(genre)) ?? []
        let lead = own.isEmpty ? mostFirst(tally(tunes.map(\.tuneType), canonical: Vocabulary.tuneTypes)) : own
        let rest = without(Vocabulary.tuneTypes, lead).sorted(by: ordered)
        return lead + rest
    }

    /// The genre most tunes hold, ties broken alphabetically, or nil when none has one.
    public static func mostUsedGenre(_ tunes: [Tune]) -> String? {
        mostFirst(tally(tunes.map(\.genre), canonical: Vocabulary.genres)).first
    }

    /// Composer suggestions: Traditional first, then every composer the catalog holds,
    /// alphabetically.
    public static func composers(_ tunes: [Tune]) -> [String] {
        let named = tally(tunes.map(\.composer), canonical: []).map(\.value)
        return [traditional] + without(named, [traditional]).sorted(by: ordered)
    }

    /// The one time signature a type is written in, or nil when it has none or several.
    public static func timeSignature(for type: String) -> String? {
        lookup(Vocabulary.typeTimeSignatures, trimmed(type))
    }

    // MARK: - Counting spellings

    private static func same(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }

    private static func ordered(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: .current)
            == .orderedAscending
    }

    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func lookup<T>(_ table: [String: T], _ key: String) -> T? {
        table.first { same($0.key, key) }?.value
    }

    private static func without(_ values: [String], _ taken: [String]) -> [String] {
        values.filter { value in !taken.contains { same($0, value) } }
    }

    /// One value's spellings, grouped by the first seen.
    private struct Spellings {
        let firstSeen: String
        var total = 0
        /// Each raw spelling with its count, in the order first seen.
        var counts: [(spelling: String, count: Int)] = []
    }

    /// Each value once with how many tunes hold it, in the order first seen. A value that matches
    /// a canonical entry is shown the canonical way; any other the way most tunes spell it, ties
    /// to the first seen.
    private static func tally(_ values: [String?], canonical: [String]) -> [(value: String, count: Int)] {
        var groups: [Spellings] = []
        for raw in values {
            guard let value = raw.map(trimmed), !value.isEmpty else { continue }
            let index: Int
            if let found = groups.firstIndex(where: { same($0.firstSeen, value) }) {
                index = found
            } else {
                groups.append(Spellings(firstSeen: value))
                index = groups.count - 1
            }
            groups[index].total += 1
            if let spelling = groups[index].counts.firstIndex(where: { $0.spelling == value }) {
                groups[index].counts[spelling].count += 1
            } else {
                groups[index].counts.append((value, 1))
            }
        }
        return groups.map { group in
            if let known = canonical.first(where: { same($0, group.firstSeen) }) { return (known, group.total) }
            var best = group.counts[0]
            for entry in group.counts.dropFirst() where entry.count > best.count { best = entry }
            return (best.spelling, group.total)
        }
    }

    private static func mostFirst(_ counts: [(value: String, count: Int)]) -> [String] {
        counts.sorted { $0.count != $1.count ? $0.count > $1.count : ordered($0.value, $1.value) }.map(\.value)
    }
}
