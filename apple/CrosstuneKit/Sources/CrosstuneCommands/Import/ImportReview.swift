import CrosstuneStore
import CrosstuneVocabulary

public enum ImportWarning: String, Sendable {
    case shortened
}

/// One title the musician can check, edit, and add.
public struct ImportRow: Identifiable, Equatable, Sendable {
    public let id: Int
    public var title: String
    public let source: String
    public var duplicate: Bool
    public var included: Bool
    public var warnings: [ImportWarning]
}

public struct ImportReview: Equatable, Sendable {
    public var rows: [ImportRow]
    public let dropped: Int
    public let lineCount: Int

    /// Many lines that yield one row are likely a list in a shape the reader could not split.
    static let longSingleRowLines = 20

    /// True when the paste likely held more than the reader could use, so the help is worth
    /// showing.
    public var suggestsHelp: Bool {
        dropped > 0 || rows.contains { !$0.warnings.isEmpty }
            || (rows.count == 1 && lineCount > Self.longSingleRowLines)
    }
}

/// Turns candidates into review rows: titles cut to the tune limit, candidates whose titles fold
/// equal merged into the first, duplicates of the catalog unchecked, and rows past the import
/// limit counted in `dropped`. `fixtures/import/review.json` pins the rules for both clients.
public enum ImportReviewBuilder {
    public static let limit = 500

    /// `catalog` is every tune not deleted, archived included.
    public static func build(_ read: PlainListRead, catalog: [Tune]) -> ImportReview {
        let catalogTitles = foldedTitles(catalog)
        var rows: [ImportRow] = []
        var seen: Set<FoldedText> = []
        var dropped = 0

        for candidate in read.candidates {
            // Code points, as JavaScript's `Array.from` counts them, never `Character`s.
            let scalars = candidate.title.unicodeScalars
            let maximum = Vocabulary.Limits.Tune.title
            let shortened = scalars.count > maximum
            let title = shortened ? String(String.UnicodeScalarView(scalars.prefix(maximum))) : candidate.title

            let folded = FoldedText(title)
            if !folded.isEmpty {
                if seen.contains(folded) { continue }
                seen.insert(folded)
            }

            if rows.count >= limit {
                dropped += 1
                continue
            }

            let duplicate = titlesInclude(catalogTitles, folded)
            rows.append(
                ImportRow(
                    id: rows.count, title: title, source: candidate.source, duplicate: duplicate,
                    included: !duplicate, warnings: shortened ? [.shortened] : []))
        }

        return ImportReview(rows: rows, dropped: dropped, lineCount: read.lineCount)
    }

    /// The rows with each duplicate flag checked against the catalog as it is now. The checks stay
    /// as the musician left them.
    public static func markDuplicates(_ rows: [ImportRow], catalog: [Tune]) -> [ImportRow] {
        let catalogTitles = foldedTitles(catalog)
        return rows.map { row in
            var row = row
            row.duplicate = titlesInclude(catalogTitles, FoldedText(row.title))
            return row
        }
    }

    /// True when the title matches a catalog tune's title or alternate title, archived tunes
    /// included, given the catalog's ``foldedTitles(_:)``.
    public static func isDuplicate(_ title: String, titles catalogTitles: Set<FoldedText>) -> Bool {
        titlesInclude(catalogTitles, FoldedText(title))
    }
}
