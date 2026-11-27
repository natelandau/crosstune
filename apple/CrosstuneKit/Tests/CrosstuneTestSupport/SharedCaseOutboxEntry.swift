import GRDB
import Testing

@testable import CrosstuneStore

/// A queued change as the fixtures/outbox and sync cases state it, in wire field names.
public struct SharedCaseOutboxEntry: Codable, Hashable, Sendable {
    public let table: String
    public let rowID: String
    public let op: String
    public let updatedAt: String
    public let data: JSONObject?

    enum CodingKeys: String, CodingKey {
        case table
        case rowID = "row_id"
        case op
        case updatedAt = "updated_at"
        case data
    }

    public init(_ entry: OutboxEntry) {
        table = entry.tableName.rawValue
        rowID = entry.rowID
        op = entry.op.rawValue
        updatedAt = entry.updatedAt.iso
        data = entry.data
    }

    /// Queues each entry in order through the client's own enqueue, as a case's starting outbox.
    public static func enqueue(_ entries: [SharedCaseOutboxEntry], in db: Database) throws {
        for entry in entries {
            let table = try #require(SyncTable(rawValue: entry.table), "table \(entry.table)")
            let op = try #require(OutboxEntry.Operation(rawValue: entry.op), "op \(entry.op)")
            let updatedAt = try #require(Timestamp(iso: entry.updatedAt), "updated_at \(entry.updatedAt)")
            try Outbox.enqueue(db, table: table, rowID: entry.rowID, op: op, updatedAt: updatedAt, data: entry.data)
        }
    }

    /// The outbox in queue order, to compare with a case's expected outbox.
    public static func queued(in db: Database) throws -> [SharedCaseOutboxEntry] {
        try OutboxEntry.order(OutboxEntry.CodingKeys.seq).fetchAll(db).map(SharedCaseOutboxEntry.init)
    }
}
