import CrosstuneCommands
import CrosstuneStore
import Foundation

/// Every word the Scans section, its add menu, the viewer, and the row action say, in the web
/// client's wording.
public enum ScanCopy {
    /// The section on the tune screen, the row action that opens the viewer, and the viewer's name.
    public static let scans = "Scans"
    /// The section header's add control, a glyph named in words.
    public static let addScans = "Add scans"
    public static let emptyTitle = "No scans yet"
    public static let emptyHint = "Add a photo of written music, lyrics, or notes."
    public static let limitNote = "A tune holds up to \(maxScansPerTune) scans."
    public static let invert = "Invert"
    public static let zoom = "Zoom"
    public static let close = "Close"
    public static let previousScan = "Previous scan"
    public static let nextScan = "Next scan"
    public static let delete = "Delete"
    public static let deleteTitle = "Delete this scan?"
    public static let unreadableScan = "This scan cannot be shown"
    // The screen's toolbar carries its own Edit, for the tune, so these name what they edit.
    public static let editScans = "Edit scans"
    public static let doneEditingScans = "Done editing scans"
    public static let edit = "Edit"
    public static let done = "Done"

    /// Shown on a scan whose upload the server refused for quota; the sync layer stores the code
    /// ``ScanFile/storageFullError``.
    public static let storageFull = "Not uploaded, storage full"
    /// Shown on a scan the server refused outright; the sync layer stores the code
    /// ``ScanFile/refusedError``.
    public static let refused = "Could not upload. Delete this scan and add it again."
    /// Shown on a scan captured here whose upload failed for a reason with no label of its own.
    public static let notUploaded = "Not uploaded yet"
    /// Shown on a scan another device captured and has not uploaded yet.
    public static let waiting = "Waiting for upload from another device"

    public static func scan(_ index: Int) -> String { "Scan \(index + 1)" }
    public static func openScan(_ index: Int) -> String { "Open scan \(index + 1)" }
    public static func deleteScan(_ index: Int) -> String { "Delete scan \(index + 1)" }
    public static func reorderScan(_ index: Int) -> String { "Reorder scan \(index + 1)" }
    public static func moveScan(_ index: Int) -> String { "Move scan \(index + 1)" }
    public static func downloadingScan(_ index: Int) -> String { "Downloading scan \(index + 1)" }
    public static func scanCount(index: Int, total: Int) -> String { "\(index + 1) of \(total)" }
    public static func moved(from: Int, to: Int, total: Int) -> String {
        "\(scan(from)) moved to \(to + 1) of \(total)"
    }

    /// The label for why a file has not uploaded, or nil when it needs no word. Any other error
    /// on a captured file, such as an image the server finds too large, still leaves it only on
    /// this device, so the musician hears that much.
    public static func errorLabel(_ file: ScanFile) -> String? {
        switch file.error {
        case ScanFile.storageFullError: storageFull
        case ScanFile.refusedError: refused
        case .some(let error) where !error.isEmpty && file.origin == .captured: notUploaded
        default: nil
        }
    }

    /// What a scan cannot show by its image alone: why it has not uploaded, or that it is still
    /// to come from another device.
    public static func status(for scan: Scan) -> String? {
        if let file = scan.file { return errorLabel(file) }
        return scan.record.state == ScanRecord.pendingUpload ? waiting : nil
    }

    /// The delete confirmation's message: a captured file is the only copy until it uploads.
    public static func deleteMessage(_ scan: Scan) -> String {
        scan.file?.origin == .captured ? RecordingsModel.deleteUnsyncedNote : RecordingsModel.deleteSyncedNote
    }

    /// Says how many picked images a tune had no room for.
    public static func scansNotAdded(_ count: Int) -> String {
        let scans = count == 1 ? "1 scan was" : "\(count) scans were"
        return "\(scans) not added. \(limitNote)"
    }

    /// Names every picked image that could not be read, so the musician knows which to convert.
    public static func unreadable(_ names: [String]) -> String {
        let quoted = names.map { "\"\($0)\"" }.formatted(.list(type: .and).locale(Locale(identifier: "en")))
        return names.count == 1
            ? "\(quoted) is not an image Crosstune can read."
            : "\(quoted) are not images Crosstune can read."
    }
}
