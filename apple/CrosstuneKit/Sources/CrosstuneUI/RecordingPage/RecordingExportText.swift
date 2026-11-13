import CrosstuneExport

/// The copy for sharing and exporting recordings, shared by the page menu and the export sheet.
public enum RecordingExportText {
    nonisolated public static let share = "Share"
    /// The Mac's save panel item.
    nonisolated public static let export = "Export…"
    nonisolated public static let capturing = "Recording in progress"
    nonisolated public static let notReady = "Still processing"
    nonisolated public static let offline = "Not on this device. Go online to download it."

    /// Runs a failed export again from the start.
    nonisolated public static let tryAgain = "Try again"

    /// Before a bulk export starts: how many of the `selected` recordings it leaves out, and why.
    nonisolated public static func skipped(_ count: Int, of selected: Int) -> String {
        count == 1
            ? "1 of \(selected) recordings can't be exported. It is still recording, still processing, or not on this device while offline."
            : "\(count) of \(selected) recordings can't be exported. They are still recording, still processing, or not on this device while offline."
    }

    /// After a bulk export: how many recordings it left out because their download failed.
    nonisolated public static func leftOut(_ count: Int) -> String {
        count == 1
            ? "1 recording could not be downloaded and was left out."
            : "\(count) recordings could not be downloaded and were left out."
    }

    /// Why a recording cannot be exported now, or nil when it can.
    nonisolated public static func disabledReason(_ readiness: ExportReadiness) -> String? {
        guard case .blocked(let block) = readiness else { return nil }
        switch block {
        case .capturing: return capturing
        case .notReady: return notReady
        case .offline: return offline
        }
    }
}
