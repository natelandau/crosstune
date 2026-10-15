import Foundation
import GRDB

/// How a scan's file came to be on this device.
public enum ScanOrigin: String, Codable, Hashable, Sendable, CaseIterable, DatabaseValueConvertible {
    /// Added here and waiting for upload: until the server has it, this is the only copy.
    case captured
    /// A cache of what the server holds.
    case downloaded
}

/// A scan's image file on this device: never synced, since the server never sees where
/// a device keeps or how it names a file. A row exists only once its file does.
public struct ScanFile: Codable, Hashable, Sendable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "scan_files"

    /// The `error` a captured file carries while the server refuses it for quota. A code, not
    /// copy: the UI maps it to its label.
    public static let storageFullError = "storage_full"
    /// The `error` a captured file carries once the server has refused its scan row, so it can
    /// not be given a slot. Deleting the scan clears it, and so does an upload that lands once a
    /// later push has stored the row.
    public static let refusedError = "refused"

    public var scanID: String
    /// Relative to the user's `scans/` folder.
    public var fileName: String
    public var origin: ScanOrigin
    public var error: String?
    /// Consecutive transient upload failures since the last success, driving the backoff.
    public var uploadAttempts: Int
    /// Before this, the upload pass skips the file, set by a transient failure's backoff.
    public var nextAttemptAt: Timestamp?

    public enum CodingKeys: String, CodingKey, ColumnExpression {
        case scanID = "scan_id"
        case fileName = "file_name"
        case origin
        case error
        case uploadAttempts = "upload_attempts"
        case nextAttemptAt = "next_attempt_at"
    }

    public init(
        scanID: String, fileName: String, origin: ScanOrigin, error: String? = nil, uploadAttempts: Int = 0,
        nextAttemptAt: Timestamp? = nil
    ) {
        self.scanID = scanID
        self.fileName = fileName
        self.origin = origin
        self.error = error
        self.uploadAttempts = uploadAttempts
        self.nextAttemptAt = nextAttemptAt
    }
}

extension ScanRecord {
    /// The IDs of every scan live here: not deleted, on a tune that is here and not deleted. A
    /// tune tombstone pulled from another device never reaches a scan the server refused, so the
    /// tune decides as much as the scan. Selects `s.id`, so a caller can add `AND s.…` terms.
    public static let liveIDsSQL = """
        SELECT s.id FROM scans s
        JOIN tunes t ON t.id = s.tune_id
        WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL
        """
}

extension CrosstuneStore {
    /// How many scans exist only on this device: captured here, still live, and not yet on the
    /// server. A scan that is deleted, or whose tune is, never counts, since its file goes with it.
    public func notUploadedScanCount() async throws -> Int {
        try await read { db in try ScanFile.notUploadedCount(db) }
    }

    /// Keeps a scan file in device backups while it is the only copy, and out of them once the
    /// server holds it, where a backup would only duplicate it. Call when the file is written
    /// and again when its origin changes.
    public func applyBackupRule(toScanFile name: String, origin: ScanOrigin) throws {
        try Self.setExcludedFromBackup(scansFolder.appending(path: name), origin == .downloaded)
    }
}

extension ScanFile {
    static func notUploadedCount(_ db: Database) throws -> Int {
        try Int.fetchOne(
            db,
            sql: """
                SELECT COUNT(*) FROM scan_files f
                JOIN scans s ON s.id = f.scan_id
                WHERE f.origin = ? AND s.state = ? AND s.id IN (\(ScanRecord.liveIDsSQL))
                """,
            arguments: [ScanOrigin.captured.rawValue, ScanRecord.pendingUpload]) ?? 0
    }
}
