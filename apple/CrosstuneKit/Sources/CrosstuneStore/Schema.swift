import GRDB

/// The store's tables, built by migrations recorded in GRDB's `grdb_migrations` table.
///
/// A merged migration never changes: a store that applied it never runs it again, so an edit
/// reaches only new installs and leaves every other store in the old shape. Its identifier never
/// changes either: a store holding an identifier this build does not register reads as written
/// by a newer build, and ``CrosstuneStore`` deletes it.
///
/// A schema change appends a migration that keeps every row, every queued change, and every
/// recording the server does not have yet with its audio. It rewrites queued changes' `data`
/// into the new shape, and calls ``repull(_:)`` when a new column holds values only the server
/// knows.
enum Schema {
    static let migrator: DatabaseMigrator = {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v4") { db in
            try createMeta(db)
            try createSyncTables(db)
            try createOutbox(db)
            try createRecordingFiles(db)
        }
        migrator.registerMigration("v5") { db in
            try createSyncTable(db, .recordingLoops) { t in
                t.column("recording_id", .text).notNull().indexed()
                t.column("label", .text)
                t.column("start_ms", .integer).notNull()
                t.column("end_ms", .integer).notNull()
                t.column("color", .integer).notNull()
            }
        }
        return migrator
    }()

    /// Makes the next pull fetch every row again. Queued changes stay and win over pulled rows
    /// that are older, as they always do.
    static func repull(_ db: Database) throws {
        try db.execute(sql: "DELETE FROM meta WHERE key = ?", arguments: [MetaKey.pullCursor.rawValue])
    }

    private static func createMeta(_ db: Database) throws {
        try db.create(table: "meta") { t in
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
            t.column("source_duration_ms", .integer)
            t.column("playback_start_ms", .integer)
            t.column("playback_end_ms", .integer)
            t.column("playback_rev", .text)
            t.column("peaks_rev", .text)
            t.column("trim_start_ms", .integer).notNull().defaults(to: 0)
            t.column("trim_end_ms", .integer)
            t.column("speed_percent", .integer).notNull().defaults(to: 100)
            t.column("pitch_cents", .integer).notNull().defaults(to: 0)
        }
        try createSyncTable(db, .userSettings) { t in
            t.column("audio_quality", .text).notNull()
            t.column("instruments", .jsonText).notNull()
        }
    }

    /// The on-device state of each recording's audio file, keyed by the recording's own ID.
    /// Not synced: the server never sees where a device keeps or how it names a file.
    private static func createRecordingFiles(_ db: Database) throws {
        try db.create(table: "recording_files") { t in
            t.primaryKey("id", .text)
            t.column("local_state", .text).notNull().indexed()
            t.column("file_name", .text)
            t.column("content_type", .text)
            t.column("bytes", .integer)
            t.column("local_duration_ms", .integer)
            t.column("blob_rev", .text)
            t.column("blob_start_ms", .integer).notNull().defaults(to: 0)
            t.column("peaks_file_name", .text)
            t.column("peaks_rev", .text)
            t.column("error", .text)
            t.column("tune_id", .text)
            t.column("recorded_at", .text)
            t.column("upload_attempts", .integer).notNull().defaults(to: 0)
            t.column("next_attempt_at", .text)
            t.column("updated_at", .text).notNull()
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
