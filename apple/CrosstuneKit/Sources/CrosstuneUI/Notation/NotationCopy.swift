import CrosstuneCommands
import CrosstuneStore
import Foundation

/// Every word the Notation section, its add menu, the viewer, and the row action say, in the web
/// client's wording.
public enum NotationCopy {
    /// The section on the tune screen, the row action that opens the viewer, and the viewer's name.
    public static let notation = "Notation"
    /// The section header's add control, a glyph named in words.
    public static let addNotation = "Add notation"
    public static let emptyTitle = "No notation yet"
    public static let emptyHint = "Add a photo or scan of the written tune."
    public static let limitNote = "A tune holds up to \(maxNotationPagesPerTune) pages."
    public static let invert = "Invert"
    public static let zoom = "Zoom"
    public static let close = "Close"
    public static let previousPage = "Previous page"
    public static let nextPage = "Next page"
    public static let delete = "Delete"
    public static let deleteTitle = "Delete this page?"
    public static let unreadablePage = "This page cannot be shown"
    // The screen's toolbar carries its own Edit, for the tune, so these name what they edit.
    public static let editNotation = "Edit notation"
    public static let doneEditingNotation = "Done editing notation"
    public static let edit = "Edit"
    public static let done = "Done"

    /// Shown on a page whose upload the server refused for quota; the sync layer stores the code
    /// ``NotationFile/storageFullError``.
    public static let storageFull = "Not uploaded, storage full"
    /// Shown on a page the server refused outright; the sync layer stores the code
    /// ``NotationFile/refusedError``.
    public static let refused = "Could not upload. Delete this page and add it again."
    /// Shown on a page captured here whose upload failed for a reason with no label of its own.
    public static let notUploaded = "Not uploaded yet"
    /// Shown on a page another device captured and has not uploaded yet.
    public static let waiting = "Waiting for upload from another device"

    public static func page(_ index: Int) -> String { "Page \(index + 1)" }
    public static func openPage(_ index: Int) -> String { "Open page \(index + 1)" }
    public static func deletePage(_ index: Int) -> String { "Delete page \(index + 1)" }
    public static func reorderPage(_ index: Int) -> String { "Reorder page \(index + 1)" }
    public static func movePage(_ index: Int) -> String { "Move page \(index + 1)" }
    public static func downloadingPage(_ index: Int) -> String { "Downloading page \(index + 1)" }
    public static func pageCount(index: Int, total: Int) -> String { "\(index + 1) of \(total)" }
    public static func moved(from: Int, to: Int, total: Int) -> String {
        "\(page(from)) moved to \(to + 1) of \(total)"
    }

    /// The label for why a file has not uploaded, or nil when it needs no word. Any other error
    /// on a captured file, such as an image the server finds too large, still leaves it only on
    /// this device, so the musician hears that much.
    public static func errorLabel(_ file: NotationFile) -> String? {
        switch file.error {
        case NotationFile.storageFullError: storageFull
        case NotationFile.refusedError: refused
        case .some(let error) where !error.isEmpty && file.origin == .captured: notUploaded
        default: nil
        }
    }

    /// What a page cannot show by its image alone: why it has not uploaded, or that it is still
    /// to come from another device.
    public static func status(for page: NotationPage) -> String? {
        if let file = page.file { return errorLabel(file) }
        return page.record.state == NotationPageRecord.pendingUpload ? waiting : nil
    }

    /// The delete confirmation's message: a captured file is the only copy until it uploads.
    public static func deleteMessage(_ page: NotationPage) -> String {
        page.file?.origin == .captured ? RecordingsModel.deleteUnsyncedNote : RecordingsModel.deleteSyncedNote
    }

    /// Says how many picked images a tune had no room for.
    public static func pagesNotAdded(_ count: Int) -> String {
        let pages = count == 1 ? "1 page was" : "\(count) pages were"
        return "\(pages) not added. \(limitNote)"
    }

    /// Names every picked image that could not be read, so the musician knows which to convert.
    public static func unreadable(_ names: [String]) -> String {
        let quoted = names.map { "\"\($0)\"" }.formatted(.list(type: .and).locale(Locale(identifier: "en")))
        return names.count == 1
            ? "\(quoted) is not an image Crosstune can read."
            : "\(quoted) are not images Crosstune can read."
    }
}
