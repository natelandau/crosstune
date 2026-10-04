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
        migrator.registerMigration("v6") { db in
            try db.alter(table: SyncTable.recordingLinks.rawValue) { t in t.drop(column: "label") }
            // The API refuses a queued link that still names a label.
            try db.execute(
                sql: "UPDATE outbox SET data = json_remove(data, '$.label') WHERE table_name = ? AND data IS NOT NULL",
                arguments: [SyncTable.recordingLinks.rawValue])
        }
        migrator.registerMigration("v7") { db in
            // The server holds the same default, so no repull is needed.
            let everyService =
                #"["apple_music","tidal","internet_archive","youtube","spotify","bandcamp","soundcloud"]"#
            let table = SyncTable.userSettings.rawValue
            try db.alter(table: table) { t in
                t.add(column: "search_providers", .jsonText).notNull().defaults(sql: "'\(everyService)'")
            }
            // A row pulled from a server that already had the field kept it in `extra`.
            try db.execute(
                sql: """
                    UPDATE user_settings
                    SET search_providers = json_extract(extra, '$.search_providers')
                    WHERE json_type(extra, '$.search_providers') = 'array'
                    """)
            try db.execute(sql: "UPDATE user_settings SET extra = json_remove(extra, '$.search_providers')")
            try db.execute(
                sql: """
                    UPDATE outbox
                    SET data = json_set(data, '$.search_providers', json(coalesce(
                        (SELECT search_providers FROM user_settings WHERE id = outbox.row_id), ?)))
                    WHERE table_name = ? AND data IS NOT NULL AND json_type(data, '$.search_providers') IS NULL
                    """,
                arguments: [everyService, table])
        }
        migrator.registerMigration("v8") { db in
            // The server holds the same default, so no repull is needed.
            try db.alter(table: SyncTable.userTunes.rawValue) { t in
                t.add(column: "play_recording_id", .text)
                t.add(column: "play_link_id", .text)
            }
            try db.alter(table: SyncTable.userSettings.rawValue) { t in
                t.add(column: "play_first", .text).notNull().defaults(sql: "'recordings'")
            }
            // A row pulled from a server that already had the fields kept them in `extra`.
            for column in ["play_recording_id", "play_link_id"] {
                try db.execute(
                    sql: """
                        UPDATE user_tunes
                        SET \(column) = json_extract(extra, '$.\(column)')
                        WHERE json_type(extra, '$.\(column)') = 'text'
                        """)
                try db.execute(sql: "UPDATE user_tunes SET extra = json_remove(extra, '$.\(column)')")
            }
            try db.execute(
                sql: """
                    UPDATE user_settings
                    SET play_first = json_extract(extra, '$.play_first')
                    WHERE json_type(extra, '$.play_first') = 'text'
                    """)
            try db.execute(sql: "UPDATE user_settings SET extra = json_remove(extra, '$.play_first')")
            for column in ["play_recording_id", "play_link_id"] {
                try db.execute(
                    sql: """
                        UPDATE outbox
                        SET data = json_set(data, '$.\(column)', (
                            SELECT \(column) FROM user_tunes WHERE id = outbox.row_id))
                        WHERE table_name = ? AND data IS NOT NULL AND json_type(data, '$.\(column)') IS NULL
                        """,
                    arguments: [SyncTable.userTunes.rawValue])
            }
            try db.execute(
                sql: """
                    UPDATE outbox
                    SET data = json_set(data, '$.play_first', coalesce(
                        (SELECT play_first FROM user_settings WHERE id = outbox.row_id), 'recordings'))
                    WHERE table_name = ? AND data IS NOT NULL AND json_type(data, '$.play_first') IS NULL
                    """,
                arguments: [SyncTable.userSettings.rawValue])
        }
        migrator.registerMigration("v9") { db in
            // The server holds the same default, so no repull is needed.
            let table = SyncTable.recordings.rawValue
            try db.alter(table: table) { t in
                t.add(column: "origin", .text).notNull().defaults(sql: "'own'")
                t.add(column: "origin_url", .text)
            }
            // A row pulled from a server that already had the fields kept them in `extra`.
            for column in ["origin", "origin_url"] {
                try db.execute(
                    sql: """
                        UPDATE recordings
                        SET \(column) = json_extract(extra, '$.\(column)')
                        WHERE json_type(extra, '$.\(column)') = 'text'
                        """)
                try db.execute(sql: "UPDATE recordings SET extra = json_remove(extra, '$.\(column)')")
            }
            // The API refuses an origin without its page, so the pair is always queued together.
            try db.execute(
                sql: """
                    UPDATE outbox
                    SET data = json_set(data,
                        '$.origin', coalesce((SELECT origin FROM recordings WHERE id = outbox.row_id), 'own'),
                        '$.origin_url', (SELECT origin_url FROM recordings WHERE id = outbox.row_id))
                    WHERE table_name = ? AND data IS NOT NULL AND json_type(data, '$.origin_url') IS NULL
                    """,
                arguments: [table])
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
