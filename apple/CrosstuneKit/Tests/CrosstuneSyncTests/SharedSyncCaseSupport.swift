import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

/// A local database as the fixtures/sync-pull, fixtures/sync-events, fixtures/sync-push-results,
/// and fixtures/sync-engine cases state it: rows by table, the outbox, both cursors, the
/// recordings and scans kept local until subscribed, and the fields no stored row of a table may
/// carry.
struct SyncCaseLocalState: Decodable, Sendable {
    let rows: [String: [JSONObject]]
    let outbox: [SharedCaseOutboxEntry]
    let pullCursor: Int64
    let eventsCursor: Int64
    let localOnly: [String]?
    let absentFields: [String: [String]]?

    enum CodingKeys: String, CodingKey {
        case rows, outbox
        case pullCursor = "pull_cursor"
        case eventsCursor = "events_cursor"
        case localOnly = "local_only"
        case absentFields = "absent_fields"
    }
}

struct SyncCasePage: Decodable, Sendable {
    struct Row: Codable, Sendable {
        let table: String
        let row: JSONObject
    }

    let rows: [Row]
    let nextSince: Int64

    enum CodingKeys: String, CodingKey {
        case rows
        case nextSince = "next_since"
    }

    /// The page as the API's response body, with `has_more` false, for the wire decoder to read.
    func responseBody() throws -> Data {
        struct Body: Encodable {
            let rows: [Row]
            let nextSince: Int64
            let hasMore = false

            enum CodingKeys: String, CodingKey {
                case rows
                case nextSince = "next_since"
                case hasMore = "has_more"
            }
        }
        return try JSONEncoder().encode(Body(rows: rows, nextSince: nextSince))
    }
}

struct SyncPageCaseInput: Decodable, Sendable {
    let local: SyncCaseLocalState
    let page: SyncCasePage
}

struct SyncPageCaseExpected: Decodable, Sendable {
    let local: SyncCaseLocalState
}

struct UnknownCaseTable: Error, CustomStringConvertible {
    let table: String
    var description: String { "a case names table \(table), which this reader has no record type for" }
}

/// Seeds a case's starting database and reads it back as wire rows, for the sync case readers.
enum SyncCaseDatabase {
    static func seed(_ local: SyncCaseLocalState, in writer: StoreWriter) throws {
        for (table, rows) in local.rows {
            for row in rows { try caseTable(table).insert(row, writer.db) }
        }
        try SharedCaseOutboxEntry.enqueue(local.outbox, in: writer.db)
        try writer.keepLocalUntilSubscribed(local.localOnly ?? [])
        try writer.setMeta(.pullCursor, to: local.pullCursor)
        try writer.setMeta(.eventsCursor, to: local.eventsCursor)
    }

    /// Checks the tables `expected` names hold exactly its rows, each on the fields the expected
    /// row carries with timestamps compared by instant, that no row carries a field listed in
    /// `absent_fields`, and that the outbox, the holds that count, and the cursors match.
    static func expectMatches(_ expected: SyncCaseLocalState, in writer: StoreWriter) throws {
        for (table, expectedRows) in expected.rows {
            let actualRows = try caseTable(table).rows(writer.db)
            let actualByID = Dictionary(uniqueKeysWithValues: actualRows.map { (id(of: $0), $0) })
            #expect(actualByID.keys.sorted() == expectedRows.map(id(of:)).sorted(), "\(table) ids")
            for expectedRow in expectedRows {
                guard let actualRow = actualByID[id(of: expectedRow)] else { continue }
                for (field, value) in expectedRow {
                    guard let actual = actualRow[field] else {
                        Issue.record(
                            "\(table) \(id(of: expectedRow)): field \(field) must be present, expected \(value)")
                        continue
                    }
                    #expect(
                        sameValue(actual, value),
                        "\(table) \(id(of: expectedRow)) \(field): got \(actual), expected \(value)")
                }
            }
        }
        for (table, fields) in expected.absentFields ?? [:] {
            for row in try caseTable(table).rows(writer.db) {
                for field in fields {
                    #expect(
                        row[field] == nil, "\(table) \(id(of: row)): field \(field) must be absent, got \(row[field]!)")
                }
            }
        }
        let queued = try SharedCaseOutboxEntry.queued(in: writer.db)
        #expect(queued.count == expected.outbox.count, "outbox length")
        for (index, (actual, wanted)) in zip(queued, expected.outbox).enumerated() {
            #expect(
                actual.table == wanted.table && actual.rowID == wanted.rowID && actual.op == wanted.op,
                "outbox entry \(index) table, row_id, op: got \(actual), expected \(wanted)")
            #expect(
                Timestamp(iso: actual.updatedAt) == Timestamp(iso: wanted.updatedAt),
                "outbox entry \(index) updated_at: got \(actual.updatedAt), expected \(wanted.updatedAt)")
            #expect(
                actual.data == wanted.data,
                "outbox entry \(index) data: got \(String(describing: actual.data)), expected \(String(describing: wanted.data))"
            )
        }
        if let localOnly = expected.localOnly {
            let actual = try StoreWriter.localOnlyRows(in: writer.db).sorted()
            #expect(actual == localOnly.sorted(), "local_only: got \(actual), expected \(localOnly.sorted())")
        }
        #expect((try writer.meta(.pullCursor, as: Int64.self) ?? 0) == expected.pullCursor, "pull cursor")
        #expect((try writer.meta(.eventsCursor, as: Int64.self) ?? 0) == expected.eventsCursor, "events cursor")
    }

    private static func id(of row: JSONObject) -> String {
        if case .string(let id) = row["id"] { return id }
        return ""
    }

    private static func sameValue(_ actual: JSONValue, _ expected: JSONValue) -> Bool {
        if case .string(let actualText) = actual, case .string(let expectedText) = expected,
            let actualTime = Timestamp(iso: actualText), let expectedTime = Timestamp(iso: expectedText)
        {
            return actualTime == expectedTime
        }
        return actual == expected
    }

    /// How one table's case rows go into the database and come back out as wire rows.
    private struct CaseTable: Sendable {
        let insert: @Sendable (JSONObject, Database) throws -> Void
        let rows: @Sendable (Database) throws -> [JSONObject]

        static func synced<Record: SyncedRecord>(_: Record.Type) -> (String, CaseTable) {
            (
                Record.table.rawValue,
                CaseTable(
                    insert: { try Record(wire: $0).insert($1) }, rows: { try SyncCaseDatabase.synced(Record.self, $0) })
            )
        }

        static func event<Event: EventRecord>(_: Event.Type) -> (String, CaseTable) {
            (
                Event.table.rawValue,
                CaseTable(
                    insert: { try Event(wire: $0).insert($1) }, rows: { try SyncCaseDatabase.event(Event.self, $0) })
            )
        }
    }

    private static let caseTables: [String: CaseTable] = Dictionary(
        uniqueKeysWithValues: [
            CaseTable.synced(Tune.self),
            CaseTable.synced(UserTune.self),
            CaseTable.synced(TuneList.self),
            CaseTable.synced(ListItem.self),
            CaseTable.synced(RecordingLink.self),
            CaseTable.synced(SavedPlace.self),
            CaseTable.synced(Recording.self),
            CaseTable.synced(ScanRecord.self),
            CaseTable.synced(RecordingLoop.self),
            CaseTable.synced(UserSettings.self),
            CaseTable.synced(Entitlement.self),
            CaseTable.event(PlayEvent.self),
            CaseTable.event(PracticeSession.self),
            CaseTable.event(ScanView.self),
            (
                StatusChange.databaseTableName,
                CaseTable(
                    insert: { try StatusChange(wire: $0).insert($1) },
                    rows: { db in
                        try StatusChange.fetchAll(db).map { try encoded($0, columns: StatusChange.CodingKeys.allCases) }
                    })
            ),
        ])

    private static func caseTable(_ table: String) throws -> CaseTable {
        guard let caseTable = caseTables[table] else { throw UnknownCaseTable(table: table) }
        return caseTable
    }

    /// A synced record's wire form: its modeled fields with the unmodeled ones from `extra`.
    private static func synced<Record: SyncedRecord>(_: Record.Type, _ db: Database) throws -> [JSONObject] {
        try Record.fetchAll(db).map { record in
            var object = try encoded(record, columns: Record.CodingKeys.allCases)
            object["extra"] = nil
            return object.merging(record.extra) { modeled, _ in modeled }
        }
    }

    private static func event<Event: EventRecord>(_: Event.Type, _ db: Database) throws -> [JSONObject] {
        try Event.fetchAll(db).map { try encoded($0, columns: Event.CodingKeys.allCases) }
    }

    /// The record's fields keyed by wire name. Every column is present, a nil one as null, since
    /// synthesized encoding leaves nil optionals out and a stored null must not read as missing.
    private static func encoded(_ record: some Encodable, columns: some Sequence<some CodingKey>) throws
        -> JSONObject
    {
        var object = try JSONDecoder().decode(JSONObject.self, from: JSONEncoder().encode(record))
        for column in columns where object[column.stringValue] == nil {
            object[column.stringValue] = .null
        }
        return object
    }
}
