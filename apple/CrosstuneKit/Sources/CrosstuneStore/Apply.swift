import Foundation
import GRDB

/// The server's answer to one pushed change.
public struct PushResult: Sendable {
    public enum Status: String, Sendable {
        case applied
        case stale
        case invalid
    }

    public var table: SyncTable
    public var id: String
    public var status: Status
    public var reason: String?
    public var row: JSONObject?

    public init(table: SyncTable, id: String, status: Status, reason: String? = nil, row: JSONObject? = nil) {
        self.table = table
        self.id = id
        self.status = status
        self.reason = reason
        self.row = row
    }
}

/// The reason a push result gives for a recording or scan a free account may not add. The
/// change stays queued, held until the plan is Premium again.
public let premiumRequiredReason = "premium required"
/// The reason a push result gives for a row whose recording the server does not have, as for
/// a loop on a take held for Premium.
public let missingRecordingReason = "recording_id does not reference one of your recordings"

/// A push the server refused, so the local edit will never reach it.
public struct InvalidChange: Hashable, Sendable {
    public var table: SyncTable
    public var id: String
    public var reason: String?
}

extension StoreWriter {
    private struct RowKey: Hashable {
        var table: SyncTable
        var id: String
    }

    /// What an apply needs of a queued change, without decoding its row data.
    private struct PendingEntry: Decodable, FetchableRecord {
        var seq: Int64?
        var tableName: SyncTable
        var rowID: String
        var updatedAt: Timestamp

        enum CodingKeys: String, CodingKey {
            case seq
            case tableName = "table_name"
            case rowID = "row_id"
            case updatedAt = "updated_at"
        }
    }

    /// The whole outbox keyed by row. Read once per apply, inside the transaction it acts in.
    private func pendingByRow() throws -> [RowKey: PendingEntry] {
        let entries = try PendingEntry.fetchAll(db, sql: "SELECT seq, table_name, row_id, updated_at FROM outbox")
        return Dictionary(uniqueKeysWithValues: entries.map { (RowKey(table: $0.tableName, id: $0.rowID), $0) })
    }

    /// Decodes a server row for `table`, without saving it: a caller decides first whether a
    /// local write outranks it, then calls the returned closure to store it. An event row's
    /// creation time stands in for `updated_at`, as it does on its queued insert.
    private func decodeWireRow(table: SyncTable, _ row: JSONObject) throws -> (
        id: String, updatedAt: Timestamp, save: () throws -> Void
    ) {
        func decoded<Record: SyncedRecord>(_: Record.Type) throws -> (
            id: String, updatedAt: Timestamp, save: () throws -> Void
        ) {
            let record = try Record(wire: row)
            return (record.id, record.updatedAt, { try record.upsert(db) })
        }
        func decodedEvent<Event: EventRecord>(_: Event.Type) throws -> (
            id: String, updatedAt: Timestamp, save: () throws -> Void
        ) {
            let event = try Event(wire: row)
            return (event.id, event.createdAt, { try event.upsert(db) })
        }
        switch table {
        case .tunes: return try decoded(Tune.self)
        case .userTunes: return try decoded(UserTune.self)
        case .lists: return try decoded(TuneList.self)
        case .listItems: return try decoded(ListItem.self)
        case .recordingLinks: return try decoded(RecordingLink.self)
        case .places: return try decoded(SavedPlace.self)
        case .recordings: return try decoded(Recording.self)
        case .scans: return try decoded(ScanRecord.self)
        case .recordingLoops: return try decoded(RecordingLoop.self)
        case .userSettings: return try decoded(UserSettings.self)
        case .entitlements: return try decoded(Entitlement.self)
        case .playEvents: return try decodedEvent(PlayEvent.self)
        case .practiceSessions: return try decodedEvent(PracticeSession.self)
        case .scanViews: return try decodedEvent(ScanView.self)
        }
    }

    /// Applies the server's answer to a batch of pushed changes: an invalid upsert is reported,
    /// an invalid event is deleted without a report, an applied or stale row overwrites the local
    /// one with the server's own (no re-enqueue, no re-stamping), and every entry that has not
    /// changed since it was sent leaves the outbox. A write queued after the batch left, or
    /// replaced meanwhile, keeps its entry for the next push.
    ///
    /// A recording or scan refused as Premium only is neither reported nor settled: its entry
    /// stays and its id is held until a later result for it settles. A row refused because its
    /// recording is held stays queued the same way, to go out with it. `held` names the
    /// recordings and scans this batch held.
    @discardableResult
    public func applyPushResults(sent: [OutboxEntry], results: [PushResult]) throws -> (
        invalid: [InvalidChange], settled: Int, held: [String]
    ) {
        // A duplicate result for one row keeps the last, as the web's Map construction does.
        let byKey = Dictionary(
            results.map { (RowKey(table: $0.table, id: $0.id), $0) }, uniquingKeysWith: { _, latest in latest })
        let pending = try pendingByRow()
        var invalid: [InvalidChange] = []
        var settledSeqs: [Int64] = []
        var settled = 0
        var held: [String] = []
        var released: [String] = []
        var orphans: [(entry: OutboxEntry, result: PushResult, recordingID: String)] = []

        func settle(_ entry: OutboxEntry, _ result: PushResult) throws {
            if result.status == .invalid {
                if entry.tableName.isEvent {
                    // A refused event is not stored for this user, so its local copy would only
                    // ever count on this device. No edit of the musician's was lost, so it is not
                    // reported.
                    try db.execute(
                        sql: "DELETE FROM \(entry.tableName.rawValue) WHERE id = ?", arguments: [entry.rowID])
                } else if entry.op != .delete {
                    // The server refuses a delete only for a row it never stored, which is what a
                    // row created and deleted between pushes looks like: nothing was lost either side.
                    invalid.append(InvalidChange(table: entry.tableName, id: entry.rowID, reason: result.reason))
                }
            } else if let row = result.row {
                try decodeWireRow(table: entry.tableName, row).save()
            }
            if let seq = entry.seq { settledSeqs.append(seq) }
            settled += 1
        }

        for entry in sent {
            let key = RowKey(table: entry.tableName, id: entry.rowID)
            guard let result = byKey[key] else { continue }
            let current = pending[key]
            let unchanged = current?.seq == entry.seq && current?.updatedAt == entry.updatedAt
            guard unchanged else { continue }

            if result.status == .invalid, SyncTable.premiumOnly.contains(entry.tableName), entry.op != .delete,
                result.reason == premiumRequiredReason
            {
                // The entry carries the row once the account subscribes. Not counted as
                // settled, since its entry stays in the outbox.
                held.append(entry.rowID)
                continue
            }
            if result.status == .invalid, entry.op != .delete, result.reason == missingRecordingReason,
                let recordingID = entry.recordingID
            {
                // Judged once the whole batch is read, since its recording's result may come later.
                orphans.append((entry, result, recordingID))
                continue
            }
            if SyncTable.premiumOnly.contains(entry.tableName) { released.append(entry.rowID) }
            try settle(entry, result)
        }

        let stillHeld = try Self.premiumHolds(in: db).union(held).subtracting(released)
        for orphan in orphans where !stillHeld.contains(orphan.recordingID) {
            try settle(orphan.entry, orphan.result)
        }

        try OutboxEntry.deleteAll(db, keys: settledSeqs)
        try releasePremiumHolds(released)
        try holdForPremium(held)
        if !invalid.isEmpty {
            let priorCount = try meta(.invalidChanges, as: Int.self) ?? 0
            try setMeta(.invalidChanges, to: priorCount + invalid.count)
        }
        return (invalid, settled, held)
    }

    /// Applies one page of pulled rows: a row with no newer local write pending overwrites the
    /// local one with the server's (no re-enqueue, no re-stamping), its pending entry, if any, is
    /// dropped since the pull carries what that write would have pushed, and the cursor advances
    /// to `nextSince` regardless.
    public func applyPullPage(rows: [(SyncTable, JSONObject)], nextSince: Int64) throws {
        var pending = try pendingByRow()
        var supersededSeqs: [Int64] = []
        var supersededHolds: [String] = []

        for (table, wire) in rows {
            let pulled = try decodeWireRow(table: table, wire)
            let key = RowKey(table: table, id: pulled.id)
            if let entry = pending[key], entry.updatedAt > pulled.updatedAt { continue }
            try pulled.save()
            if let seq = pending[key]?.seq {
                supersededSeqs.append(seq)
                if SyncTable.premiumOnly.contains(table) { supersededHolds.append(pulled.id) }
                pending.removeValue(forKey: key)
            }
        }

        try OutboxEntry.deleteAll(db, keys: supersededSeqs)
        try releasePremiumHolds(supersededHolds)
        try setMeta(.pullCursor, to: nextSince)
    }

    /// Applies one page of the history pull: each row overwrites any local copy, since the
    /// server's copy adds only its `server_seq`, and the cursor advances to `nextSince`. A row from a
    /// table this build does not know is skipped, so the cursor still moves past it.
    public func applyEventsPage(rows: [(table: String, row: JSONObject)], nextSince: Int64) throws {
        for (table, row) in rows {
            switch table {
            case SyncTable.playEvents.rawValue: try PlayEvent(wire: row).upsert(db)
            case SyncTable.practiceSessions.rawValue: try PracticeSession(wire: row).upsert(db)
            case SyncTable.scanViews.rawValue: try ScanView(wire: row).upsert(db)
            case StatusChange.databaseTableName: try StatusChange(wire: row).upsert(db)
            default: continue
            }
        }
        try setMeta(.eventsCursor, to: nextSince)
    }
}

extension OutboxEntry {
    /// The recording a queued row of a ``SyncTable/recordingDependents`` table names, if any.
    var recordingID: String? {
        guard SyncTable.recordingDependents.contains(tableName),
            case .string(let id) = data?[RecordingLoop.CodingKeys.recordingID.rawValue]
        else { return nil }
        return id
    }
}
