import CrosstuneCommands
import CrosstuneVocabulary
import Foundation

/// The import sheet's words, the same on every client.
public enum ImportCopy {
    public static let title = "Import tunes"

    public static let pasteLabel = "Your tunes"
    public static let pastePlaceholder = "Paste your tunes, one per line"
    public static let openFile = "Open a file…"
    public static let continueAction = "Continue"
    public static let textFilesOnly = "Crosstune can open .txt files only."
    @MainActor public static var back: String { FindRecordingsSheet.back }

    public static let statusLabel = TuneFieldLabels.status
    public static let genreLabel = TuneFieldLabels.genre
    public static let listLabel = "Add these to a list"
    public static let noList = "Don't add"
    public static let newList = "New list"
    @MainActor public static var listNameLabel: String { ListNameSheet.nameLabel }

    public static let alreadyInCatalog = "Already in your catalog"
    public static let shortenedNote = "Shortened to \(Vocabulary.Limits.Tune.title) characters"
    public static let overLimitNote =
        "Only the first \(ImportReviewBuilder.limit) tunes are shown. Import the rest separately."

    public static let whatCanIPaste = "What can I paste?"
    public static let recordingsNote =
        "This imports tune titles. To bring in recordings, upload them on the Recordings screen. You can choose many files at once."

    public static let helpURL = URL(string: "https://crosstune.app/help/import")!

    /// The check button's name, which carries the row's title for a screen reader.
    public static func include(_ title: String) -> String {
        "Include \(title)"
    }

    public static func addTunes(_ n: Int) -> String {
        "Add \(CatalogSearch.tunes(n))"
    }

    public static func addedTunes(_ n: Int) -> String {
        "Added \(CatalogSearch.tunes(n))"
    }

    /// The default name of a list made by an import: "Imported" and the local date.
    public static func listName(on date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "Imported %04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}
