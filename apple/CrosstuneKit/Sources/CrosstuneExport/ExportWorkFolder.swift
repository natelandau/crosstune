import Foundation

/// The temporary folders the exports build their files in, one per kind of export.
public enum ExportWorkFolder: String, CaseIterable, Sendable {
    case data = "crosstune-export"
    case recordings = "crosstune-recording-export"

    var url: URL {
        FileManager.default.temporaryDirectory.appending(path: rawValue, directoryHint: .isDirectory)
    }

    /// Deletes everything a past run of any export left in the temporary folder.
    public static func removeLeftovers() {
        for folder in allCases { removeLeftovers(root: folder.url) }
    }

    static func removeLeftovers(root: URL) {
        try? FileManager.default.removeItem(at: root)
    }
}
