import CrosstuneStore
import CrosstuneVocabulary

/// True when the folded title names one of the folded titles, as `sameText` compares them. A
/// title that folds to nothing names no tune.
public func titlesInclude(_ titles: some Sequence<FoldedText>, _ title: FoldedText) -> Bool {
    !title.isEmpty && titles.contains { sameText($0, title) }
}

/// ``titlesInclude(_:_:)`` over a set, for a caller that checks many titles against many tunes.
public func titlesInclude(_ titles: Set<FoldedText>, _ title: FoldedText) -> Bool {
    !title.isEmpty && titles.contains(title)
}

/// Every title and alternate title of the tunes, folded once, for ``titlesInclude(_:_:)``.
public func foldedTitles(_ tunes: some Sequence<Tune>) -> Set<FoldedText> {
    Set(tunes.lazy.flatMap { [$0.title] + $0.alternateTitles }.map(FoldedText.init))
}
