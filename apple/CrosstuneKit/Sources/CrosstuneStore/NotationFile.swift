import Foundation
import GRDB

/// How a page's file came to be on this device.
public enum NotationOrigin: String, Codable, Hashable, Sendable, CaseIterable, DatabaseValueConvertible {
    /// Added here and waiting for upload: until the server has it, this is the only copy.
    case captured
    /// A cache of what the server holds.
    case downloaded
}

/// A notation page's image file on this device: never synced, since the server never sees where
/// a device keeps or how it names a file. A row exists only once its file does.
public struct NotationFile: Codable, Hashable, Sendable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "notation_files"

    /// The `error` a captured file carries while the server refuses it for quota. A code, not
    /// copy: the UI maps it to its label.
    public static let storageFullError = "storage_full"
    /// The `error` a captured file carries once the server has refused its page row, so it can
    /// not be given a slot. Deleting the page clears it, and so does an upload that lands once a
    /// later push has stored the row.
    public static let refusedError = "refused"

    public var pageID: String
    /// Relative to the user's `notation/` folder.
    public var fileName: String
    public var origin: NotationOrigin
    public var error: String?
    /// Consecutive transient upload failures since the last success, driving the backoff.
    public var uploadAttempts: Int
    /// Before this, the upload pass skips the file, set by a transient failure's backoff.
    public var nextAttemptAt: Timestamp?

    public enum CodingKeys: String, CodingKey, ColumnExpression {
        case pageID = "page_id"
        case fileName = "file_name"
        case origin
        case error
        case uploadAttempts = "upload_attempts"
        case nextAttemptAt = "next_attempt_at"
    }

    public init(
        pageID: String, fileName: String, origin: NotationOrigin, error: String? = nil, uploadAttempts: Int = 0,
        nextAttemptAt: Timestamp? = nil
    ) {
        self.pageID = pageID
        self.fileName = fileName
        self.origin = origin
        self.error = error
        self.uploadAttempts = uploadAttempts
        self.nextAttemptAt = nextAttemptAt
    }
}

extension NotationPageRecord {
    /// The IDs of every page live here: not deleted, on a tune that is here and not deleted. A
    /// tune tombstone pulled from another device never reaches a page the server refused, so the
    /// tune decides as much as the page. Selects `p.id`, so a caller can add `AND p.…` terms.
    public static let liveIDsSQL = """
        SELECT p.id FROM notation_pages p
        JOIN tunes t ON t.id = p.tune_id
        WHERE p.deleted_at IS NULL AND t.deleted_at IS NULL
        """
}

extension CrosstuneStore {
    /// How many pages exist only on this device: captured here, still live, and not yet on the
    /// server. A page that is deleted, or whose tune is, never counts, since its file goes with it.
    public func notUploadedNotationCount() async throws -> Int {
        try await read { db in
            try Int.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) FROM notation_files f
                    JOIN notation_pages p ON p.id = f.page_id
                    WHERE f.origin = ? AND p.state = ? AND p.id IN (\(NotationPageRecord.liveIDsSQL))
                    """,
                arguments: [NotationOrigin.captured.rawValue, NotationPageRecord.pendingUpload]) ?? 0
        }
    }

    /// Keeps a page file in device backups while it is the only copy, and out of them once the
    /// server holds it, where a backup would only duplicate it. Call when the file is written
    /// and again when its origin changes.
    public func applyBackupRule(toNotationFile name: String, origin: NotationOrigin) throws {
        try Self.setExcludedFromBackup(notationFolder.appending(path: name), origin == .downloaded)
    }
}
