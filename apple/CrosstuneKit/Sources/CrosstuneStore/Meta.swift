import Foundation
import GRDB

/// The store's own settings and sync bookkeeping, with the web client's keys.
public enum MetaKey: String, Sendable {
    /// The `server_seq` the next pull starts after.
    case pullCursor = "pull_cursor"
    /// The `server_seq` the next events pull starts after.
    case eventsCursor = "events_cursor"
    /// How many pushed changes the server refused.
    case invalidChanges = "invalid_changes"
    /// The account's storage figures from the API.
    case storage
    /// Whether this device downloads every ready recording to play without a connection.
    case keepOffline = "keep_offline"
    /// The catalog screen's status, key, mode, genre, tuning, and archived filters.
    case catalogFilters = "catalog_filters"
    /// Whether list screens show archived tunes.
    case listShowArchived = "list_show_archived"
    /// Which recordings the Recordings screen lists: `all`, `own`, or an import source.
    case recordingsOrigin = "recordings_origin"
    /// When the last sync run finished.
    case lastSyncedAt = "last_synced_at"
    /// The recordings whose upsert the server refused as Premium only. Their changes stay queued
    /// and wait out a free plan, so they reach the server once the account subscribes.
    case premiumHolds = "premium_holds"
    /// The one-time notices dismissed on this device that the pulled entitlements row does not
    /// carry yet. Each is posted after push, and dropped once a pull brings the row that has it.
    case seenNotices = "seen_notices"
    /// The seen notices whose post the server refused for good. They stay seen here and are
    /// never posted again.
    case refusedNotices = "refused_notices"
    /// The scans queued again after a refusal for their tune, and the grant they were queued
    /// under. Each is queued again at most once per grant, so a server that still refuses never
    /// sees it every sync.
    case scanRequeues = "scan_requeues"
    /// The value stored under this key, read inside a transaction or a `LiveQuery` fetch.
    public func value<Value: Decodable>(in db: Database, as _: Value.Type = Value.self) throws -> Value? {
        try Meta.value(db, self)
    }
}

enum Meta {
    static func value<Value: Decodable>(_ db: Database, _ key: MetaKey, as _: Value.Type = Value.self) throws
        -> Value?
    {
        guard let text = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = ?", arguments: [key.rawValue])
        else { return nil }
        return try JSONDecoder().decode(Value.self, from: Data(text.utf8))
    }

    static func set(_ db: Database, _ key: MetaKey, to value: some Encodable) throws {
        let text = String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        // An unchanged value updates no row, so observers of the meta table see no change.
        try db.execute(
            sql: """
                INSERT INTO meta (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value IS NOT excluded.value
                """,
            arguments: [key.rawValue, text])
    }
}

extension StoreWriter {
    /// The recordings held for Premium, read inside a transaction or a `LiveQuery` fetch. A hold
    /// counts only while its recording's upsert is still queued. A delete, or a parent's delete
    /// that drops the entry, leaves nothing waiting on the plan, and may bring no result to
    /// release the hold.
    public static func premiumHolds(in db: Database) throws -> Set<String> {
        let held = try storedHolds(in: db)
        guard !held.isEmpty else { return [] }
        typealias Column = OutboxEntry.CodingKeys
        let queued = try String.fetchAll(
            db,
            OutboxEntry.select(Column.rowID).filter(
                Column.tableName == SyncTable.recordings.rawValue
                    && Column.op == OutboxEntry.Operation.upsert.rawValue && held.contains(Column.rowID)))
        return Set(queued)
    }

    public func holdForPremium(_ ids: some Sequence<String>) throws {
        let held = try Self.storedHolds(in: db)
        let next = held.union(ids)
        if next != held { try setPremiumHolds(next) }
    }

    public func releasePremiumHolds(_ ids: some Sequence<String>) throws {
        let held = try Self.storedHolds(in: db)
        let next = held.subtracting(ids)
        if next != held { try setPremiumHolds(next) }
    }

    private static func storedHolds(in db: Database) throws -> Set<String> {
        Set(try Meta.value(db, .premiumHolds, as: [String].self) ?? [])
    }

    private func setPremiumHolds(_ ids: Set<String>) throws {
        try Meta.set(db, .premiumHolds, to: ids.sorted())
    }
}

extension StoreWriter {
    /// The notices dismissed on this device and not yet carried by the stored row, read inside a
    /// transaction or a `LiveQuery` fetch.
    public static func seenNotices(in db: Database) throws -> Set<PlanNotice> {
        Set((try Meta.value(db, .seenNotices, as: [String].self) ?? []).compactMap(PlanNotice.init(rawValue:)))
    }

    /// Records a notice as seen at once, so it never shows twice on this device, whether or not
    /// the server has heard yet.
    public func markNoticeSeen(_ notice: PlanNotice) throws {
        let seen = try Self.seenNotices(in: db)
        if !seen.contains(notice) { try setSeenNotices(seen.union([notice])) }
    }

    /// Drops the seen notices the stored row now carries, and returns those it does not, which
    /// the server has still to hear, less any it refused for good.
    public func unpostedNotices() throws -> Set<PlanNotice> {
        let seen = try Self.seenNotices(in: db)
        let refused = try refusedNotices()
        guard let row = try Entitlement.current(db) else { return seen.subtracting(refused) }
        let unposted = seen.filter { !row.hasSeen($0) }
        if unposted != seen { try setSeenNotices(unposted) }
        let stillRefused = refused.intersection(unposted)
        if stillRefused != refused { try setRefusedNotices(stillRefused) }
        return unposted.subtracting(stillRefused)
    }

    /// Stops posting a notice the server refused for good, while it stays seen on this device.
    public func markNoticeRefused(_ notice: PlanNotice) throws {
        let refused = try refusedNotices()
        if !refused.contains(notice) { try setRefusedNotices(refused.union([notice])) }
    }

    private func refusedNotices() throws -> Set<PlanNotice> {
        Set((try Meta.value(db, .refusedNotices, as: [String].self) ?? []).compactMap(PlanNotice.init(rawValue:)))
    }

    private func setRefusedNotices(_ notices: Set<PlanNotice>) throws {
        try Meta.set(db, .refusedNotices, to: notices.map(\.rawValue).sorted())
    }

    private func setSeenNotices(_ notices: Set<PlanNotice>) throws {
        try Meta.set(db, .seenNotices, to: notices.map(\.rawValue).sorted())
    }
}

extension CrosstuneStore {
    /// The notices dismissed on this device that the stored row does not carry yet.
    public func seenNotices() async throws -> Set<PlanNotice> {
        try await read { db in try StoreWriter.seenNotices(in: db) }
    }
}
