import CrosstuneStore
import CrosstuneVocabulary
import Foundation

private let maxRarities = 3
private let minDistinctForRarity = 3

struct StatsEntry {
    let tune: StatsInput.Tune
    let userTune: StatsInput.UserTune
}

// MARK: - Text

// The web compares strings by UTF-16 code unit. Swift's String equality, hashing, case mapping, and
// whitespace set all differ from JavaScript's, so text that groups, sorts, or trims goes through
// these helpers to group and order exactly as the web does.

/// UTF-16 code unit order, as JavaScript's `<` compares strings, never a locale collator.
func precedes(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

/// -1, 0, or 1, for chaining tie-breaks the way the web module's comparators do.
func compareText(_ a: String, _ b: String) -> Int {
    precedes(a, b) ? -1 : precedes(b, a) ? 1 : 0
}

/// A string keyed by its UTF-16 code units, as a JavaScript `Map` keys it, so canonically
/// equivalent spellings such as NFC and NFD stay apart.
struct TextKey: Hashable {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    static func == (a: TextKey, b: TextKey) -> Bool {
        a.text.utf16.elementsEqual(b.text.utf16)
    }

    func hash(into hasher: inout Hasher) {
        for unit in text.utf16 { hasher.combine(unit) }
    }
}

/// A value JavaScript reads as truthy: present and not empty.
func isSet(_ value: String?) -> Bool {
    value.map { !$0.isEmpty } ?? false
}

func present(_ value: String?) -> String? {
    isSet(value) ? value : nil
}

// MARK: - Breakdowns

/// Count descending, then value in code point order.
private func byCountThenValue(_ a: Stats.Value, _ b: Stats.Value) -> Bool {
    a.count != b.count ? a.count > b.count : precedes(a.value, b.value)
}

/// The trimmed spelling, or nil for a value the fold calls blank.
private func heldSpelling(_ value: String?) -> String? {
    guard let spelling = present(value.map(trimmedText)), !foldText(spelling).isEmpty else { return nil }
    return spelling
}

/// Items grouped the way the catalog filter matches their trimmed spelling, so tapping a group's
/// shown spelling opens exactly its members. A blank spelling joins no group. `shown` is the
/// spelling most members hold, ties to the first in code point order.
private func groupByFold<T>(_ items: [T], spelling: (T) -> String?) -> [(shown: String, members: [T])] {
    var groups: [TextKey: (spellings: [TextKey: Int], members: [T])] = [:]
    for item in items {
        guard let trimmed = heldSpelling(spelling(item)) else { continue }
        let key = TextKey(foldText(trimmed))
        groups[key, default: ([:], [])].spellings[TextKey(trimmed), default: 0] += 1
        groups[key]!.members.append(item)
    }
    return groups.values.map { group in
        let shown = group.spellings.map { Stats.Value(value: $0.key.text, count: $0.value) }
            .sorted(by: byCountThenValue)[0]
        return (shown.value, group.members)
    }
}

private func tally(_ values: [String?]) -> [Stats.Value] {
    groupByFold(values) { $0 }.map { Stats.Value(value: $0.shown, count: $0.members.count) }
        .sorted(by: byCountThenValue)
}

func tuning(of tune: StatsInput.Tune, instrument: String) -> String? {
    guard case .object(let map) = tune.tunings, case .object(let entry) = map[instrument],
        case .string(let tuning) = entry["tuning"]
    else { return nil }
    return present(tuning)
}

/// Each mode a tune holds in any part, once, so a key and mode cell counts the tunes the
/// catalog's mode filter shows for it.
private func heldModes(_ tune: StatsInput.Tune) -> [String] {
    var seen: Set<TextKey> = []
    return tune.modes.filter { mode in
        let key = foldText(mode)
        return !key.isEmpty && seen.insert(TextKey(key)).inserted
    }
}

private func keyRows(_ tunes: [StatsInput.Tune]) -> [Stats.KeyRow] {
    // One spelling per mode across every key, so each mode is one column of the grid, and a known
    // mode keeps the vocabulary's spelling so it sorts and abbreviates with the others.
    let modeNames = Dictionary(
        uniqueKeysWithValues: groupByFold(tunes.flatMap(heldModes)) { $0 }.map { group in
            (TextKey(foldText(group.shown)), Vocabulary.modes.first { sameText($0, group.shown) } ?? group.shown)
        }
    )
    return groupByFold(tunes, spelling: \.key).map { key, held in
        Stats.KeyRow(
            key: key, count: held.count,
            modes: tally(held.flatMap(heldModes).map { modeNames[TextKey(foldText($0))] }))
    }
    .sorted { a, b in a.count != b.count ? a.count > b.count : precedes(a.key, b.key) }
}

/// Every block lists only values a non-archived tune holds, so an unused block is empty.
func breakdowns(_ entries: [StatsEntry], instruments: [String]) -> Stats.Breakdowns {
    let tunes = entries.map(\.tune)
    return Stats.Breakdowns(
        key: keyRows(tunes),
        tuneType: tally(tunes.map(\.tuneType)),
        genre: tally(tunes.map(\.genre)),
        timeSignature: tally(tunes.map(\.timeSignature)),
        learnedFrom: tally(entries.map(\.userTune.learnedFrom)),
        tunings: instruments.map { instrument in
            Stats.TuningRow(instrument: instrument, values: tally(tunes.map { tuning(of: $0, instrument: instrument) }))
        }
        .filter { !$0.values.isEmpty }
    )
}

// MARK: - Rarities

/// The values exactly one tune holds, when the tunes hold at least three distinct values. Values
/// the catalog filter calls the same count as one.
private func onlyHolders(
    _ tunes: [StatsInput.Tune], valueOf: (StatsInput.Tune) -> String?
) -> [(value: String, tune: StatsInput.Tune)] {
    let groups = groupByFold(tunes, spelling: valueOf)
    guard groups.count >= minDistinctForRarity else { return [] }
    return groups.compactMap { shown, members in members.count == 1 ? (shown, members[0]) : nil }
}

/// At most three, in attribute order and then by title, so a catalog always shows the same ones.
func rarities(_ entries: [StatsEntry], instruments: [String]) -> [Stats.Rarity] {
    struct Candidate {
        let rarity: Stats.Rarity
        let title: String
        /// The instrument's place in the musician's list; 0 for every attribute but tuning.
        let instrument: Int
    }
    let tunes = entries.map(\.tune)
    let attributes: [(Stats.RarityAttribute, (StatsInput.Tune) -> String?)] = [
        (
            .keyMode,
            { tune in
                guard let key = heldSpelling(tune.key), let mode = heldSpelling(tune.modes.first) else { return nil }
                return "\(key) \(mode)"
            }
        ),
        (.timeSignature, { present($0.timeSignature) }),
        (.tuneType, { present($0.tuneType) }),
        (.genre, { present($0.genre) }),
    ]
    var candidates: [Candidate] = []
    for (attribute, valueOf) in attributes {
        for (value, tune) in onlyHolders(tunes, valueOf: valueOf) {
            candidates.append(
                Candidate(
                    rarity: Stats.Rarity(attribute: attribute, value: value, instrument: nil, tuneID: tune.id),
                    title: tune.title, instrument: 0))
        }
    }
    for (index, instrument) in instruments.enumerated() {
        for (value, tune) in onlyHolders(tunes, valueOf: { tuning(of: $0, instrument: instrument) }) {
            candidates.append(
                Candidate(
                    rarity: Stats.Rarity(attribute: .tuning, value: value, instrument: instrument, tuneID: tune.id),
                    title: tune.title, instrument: index))
        }
    }
    let order = Stats.RarityAttribute.allCases
    return candidates.sorted { a, b in
        let (attributeA, attributeB) = (
            order.firstIndex(of: a.rarity.attribute)!, order.firstIndex(of: b.rarity.attribute)!
        )
        if attributeA != attributeB { return attributeA < attributeB }
        let byTitle = compareText(a.title, b.title)
        if byTitle != 0 { return byTitle < 0 }
        if a.instrument != b.instrument { return a.instrument < b.instrument }
        return precedes(a.rarity.tuneID, b.rarity.tuneID)
    }
    .prefix(maxRarities)
    .map(\.rarity)
}
