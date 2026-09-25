import GRDB

/// The store's tables, versioned by SQLite's `user_version`.
///
/// A store from an older build starts over: the synced tables and the outbox are rebuilt
/// empty and the pull cursor reset, so the next sync pulls every row in this version's shape.
/// Unsent edits are lost. Every other `meta` entry is a local preference and stays. Once the
/// app has users, a schema change needs a migration that keeps the outbox instead.
enum Schema {
    static let version = 1

    static func storedVersion(_ db: Database) throws -> Int {
        try Int.fetchOne(db, sql: "PRAGMA user_version") ?? 0
    }

    /// Brings a store at an older version, or a new empty file, to `version`.
    static func prepare(_ db: Database, version: Int = version) throws {
        let stored = try storedVersion(db)
        guard stored < version else { return }
        if stored > 0 {
            for table in SyncTable.allCases {
                try db.execute(sql: "DROP TABLE IF EXISTS \(table.rawValue)")
            }
            try db.execute(sql: "DROP TABLE IF EXISTS outbox")
            try db.execute(sql: "DELETE FROM meta WHERE key = ?", arguments: [MetaKey.pullCursor.rawValue])
        }
        try createMeta(db)
        try createSyncTables(db)
        try createOutbox(db)
        try db.execute(sql: "PRAGMA user_version = \(version)")
    }

    private static func createMeta(_ db: Database) throws {
        try db.create(table: "meta", options: .ifNotExists) { t in
            t.primaryKey("key", .text)
            t.column("value", .jsonText).notNull()
        }
    }

    private static func createOutbox(_ db: Database) throws {
        try db.create(table: "outbox") { t in
            t.autoIncrementedPrimaryKey("seq")
            t.column("table_name", .text).notNull()
            t.column("row_id", .text).notNull()
            t.column("op", .text).notNull()
            t.column("updated_at", .text).notNull()
            t.column("data", .jsonText)
            t.uniqueKey(["table_name", "row_id"])
        }
    }

    /// Each synced table's own columns follow the bookkeeping every row shares. Indexes exist
    /// only where a query filters.
    private static func createSyncTables(_ db: Database) throws {
        try createSyncTable(db, .tunes) { t in
            t.column("title", .text).notNull().indexed()
            t.column("alternate_titles", .jsonText).notNull()
            t.column("composer", .text)
            t.column("genre", .text)
            t.column("tune_type", .text)
            t.column("key", .text)
            t.column("modes", .jsonText).notNull()
            t.column("time_signature", .text)
            t.column("part_structure", .text)
            t.column("is_crooked", .boolean).notNull()
            t.column("lyrics", .text)
            t.column("tunings", .jsonText).notNull()
        }
        try createSyncTable(db, .userTunes) { t in
            t.column("tune_id", .text).notNull().indexed()
            t.column("status", .text).notNull()
            t.column("learned_from", .text)
            t.column("learned_on", .text)
            t.column("notes", .text)
            t.column("archived_at", .text)
        }
        try createSyncTable(db, .lists) { t in
            t.column("name", .text).notNull()
            t.column("position", .integer).notNull()
        }
        try createSyncTable(db, .listItems) { t in
            t.column("list_id", .text).notNull().indexed()
            t.column("user_tune_id", .text).notNull().indexed()
            t.column("position", .integer).notNull()
        }
        try createSyncTable(db, .recordingLinks) { t in
            t.column("tune_id", .text).notNull().indexed()
            t.column("url", .text).notNull()
            t.column("provider", .text).notNull()
            t.column("provider_ref", .text)
            t.column("title", .text)
            t.column("label", .text)
            t.column("artwork_url", .text)
            t.column("position", .integer).notNull()
        }
        try createSyncTable(db, .recordings) { t in
            t.column("tune_id", .text).indexed()
            t.column("source", .text).notNull()
            t.column("recorded_at", .text).notNull()
            t.column("label", .text)
            t.column("position", .integer).notNull()
            t.column("state", .text).notNull()
            t.column("duration_ms", .integer)
            t.column("playback_mime", .text)
            t.column("playback_bytes", .integer)
            t.column("error", .text)
        }
        try createSyncTable(db, .userSettings) { t in
            t.column("audio_quality", .text).notNull()
            t.column("instruments", .jsonText).notNull()
        }
    }

    private static func createSyncTable(
        _ db: Database, _ table: SyncTable, columns: (TableDefinition) -> Void
    ) throws {
        try db.create(table: table.rawValue) { t in
            t.primaryKey("id", .text)
            t.column("created_at", .text).notNull()
            t.column("updated_at", .text).notNull()
            t.column("deleted_at", .text)
            t.column("server_seq", .integer).notNull()
            columns(t)
            t.column("extra", .jsonText).notNull()
        }
    }
}
