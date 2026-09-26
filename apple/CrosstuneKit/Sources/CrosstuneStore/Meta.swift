import Foundation
import GRDB

/// The store's own settings and sync bookkeeping, with the web client's keys.
public enum MetaKey: String, Sendable {
    /// The `server_seq` the next pull starts after.
    case pullCursor = "pull_cursor"
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
    /// When the last sync run finished.
    case lastSyncedAt = "last_synced_at"

    /// The value stored under this key, read inside a transaction or a `LiveQuery` fetch.
    public func value<Value: Decodable>(in db: Database, as type: Value.Type = Value.self) throws -> Value? {
        try Meta.value(db, self)
    }
}

enum Meta {
    static func value<Value: Decodable>(_ db: Database, _ key: MetaKey) throws -> Value? {
        guard let text = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = ?", arguments: [key.rawValue])
        else { return nil }
        return try JSONDecoder().decode(Value.self, from: Data(text.utf8))
    }

    static func set(_ db: Database, _ key: MetaKey, to value: some Encodable) throws {
        let text = String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        try db.execute(
            sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            arguments: [key.rawValue, text])
    }
}
