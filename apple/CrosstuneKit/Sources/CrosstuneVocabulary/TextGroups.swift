// The web compares strings by UTF-16 code unit. Swift's String equality, hashing, case mapping, and
// whitespace set all differ from JavaScript's, so text that groups, sorts, or trims goes through
// these helpers to group and order exactly as the web does.

/// UTF-16 code unit order, as JavaScript's `<` compares strings, never a locale collator.
public func precedes(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

/// A string keyed by its UTF-16 code units, as a JavaScript `Map` keys it, so canonically
/// equivalent spellings such as NFC and NFD stay apart.
public struct TextKey: Hashable, Sendable {
    public let text: String

    public init(_ text: String) {
        self.text = text
    }

    public static func == (a: TextKey, b: TextKey) -> Bool {
        a.text.utf16.elementsEqual(b.text.utf16)
    }

    public func hash(into hasher: inout Hasher) {
        for unit in text.utf16 { hasher.combine(unit) }
    }
}

/// The trimmed spelling, or nil for a value the fold calls blank.
public func heldSpelling(_ value: String?) -> String? {
    guard let spelling = value.map(trimmedText), !spelling.isEmpty, !foldText(spelling).isEmpty else { return nil }
    return spelling
}

/// Items grouped the way the catalog filter matches their trimmed spelling, so a group's shown
/// spelling filters to exactly its members. A blank spelling joins no group. `shown` is the
/// spelling most members hold, ties to the first in code point order.
public func groupByFold<T>(_ items: [T], spelling: (T) -> String?) -> [(shown: String, members: [T])] {
    var groups: [TextKey: (spellings: [TextKey: Int], members: [T])] = [:]
    for item in items {
        guard let trimmed = heldSpelling(spelling(item)) else { continue }
        let key = TextKey(foldText(trimmed))
        groups[key, default: ([:], [])].spellings[TextKey(trimmed), default: 0] += 1
        groups[key]!.members.append(item)
    }
    return groups.values.map { group in
        let shown = group.spellings.min { a, b in
            a.value != b.value ? a.value > b.value : precedes(a.key.text, b.key.text)
        }!
        return (shown.key.text, group.members)
    }
}
