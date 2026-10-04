import Foundation
import GRDB

/// A history row this device records and pushes once: a play, a practice session, or a scan view.
///
/// Stored in the API's own row shape. Insert-only, so there is no `updated_at` or `deleted_at`,
/// and `server_seq` stays nil until the push result writes the stored row back. Vocabulary
/// fields are plain strings, as on ``SyncedRecord``.
public protocol EventRecord: Codable, Sendable, Identifiable, FetchableRecord, PersistableRecord
where ID == String {
    associatedtype CodingKeys: CodingKey, CaseIterable
    static var table: SyncTable { get }
    var id: String { get }
    var createdAt: Timestamp { get }
}

extension EventRecord {
    public static var databaseTableName: String { table.rawValue }

    public static func databaseJSONEncoder(for column: String) -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return encoder
    }

    /// Builds a record from a decoded server row object. Ownership and any field this build does
    /// not model are dropped: the row is never edited, so nothing needs sending back.
    public init(wire row: JSONObject) throws {
        self = try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(row))
    }

    /// What the pushed insert carries: every field, null included, but the ID and `server_seq`.
    public func changeData() throws -> JSONObject {
        let known = try JSONDecoder().decode(JSONObject.self, from: JSONEncoder().encode(self))
        var data: JSONObject = [:]
        for key in Self.CodingKeys.allCases.map(\.stringValue) where key != "id" && key != "server_seq" {
            data[key] = known[key] ?? .null
        }
        return data
    }
}

/// One listen to a recording or a link, kept once it passes the play threshold.
public struct PlayEvent: EventRecord, Hashable {
    public static let table = SyncTable.playEvents

    public var id: String
    public var serverSeq: Int64?
    public var createdAt: Timestamp
    /// Where the play started, as the API's `PlayContext` names it.
    public var context: String
    public var startedAt: Timestamp
    public var listenedMs: Int64
    public var recordingID: String?
    public var linkID: String?
    public var listID: String?
    public var tuneID: String?

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case serverSeq = "server_seq"
        case createdAt = "created_at"
        case context
        case startedAt = "started_at"
        case listenedMs = "listened_ms"
        case recordingID = "recording_id"
        case linkID = "link_id"
        case listID = "list_id"
        case tuneID = "tune_id"
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, serverSeq: Int64? = nil, context: String,
        startedAt: Timestamp, listenedMs: Int64, recordingID: String? = nil, linkID: String? = nil,
        listID: String? = nil, tuneID: String? = nil
    ) {
        self.id = id
        self.serverSeq = serverSeq
        self.createdAt = createdAt
        self.context = context
        self.startedAt = startedAt
        self.listenedMs = listenedMs
        self.recordingID = recordingID
        self.linkID = linkID
        self.listID = listID
        self.tuneID = tuneID
    }
}

/// One stretch of practice on a recording, with the speed and pitch it ran at.
public struct PracticeSession: EventRecord, Hashable {
    public static let table = SyncTable.practiceSessions

    public var id: String
    public var serverSeq: Int64?
    public var createdAt: Timestamp
    public var recordingID: String
    public var tuneID: String?
    public var startedAt: Timestamp
    public var durationMs: Int64
    public var speedPercent: Int
    public var pitchCents: Int
    public var loopIDs: [String]

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case serverSeq = "server_seq"
        case createdAt = "created_at"
        case recordingID = "recording_id"
        case tuneID = "tune_id"
        case startedAt = "started_at"
        case durationMs = "duration_ms"
        case speedPercent = "speed_percent"
        case pitchCents = "pitch_cents"
        case loopIDs = "loop_ids"
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, serverSeq: Int64? = nil, recordingID: String,
        tuneID: String? = nil, startedAt: Timestamp, durationMs: Int64, speedPercent: Int, pitchCents: Int,
        loopIDs: [String] = []
    ) {
        self.id = id
        self.serverSeq = serverSeq
        self.createdAt = createdAt
        self.recordingID = recordingID
        self.tuneID = tuneID
        self.startedAt = startedAt
        self.durationMs = durationMs
        self.speedPercent = speedPercent
        self.pitchCents = pitchCents
        self.loopIDs = loopIDs
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        serverSeq = try container.decodeIfPresent(Int64.self, forKey: .serverSeq)
        createdAt = try container.decode(Timestamp.self, forKey: .createdAt)
        recordingID = try container.decode(String.self, forKey: .recordingID)
        tuneID = try container.decodeIfPresent(String.self, forKey: .tuneID)
        startedAt = try container.decode(Timestamp.self, forKey: .startedAt)
        durationMs = try container.decode(Int64.self, forKey: .durationMs)
        speedPercent = try container.decode(Int.self, forKey: .speedPercent)
        pitchCents = try container.decode(Int.self, forKey: .pitchCents)
        // The contract declares an empty list as the default.
        loopIDs = try container.decodeIfPresent([String].self, forKey: .loopIDs) ?? []
    }
}

/// One look at a tune's scans, kept once it passes the scan view threshold.
public struct ScanView: EventRecord, Hashable {
    public static let table = SyncTable.scanViews

    public var id: String
    public var serverSeq: Int64?
    public var createdAt: Timestamp
    public var tuneID: String
    /// Where the viewer was opened, as the API's `ScanViewContext` names it.
    public var context: String
    public var listID: String?
    public var startedAt: Timestamp
    /// Time the viewer was open with the app in the foreground.
    public var viewedMs: Int64

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case serverSeq = "server_seq"
        case createdAt = "created_at"
        case tuneID = "tune_id"
        case context
        case listID = "list_id"
        case startedAt = "started_at"
        case viewedMs = "viewed_ms"
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, serverSeq: Int64? = nil, tuneID: String,
        context: String, listID: String? = nil, startedAt: Timestamp, viewedMs: Int64
    ) {
        self.id = id
        self.serverSeq = serverSeq
        self.createdAt = createdAt
        self.tuneID = tuneID
        self.context = context
        self.listID = listID
        self.startedAt = startedAt
        self.viewedMs = viewedMs
    }
}

/// A tune's status moving, as the server records it. Pulled only; no client writes one.
public struct StatusChange: Codable, Hashable, Sendable, Identifiable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "status_changes"

    public var id: String
    public var serverSeq: Int64
    public var userTuneID: String
    /// Nil for the status a tune was added with.
    public var fromStatus: String?
    public var toStatus: String
    public var changedAt: Timestamp

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case serverSeq = "server_seq"
        case userTuneID = "user_tune_id"
        case fromStatus = "from_status"
        case toStatus = "to_status"
        case changedAt = "changed_at"
    }

    public init(
        id: String = newID(), serverSeq: Int64, userTuneID: String, fromStatus: String?, toStatus: String,
        changedAt: Timestamp
    ) {
        self.id = id
        self.serverSeq = serverSeq
        self.userTuneID = userTuneID
        self.fromStatus = fromStatus
        self.toStatus = toStatus
        self.changedAt = changedAt
    }

    public init(wire row: JSONObject) throws {
        self = try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(row))
    }
}
