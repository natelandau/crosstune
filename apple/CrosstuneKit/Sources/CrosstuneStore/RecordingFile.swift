import Foundation
import GRDB

/// Where a recording's audio file stands on this device, mirroring the web's `recording_files`.
public enum LocalFileState: String, Codable, Hashable, Sendable, CaseIterable, DatabaseValueConvertible {
    case capturing
    case captured
    case uploading
    case uploaded
    case blockedQuota = "blocked_quota"
    case failedUpload = "failed_upload"
    case downloading
    case downloaded

    /// States whose blob the server does not have yet, so this device holds the only copy.
    public static let notUploaded: Set<LocalFileState> = [
        .capturing, .captured, .uploading, .blockedQuota, .failedUpload,
    ]

    public var isNotUploaded: Bool { Self.notUploaded.contains(self) }
}

/// A recording's local audio file: never synced, since the server never sees where a device
/// keeps or how it names a file.
public struct RecordingFile: Codable, Hashable, Sendable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "recording_files"

    /// The recording this file belongs to.
    public var id: String
    public var localState: LocalFileState
    /// Relative to the user's `audio/` folder, nil until the file exists.
    public var fileName: String?
    public var contentType: String?
    public var bytes: Int64?
    /// The file's own length, known before the server reports the recording's.
    public var localDurationMs: Int64?
    public var error: String?
    /// The tune a capture was started for, so a recovered capture is filed under it.
    public var tuneID: String?
    /// When a capture started, so a recovered capture keeps its real start.
    public var recordedAt: Timestamp?
    /// Consecutive transient upload failures since the last success, driving the backoff.
    public var uploadAttempts: Int
    /// Before this, the upload pass skips the file, set by a transient failure's backoff.
    public var nextAttemptAt: Timestamp?
    public var updatedAt: Timestamp

    public enum CodingKeys: String, CodingKey, ColumnExpression {
        case id
        case localState = "local_state"
        case fileName = "file_name"
        case contentType = "content_type"
        case bytes
        case localDurationMs = "local_duration_ms"
        case error
        case tuneID = "tune_id"
        case recordedAt = "recorded_at"
        case uploadAttempts = "upload_attempts"
        case nextAttemptAt = "next_attempt_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: String, localState: LocalFileState, fileName: String? = nil, contentType: String? = nil,
        bytes: Int64? = nil, localDurationMs: Int64? = nil, error: String? = nil, tuneID: String? = nil,
        recordedAt: Timestamp? = nil, uploadAttempts: Int = 0, nextAttemptAt: Timestamp? = nil,
        updatedAt: Timestamp = .now
    ) {
        self.id = id
        self.localState = localState
        self.fileName = fileName
        self.contentType = contentType
        self.bytes = bytes
        self.localDurationMs = localDurationMs
        self.error = error
        self.tuneID = tuneID
        self.recordedAt = recordedAt
        self.uploadAttempts = uploadAttempts
        self.nextAttemptAt = nextAttemptAt
        self.updatedAt = updatedAt
    }
}

extension RecordingFile {
    /// How many bytes of audio this device holds, read inside a transaction or a `LiveQuery`
    /// fetch.
    public static func localAudioBytes(_ db: Database) throws -> Int64 {
        try Int64.fetchOne(
            db, sql: "SELECT COALESCE(SUM(bytes), 0) FROM recording_files WHERE file_name IS NOT NULL") ?? 0
    }
}

extension CrosstuneStore {
    /// How many recordings exist only on this device, their audio not yet on the server.
    public func notUploadedRecordingCount() async throws -> Int {
        try await read { db in
            try RecordingFile.filter(LocalFileState.notUploaded.contains(RecordingFile.CodingKeys.localState))
                .fetchCount(db)
        }
    }
}
