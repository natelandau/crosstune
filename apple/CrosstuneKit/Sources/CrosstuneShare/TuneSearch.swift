import CrosstuneVocabulary

/// Finds tunes by title in the share extension, by the rule every tune search uses. Each title is
/// folded once, so a search per keystroke folds only the query.
public struct TuneSearch: Sendable {
    private let entries: [(entry: ShareTuneEntry, title: FoldedText)]

    public init(_ entries: [ShareTuneEntry]) {
        self.entries = entries.map { ($0, FoldedText($0.title)) }
    }

    public func results(_ query: String) -> [ShareTuneEntry] {
        let key = FoldedText(query)
        return entries.filter { containsText($0.title, key) }.map(\.entry)
    }

    /// Whether to offer a new tune named `query`. An exact match still offers one, since two tunes
    /// can share a title.
    public static func offersCreate(_ query: String) -> Bool {
        !trimmedText(query).isEmpty
    }
}
