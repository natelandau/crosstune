import Foundation
import GRDB

/// A change waiting to be pushed. A row has at most one: the newest write carries the whole
/// row and keeps the place of the first.
public struct OutboxEntry: Codable, Hashable, Sendable, FetchableRecord, PersistableRecord {
    public enum Operation: String, Codable, Sendable {
        case upsert
        case delete
    }

    public static let databaseTableName = "outbox"

    public var seq: Int64?
    public var tableName: SyncTable
    public var rowID: String
    public var op: Operation
    public var updatedAt: Timestamp
    /// The row's change data for an upsert; nil for a delete.
    public var data: JSONObject?

    public enum CodingKeys: String, CodingKey, ColumnExpression {
        case seq
        case tableName = "table_name"
        case rowID = "row_id"
        case op
        case updatedAt = "updated_at"
        case data
    }

    public static func databaseJSONEncoder(for column: String) -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return encoder
    }
}

enum Outbox {
    /// Queues a change, replacing the row's pending entry in place so it keeps its `seq`.
    static func enqueue(
        _ db: Database, table: SyncTable, rowID: String, op: OutboxEntry.Operation,
        updatedAt: Timestamp, data: JSONObject?
    ) throws {
        let entry = OutboxEntry(tableName: table, rowID: rowID, op: op, updatedAt: updatedAt, data: data)
        try entry.upsert(db)
    }

    static func drop(_ db: Database, table: SyncTable, rowID: String) throws {
        try OutboxEntry
            .filter(OutboxEntry.CodingKeys.tableName == table.rawValue && OutboxEntry.CodingKeys.rowID == rowID)
            .deleteAll(db)
    }
}
