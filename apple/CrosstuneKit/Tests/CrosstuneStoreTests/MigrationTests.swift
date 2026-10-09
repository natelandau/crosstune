import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

/// A store left at `v4` with everything only this device holds: queued changes, a recording in
/// every state the server has not received, one it has, a capture still being written, and
/// their audio. Seeded with SQL against `v4`'s columns, never the record types, which follow
/// the current schema. A later migration that reshapes a seeded column changes the assertions'
/// SQL, never this seed.
private struct V4Fixture {
    let fileIDs: [String]
    let fileNames: [String]
    let outboxRowIDs: [String]
    let outboxSeqs: [Int64]

    init(root: TemporaryRoot, userID: String = "user_a") throws {
        let folder = try CrosstuneStore.folder(for: userID, in: root.url)
        let audio = folder.appending(path: "audio", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: audio, withIntermediateDirectories: true)
        let pool = try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
        try Schema.migrator.migrate(pool, upTo: "v4")

        let states = LocalFileState.notUploaded.map(\.rawValue).sorted() + [LocalFileState.downloaded.rawValue]
        var fileIDs: [String] = []
        var fileNames: [String] = []
        let time = "2026-09-25T12:00:00.000Z"
        try pool.write { db in
            for (index, state) in states.enumerated() {
                let id = newID()
                fileIDs.append(id)
                try db.execute(
                    sql: """
                        INSERT INTO recordings
                            (id, created_at, updated_at, server_seq, source, recorded_at, position, state, extra)
                        VALUES (?, ?, ?, 0, 'capture', ?, ?, 'pending_upload', '{}')
                        """,
                    arguments: [id, time, time, time, index])
                let capturing = state == LocalFileState.capturing.rawValue
                let fileName = capturing ? "\(id).\(CrosstuneStore.captureExtension)" : "\(id).m4a"
                let peaks: String? = capturing ? nil : "\(id).peaks"
                fileNames.append(fileName)
                if let peaks { fileNames.append(peaks) }
                try db.execute(
                    sql: """
                        INSERT INTO recording_files (id, local_state, file_name, peaks_file_name, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                    arguments: [id, state, fileName, peaks, time])
            }
            for (table, rowID) in [("tunes", newID()), ("recordings", fileIDs[0])] {
                try db.execute(
                    sql: """
                        INSERT INTO outbox (table_name, row_id, op, updated_at, data)
                        VALUES (?, ?, 'upsert', ?, '{}')
                        """,
                    arguments: [table, rowID, time])
            }
            try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('pull_cursor', '5'), ('keep_offline', 'true')")
        }
        (outboxRowIDs, outboxSeqs) = try pool.read { db in
            let rows = try Row.fetchAll(db, sql: "SELECT row_id, seq FROM outbox ORDER BY seq")
            return (rows.map { $0["row_id"] }, rows.map { $0["seq"] })
        }
        try pool.close()
        for name in fileNames {
            try Data([1]).write(to: audio.appending(path: name))
        }
        self.fileIDs = fileIDs
        self.fileNames = fileNames
    }
}

@Test func migratingFromV4KeepsDeviceOnlyData() async throws {
    let root = TemporaryRoot()
    let fixture = try V4Fixture(root: root)

    let store = try root.open()
    await store.deleteUnnamedFiles()

    let (files, recordings, outboxRowIDs, outboxSeqs) = try await store.read { db in
        (
            try String.fetchSet(db, sql: "SELECT id FROM recording_files"),
            try String.fetchSet(db, sql: "SELECT id FROM recordings"),
            try String.fetchAll(db, sql: "SELECT row_id FROM outbox ORDER BY seq"),
            try Int64.fetchAll(db, sql: "SELECT seq FROM outbox ORDER BY seq")
        )
    }
    #expect(files == Set(fixture.fileIDs))
    #expect(recordings == Set(fixture.fileIDs))
    #expect(try await store.read { db in try db.tableExists("recording_loops") })
    #expect(outboxRowIDs == fixture.outboxRowIDs)
    #expect(outboxSeqs == fixture.outboxSeqs)
    let left = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
    #expect(Set(left) == Set(fixture.fileNames))
    #expect(try await store.meta(.pullCursor, as: Int.self) == nil, "v10 pulls every row again")
    #expect(try await store.meta(.keepOffline, as: Bool.self) == true)
}

/// A merged migration never changes: a store that already applied it never runs it again, so
/// an edit reaches only new installs and leaves every other store in the old shape.
@Test func theV4SchemaNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v4")
    let schema = try queue.read { db in
        try Row.fetchAll(
            db,
            sql: """
                SELECT type, name, sql FROM sqlite_master
                WHERE name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations' AND sql IS NOT NULL
                ORDER BY name
                """
        )
        .map { row -> String in
            let type: String = row["type"]
            let name: String = row["name"]
            let sql: String = row["sql"]
            // One clause per line keeps the pinned text under the line limit.
            return "\(type) \(name): \(sql.replacingOccurrences(of: ", ", with: ",\n  "))"
        }
        .joined(separator: "\n")
    }
    #expect(schema == v4Schema)
}

/// Same promise as `v4`'s, for the migration that adds loops.
@Test func theV5MigrationNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v4")
    try Schema.migrator.migrate(queue, upTo: "v5")
    let schema = try queue.read { db in
        try Row.fetchAll(
            db,
            sql: """
                SELECT type, name, sql FROM sqlite_master
                WHERE tbl_name = 'recording_loops' AND sql IS NOT NULL
                ORDER BY name
                """
        )
        .map { row -> String in
            let type: String = row["type"]
            let name: String = row["name"]
            let sql: String = row["sql"]
            return "\(type) \(name): \(sql.replacingOccurrences(of: ", ", with: ",\n  "))"
        }
        .joined(separator: "\n")
    }
    #expect(schema == v5LoopsSchema)
}

@Test func theV6MigrationDropsTheLinkLabelAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v5")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        try db.execute(
            sql: """
                INSERT INTO recording_links
                    (id, created_at, updated_at, server_seq, tune_id, url, provider, title, label, position, extra)
                VALUES ('link-1', ?, ?, 0, 'tune-1', 'https://youtu.be/x', 'youtube', 'Jam', 'slow version', 0, '{}')
                """,
            arguments: [time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('recording_links', 'link-1', 'upsert', ?, '{"url":"https://youtu.be/x","label":"slow version"}'),
                    ('recording_links', 'link-2', 'delete', ?, NULL),
                    ('recordings', 'rec-1', 'upsert', ?, '{"label":"A part"}')
                """,
            arguments: [time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v6")

    try queue.read { db in
        #expect(try db.columns(in: "recording_links").map(\.name).contains("label") == false)
        #expect(try String.fetchOne(db, sql: "SELECT title FROM recording_links WHERE id = 'link-1'") == "Jam")
        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(data == [#"{"url":"https://youtu.be/x"}"#, nil, #"{"label":"A part"}"#])
    }
}

@Test func theV7MigrationAddsSearchProvidersAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v6")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        // `s-2` was pulled after the server added the field, so this build kept it in `extra`.
        try db.execute(
            sql: """
                INSERT INTO user_settings
                    (id, created_at, updated_at, server_seq, audio_quality, instruments, extra)
                VALUES
                    ('s-1', ?, ?, 0, 'high', '["violin"]', '{}'),
                    ('s-2', ?, ?, 3, 'standard', '[]', '{"search_providers":["tidal"],"theme":"dark"}')
                """,
            arguments: [time, time, time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('user_settings', 's-1', 'upsert', ?, '{"instruments":["violin"]}'),
                    ('user_settings', 's-2', 'upsert', ?, '{"search_providers":["tidal"],"theme":"dark"}'),
                    ('user_settings', 's-3', 'delete', ?, NULL),
                    ('user_settings', 's-4', 'upsert', ?, '{"instruments":[]}'),
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}')
                """,
            arguments: [time, time, time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v7")

    let everyService = #"["apple_music","tidal","internet_archive","youtube","spotify","bandcamp","soundcloud"]"#
    try queue.read { db in
        let rows = try Row.fetchAll(db, sql: "SELECT search_providers, extra FROM user_settings ORDER BY id")
        #expect(rows.map { $0["search_providers"] as String } == [everyService, #"["tidal"]"#])
        #expect(rows.map { $0["extra"] as String } == ["{}", #"{"theme":"dark"}"#])

        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(
            data == [
                #"{"instruments":["violin"],"search_providers":"# + everyService + "}",
                #"{"search_providers":["tidal"],"theme":"dark"}"#,
                nil,
                // No row to read, so the queued change takes the default.
                #"{"instruments":[],"search_providers":"# + everyService + "}",
                #"{"title":"Jam"}"#,
            ])
    }
}

/// Same promise as `v4`'s, for the migration that adds search providers.
@Test func theV7MigrationNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v6")
    try Schema.migrator.migrate(queue, upTo: "v7")
    let schema = try queue.read { db in
        try Row.fetchAll(
            db,
            sql: """
                SELECT name, sql FROM sqlite_master
                WHERE tbl_name = 'user_settings' AND type = 'table'
                """
        )
        .map { row -> String in
            let sql: String = row["sql"]
            return sql.replacingOccurrences(of: ", ", with: ",\n  ")
        }
        .joined(separator: "\n")
    }
    #expect(schema == v7UserSettingsSchema)
}

@Test func theV8MigrationAddsPlaySourcesAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v7")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        // Rows pulled after the server added the fields kept them in `extra`.
        try db.execute(
            sql: """
                INSERT INTO user_tunes
                    (id, created_at, updated_at, server_seq, tune_id, status, extra)
                VALUES
                    ('ut-1', ?, ?, 0, 't-1', 'learning', '{}'),
                    ('ut-2', ?, ?, 3, 't-1', 'learning', '{"play_link_id":"link-1","theme":"dark"}')
                """,
            arguments: [time, time, time, time])
        try db.execute(
            sql: """
                INSERT INTO user_settings
                    (id, created_at, updated_at, server_seq, audio_quality, instruments, extra)
                VALUES
                    ('s-1', ?, ?, 0, 'high', '[]', '{}'),
                    ('s-2', ?, ?, 3, 'standard', '[]', '{"play_first":"apple_music","theme":"dark"}')
                """,
            arguments: [time, time, time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('user_tunes', 'ut-1', 'upsert', ?, '{"status":"learning"}'),
                    ('user_tunes', 'ut-2', 'upsert', ?, '{"play_link_id":"link-1","status":"learning"}'),
                    ('user_tunes', 'ut-3', 'delete', ?, NULL),
                    ('user_settings', 's-1', 'upsert', ?, '{"instruments":[]}'),
                    ('user_settings', 's-2', 'upsert', ?, '{"play_first":"apple_music","theme":"dark"}'),
                    ('user_settings', 's-3', 'upsert', ?, '{"instruments":["violin"]}'),
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}')
                """,
            arguments: [time, time, time, time, time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v8")

    try queue.read { db in
        let tunes = try Row.fetchAll(
            db, sql: "SELECT play_recording_id, play_link_id, extra FROM user_tunes ORDER BY id")
        #expect(tunes.map { $0["play_recording_id"] as String? } == [nil, nil])
        #expect(tunes.map { $0["play_link_id"] as String? } == [nil, "link-1"])
        #expect(tunes.map { $0["extra"] as String } == ["{}", #"{"theme":"dark"}"#])
        let pinned = try #require(try UserTune.fetchOne(db, key: "ut-2"))
        #expect(pinned.playLinkID == "link-1")
        #expect(pinned.extra == ["theme": .string("dark")])

        // Read as rows, since the record follows the current schema and later migrations add
        // settings columns.
        let settings = try Row.fetchAll(
            db, sql: "SELECT play_first, audio_quality, extra FROM user_settings ORDER BY id")
        #expect(settings.map { $0["play_first"] as String } == ["recordings", "apple_music"])
        #expect(settings.map { $0["audio_quality"] as String } == ["high", "standard"])
        #expect(settings.map { $0["extra"] as String } == ["{}", #"{"theme":"dark"}"#])

        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(
            data == [
                #"{"status":"learning","play_recording_id":null,"play_link_id":null}"#,
                #"{"play_link_id":"link-1","status":"learning","play_recording_id":null}"#,
                nil,
                #"{"instruments":[],"play_first":"recordings"}"#,
                #"{"play_first":"apple_music","theme":"dark"}"#,
                // No row to read, so the queued change takes the default.
                #"{"instruments":["violin"],"play_first":"recordings"}"#,
                #"{"title":"Jam"}"#,
            ])
    }
}

@Test func theV9MigrationAddsOriginAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v8")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        // Rows pulled after the server added the fields kept them in `extra`.
        try db.execute(
            sql: """
                INSERT INTO recordings
                    (id, created_at, updated_at, server_seq, source, recorded_at, position, state, extra)
                VALUES
                    ('r-1', ?, ?, 0, 'microphone', ?, 0, 'ready', '{}'),
                    ('r-2', ?, ?, 3, 'import', ?, 1, 'ready',
                        '{"origin":"slippery_hill","origin_url":"https://www.slippery-hill.com/recordings/1","theme":"dark"}')
                """,
            arguments: [time, time, time, time, time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('recordings', 'r-1', 'upsert', ?, '{"label":"Take 1"}'),
                    ('recordings', 'r-2', 'upsert', ?, '{"label":"Take 2"}'),
                    ('recordings', 'r-3', 'delete', ?, NULL),
                    ('recordings', 'r-4', 'upsert', ?, '{"label":"Take 4"}'),
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}')
                """,
            arguments: [time, time, time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v9")

    try queue.read { db in
        let rows = try Row.fetchAll(db, sql: "SELECT origin, origin_url, extra FROM recordings ORDER BY id")
        #expect(rows.map { $0["origin"] as String } == ["own", "slippery_hill"])
        #expect(rows.map { $0["origin_url"] as String? } == [nil, "https://www.slippery-hill.com/recordings/1"])
        #expect(rows.map { $0["extra"] as String } == ["{}", #"{"theme":"dark"}"#])

        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(
            data == [
                #"{"label":"Take 1","origin":"own","origin_url":null}"#,
                #"{"label":"Take 2","origin":"slippery_hill","origin_url":"https://www.slippery-hill.com/recordings/1"}"#,
                nil,
                // No row to read, so the queued change takes the default.
                #"{"label":"Take 4","origin":"own","origin_url":null}"#,
                #"{"title":"Jam"}"#,
            ])
    }
}

@Test func theV11MigrationSplitsTheRecordingDateAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v10")
    let time = "2026-09-25T12:00:00.000Z"
    let played = "2026-09-20T18:04:11.000Z"
    try queue.write { db in
        // `r-4` was pulled after the server split the date, so this build kept the new fields
        // in `extra`.
        try db.execute(
            sql: """
                INSERT INTO recordings
                    (id, created_at, updated_at, server_seq, source, recorded_at, position, state, extra)
                VALUES
                    ('r-1', ?, ?, 0, 'microphone', ?, 0, 'ready', '{}'),
                    ('r-2', ?, ?, 0, 'upload', ?, 1, 'ready', '{}'),
                    ('r-3', ?, ?, 0, 'import', ?, 2, 'ready', '{}'),
                    ('r-4', ?, ?, 3, 'import', '1937-01-01T00:00:00.000Z', 3, 'ready',
                        '{"added_at":"2026-09-24T09:00:00.000Z","recorded_precision":"year","theme":"dark"}')
                """,
            arguments: [time, time, played, time, time, played, time, time, played, time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('recordings', 'r-1', 'upsert', ?, '{"label":"Take 1","recorded_at":"\(played)","source":"microphone"}'),
                    ('recordings', 'r-2', 'upsert', ?, '{"label":"Take 2","recorded_at":"\(played)","source":"upload"}'),
                    ('recordings', 'r-3', 'delete', ?, NULL),
                    ('recordings', 'r-4', 'upsert', ?,
                        '{"added_at":"2026-09-24T09:00:00.000Z","recorded_at":"1937-01-01T00:00:00.000Z","recorded_precision":"year","source":"import"}'),
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam","recorded_at":"x"}')
                """,
            arguments: [time, time, time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v11")

    try queue.read { db in
        let rows = try Row.fetchAll(
            db, sql: "SELECT added_at, recorded_at, recorded_precision, extra FROM recordings ORDER BY id")
        #expect(rows.map { $0["added_at"] as String } == [played, played, played, "2026-09-24T09:00:00.000Z"])
        #expect(rows.map { $0["recorded_at"] as String? } == [played, nil, nil, "1937-01-01T00:00:00.000Z"])
        #expect(rows.map { $0["recorded_precision"] as String? } == ["time", nil, nil, "year"])
        #expect(rows.map { $0["extra"] as String } == ["{}", "{}", "{}", #"{"theme":"dark"}"#])
        let take = try #require(try Recording.fetchOne(db, key: "r-1"))
        #expect(take.addedAt == Timestamp(iso: played))
        #expect(take.recordedAt == Timestamp(iso: played))
        #expect(take.recordedPrecision == "time")
        let upload = try #require(try Recording.fetchOne(db, key: "r-2"))
        #expect(upload.addedAt == Timestamp(iso: played))
        #expect(upload.recordedAt == nil)
        #expect(upload.recordedPrecision == nil)
        let pulled = try #require(try Recording.fetchOne(db, key: "r-4"))
        #expect(pulled.recordedPrecision == "year")
        #expect(pulled.extra == ["theme": .string("dark")])

        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(
            data == [
                #"{"label":"Take 1","recorded_at":"\#(played)","source":"microphone","added_at":"\#(played)","recorded_precision":"time"}"#,
                #"{"label":"Take 2","recorded_at":null,"source":"upload","added_at":"\#(played)","recorded_precision":null}"#,
                nil,
                // Already in the new shape, so left as queued.
                #"{"added_at":"2026-09-24T09:00:00.000Z","recorded_at":"1937-01-01T00:00:00.000Z","recorded_precision":"year","source":"import"}"#,
                #"{"title":"Jam","recorded_at":"x"}"#,
            ])
    }
}

@Test func migratingToV12KeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v11")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        try db.execute(
            sql: """
                INSERT INTO tunes
                    (id, created_at, updated_at, server_seq, title, alternate_titles, modes, is_crooked, tunings, extra)
                VALUES ('t-1', ?, ?, 4, 'Jam', '[]', '[]', 0, '{}', '{}')
                """,
            arguments: [time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}'),
                    ('user_tunes', 'ut-1', 'delete', ?, NULL)
                """,
            arguments: [time, time])
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('pull_cursor', '4')")
    }
    let before = try queue.read { db in
        try Row.fetchAll(db, sql: "SELECT * FROM outbox ORDER BY seq")
    }

    try Schema.migrator.migrate(queue, upTo: "v12")

    try queue.read { (db: Database) throws in
        #expect(try String.fetchAll(db, sql: "SELECT title FROM tunes") == ["Jam"])
        #expect(try Row.fetchAll(db, sql: "SELECT * FROM outbox ORDER BY seq") == before)
        #expect(try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'pull_cursor'") == "4")
        for table in ["play_events", "practice_sessions", "status_changes"] {
            #expect(try Int.fetchOne(db, sql: "SELECT count(*) FROM \(table)") == 0)
        }
    }
}

/// Same promise as `v4`'s, for the migration that adds the history tables, which is all it adds.
@Test func theV12MigrationNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v11")
    let objects = """
        SELECT type, name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations' AND sql IS NOT NULL
        ORDER BY name
        """
    let before = try queue.read { db in try Row.fetchAll(db, sql: objects) }
    try Schema.migrator.migrate(queue, upTo: "v12")
    let added = try queue.read { db in
        try Row.fetchAll(db, sql: objects)
            .filter { !before.contains($0) }
            .map { row -> String in
                let type: String = row["type"]
                let name: String = row["name"]
                let sql: String = row["sql"]
                return "\(type) \(name): \(sql.replacingOccurrences(of: ", ", with: ",\n  "))"
            }
            .joined(separator: "\n")
    }
    #expect(added == v12Schema)
}

@Test func migratingToV13KeepsAPendingScanItsImageAndItsQueuedChange() async throws {
    let root = TemporaryRoot()
    let folder = try CrosstuneStore.folder(for: "user_a", in: root.url)
    let scans = folder.appending(path: "scans", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: scans, withIntermediateDirectories: true)
    let pool = try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
    try Schema.migrator.migrate(pool, upTo: "v12")
    let time = "2026-09-25T12:00:00.000Z"
    try await pool.write { db in
        try db.execute(
            sql: """
                INSERT INTO tunes
                    (id, created_at, updated_at, server_seq, title, alternate_titles, modes, is_crooked, tunings, extra)
                VALUES ('t-1', ?, ?, 0, 'Jam', '[]', '[]', 0, '{}', '{}')
                """,
            arguments: [time, time])
        try db.execute(
            sql: """
                INSERT INTO notation_pages
                    (id, created_at, updated_at, server_seq, tune_id, position, width, height, state, extra)
                VALUES ('p-1', ?, ?, 0, 't-1', 0, 3, 4, 'pending_upload', '{}')
                """,
            arguments: [time, time])
        try db.execute(
            sql: "INSERT INTO notation_files (page_id, file_name, origin) VALUES ('p-1', 'p-1-a.jpg', 'captured')")
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}'),
                    ('notation_pages', 'p-1', 'upsert', ?, '{"tune_id":"t-1","position":0,"width":3,"height":4}'),
                    ('notation_pages', 'p-0', 'delete', ?, NULL),
                    ('lists', 'l-1', 'upsert', ?, '{"name":"Set"}')
                """,
            arguments: [time, time, time, time])
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('pull_cursor', '4')")
    }
    let outbox = "SELECT seq, row_id, op, updated_at, data, table_name FROM outbox ORDER BY seq"
    let before = try await pool.read { db in try Row.fetchAll(db, sql: outbox).map { Array($0.databaseValues) } }
    try pool.close()
    try Data([1]).write(to: scans.appending(path: "p-1-a.jpg"))

    let store = try root.open()
    await store.deleteUnnamedFiles()

    let scan = try #require(try await store.read { db in try ScanRecord.fetchOne(db, key: "p-1") })
    #expect(scan.state == ScanRecord.pendingUpload)
    #expect(scan.tuneID == "t-1")
    let file = try #require(try await store.read { db in try ScanFile.fetchOne(db, key: "p-1") })
    #expect(file == ScanFile(scanID: "p-1", fileName: "p-1-a.jpg", origin: .captured))
    let image = store.scansFolder.appending(path: "p-1-a.jpg")
    #expect(FileManager.default.fileExists(atPath: image.path(percentEncoded: false)))
    #expect(try await store.notUploadedScanCount() == 1)

    let after = try await store.read { db in try Row.fetchAll(db, sql: outbox).map { Array($0.databaseValues) } }
    // Every column but the table name stays as it was, `seq` included, so the queue keeps its order.
    #expect(after.map { $0.dropLast() } == before.map { $0.dropLast() })
    #expect(after.map { String.fromDatabaseValue($0.last!) } == ["tunes", "scans", "scans", "lists"])
    let queued = try await store.pendingChanges(limit: 10)
    #expect(queued.map(\.tableName) == [.tunes, .scans, .scans, .lists])
    #expect(try await store.meta(.pullCursor, as: Int.self) == 4, "the rows move, so nothing is pulled again")
}

/// Same promise as `v4`'s, for the migration that renames notation pages to scans.
@Test func theV13MigrationNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v12")
    let objects = """
        SELECT type, name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations' AND sql IS NOT NULL
        ORDER BY name
        """
    func described(_ rows: [Row]) -> String {
        rows.map { row -> String in
            let type: String = row["type"]
            let name: String = row["name"]
            let sql: String = row["sql"]
            return "\(type) \(name): \(sql.replacingOccurrences(of: ", ", with: ",\n  "))"
        }
        .joined(separator: "\n")
    }
    let before = try queue.read { db in try Row.fetchAll(db, sql: objects) }
    try Schema.migrator.migrate(queue, upTo: "v13")
    let after = try queue.read { db in try Row.fetchAll(db, sql: objects) }
    #expect(described(before.filter { !after.contains($0) }) == v13Removed)
    #expect(described(after.filter { !before.contains($0) }) == v13Added)
}

@Test func migratingToV14KeepsRowsQueuedChangesAndBothCursors() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v13")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        try db.execute(
            sql: """
                INSERT INTO tunes
                    (id, created_at, updated_at, server_seq, title, alternate_titles, modes, is_crooked, tunings, extra)
                VALUES ('t-1', ?, ?, 4, 'Jam', '[]', '[]', 0, '{}', '{}')
                """,
            arguments: [time, time])
        try db.execute(
            sql: """
                INSERT INTO play_events (id, server_seq, created_at, context, started_at, listened_ms, recording_id)
                VALUES ('p-1', NULL, ?, 'row', ?, 12000, 'r-1')
                """,
            arguments: [time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}'),
                    ('play_events', 'p-1', 'upsert', ?, '{"context":"row"}'),
                    ('user_tunes', 'ut-1', 'delete', ?, NULL)
                """,
            arguments: [time, time, time])
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('pull_cursor', '4'), ('events_cursor', '9')")
    }
    let outbox = "SELECT * FROM outbox ORDER BY seq"
    let before = try queue.read { db in try Row.fetchAll(db, sql: outbox) }

    try Schema.migrator.migrate(queue, upTo: "v14")

    try queue.read { (db: Database) throws in
        #expect(try String.fetchAll(db, sql: "SELECT title FROM tunes") == ["Jam"])
        #expect(try String.fetchAll(db, sql: "SELECT id FROM play_events") == ["p-1"])
        #expect(try Row.fetchAll(db, sql: outbox) == before)
        #expect(try Int.fetchOne(db, sql: "SELECT count(*) FROM scan_views") == 0)
        #expect(try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'pull_cursor'") == "4")
        #expect(try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'events_cursor'") == "9")
    }
}

/// Same promise as `v4`'s, for the migration that adds the scan views table, which is all it adds.
@Test func theV14MigrationNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v13")
    let objects = """
        SELECT type, name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations' AND sql IS NOT NULL
        ORDER BY name
        """
    let before = try queue.read { db in try Row.fetchAll(db, sql: objects) }
    try Schema.migrator.migrate(queue, upTo: "v14")
    let after = try queue.read { db in try Row.fetchAll(db, sql: objects) }
    #expect(after.filter { before.contains($0) }.count == before.count, "nothing is removed or changed")
    let added = after.filter { !before.contains($0) }
        .map { row -> String in
            let type: String = row["type"]
            let name: String = row["name"]
            let sql: String = row["sql"]
            return "\(type) \(name): \(sql.replacingOccurrences(of: ", ", with: ",\n  "))"
        }
        .joined(separator: "\n")
    #expect(added == v14Schema)
}

private let v14Schema = """
    table scan_views: CREATE TABLE "scan_views" ("id" TEXT PRIMARY KEY NOT NULL,
      "server_seq" INTEGER,
      "created_at" TEXT NOT NULL,
      "tune_id" TEXT NOT NULL,
      "context" TEXT NOT NULL,
      "list_id" TEXT,
      "started_at" TEXT NOT NULL,
      "viewed_ms" INTEGER NOT NULL)
    index scan_views_on_started_at: CREATE INDEX "scan_views_on_started_at" ON "scan_views"("started_at")
    """

/// The `notation_pages` and `notation_files` shapes here are what `v10` creates, so this also
/// pins `v10`'s output.
private let v13Removed = """
    table notation_files: CREATE TABLE "notation_files" ("page_id" TEXT PRIMARY KEY NOT NULL,
      "file_name" TEXT NOT NULL,
      "origin" TEXT NOT NULL,
      "error" TEXT,
      "upload_attempts" INTEGER NOT NULL DEFAULT 0,
      "next_attempt_at" TEXT)
    table notation_pages: CREATE TABLE "notation_pages" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "tune_id" TEXT NOT NULL,
      "position" INTEGER NOT NULL,
      "width" INTEGER NOT NULL,
      "height" INTEGER NOT NULL,
      "state" TEXT NOT NULL,
      "file_bytes" INTEGER,
      "extra" TEXT NOT NULL)
    index notation_pages_on_tune_id: CREATE INDEX "notation_pages_on_tune_id" ON "notation_pages"("tune_id")
    """

private let v13Added = """
    table scan_files: CREATE TABLE "scan_files" ("scan_id" TEXT PRIMARY KEY NOT NULL,
      "file_name" TEXT NOT NULL,
      "origin" TEXT NOT NULL,
      "error" TEXT,
      "upload_attempts" INTEGER NOT NULL DEFAULT 0,
      "next_attempt_at" TEXT)
    table scans: CREATE TABLE "scans" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "tune_id" TEXT NOT NULL,
      "position" INTEGER NOT NULL,
      "width" INTEGER NOT NULL,
      "height" INTEGER NOT NULL,
      "state" TEXT NOT NULL,
      "file_bytes" INTEGER,
      "extra" TEXT NOT NULL)
    index scans_on_tune_id: CREATE INDEX "scans_on_tune_id" ON "scans"("tune_id")
    """

private let v12Schema = """
    table play_events: CREATE TABLE "play_events" ("id" TEXT PRIMARY KEY NOT NULL,
      "server_seq" INTEGER,
      "created_at" TEXT NOT NULL,
      "context" TEXT NOT NULL,
      "started_at" TEXT NOT NULL,
      "listened_ms" INTEGER NOT NULL,
      "recording_id" TEXT,
      "link_id" TEXT,
      "list_id" TEXT,
      "tune_id" TEXT)
    index play_events_on_started_at: CREATE INDEX "play_events_on_started_at" ON "play_events"("started_at")
    table practice_sessions: CREATE TABLE "practice_sessions" ("id" TEXT PRIMARY KEY NOT NULL,
      "server_seq" INTEGER,
      "created_at" TEXT NOT NULL,
      "recording_id" TEXT NOT NULL,
      "tune_id" TEXT,
      "started_at" TEXT NOT NULL,
      "duration_ms" INTEGER NOT NULL,
      "speed_percent" INTEGER NOT NULL,
      "pitch_cents" INTEGER NOT NULL,
      "loop_ids" TEXT NOT NULL)
    index practice_sessions_on_started_at: CREATE INDEX "practice_sessions_on_started_at" ON "practice_sessions"("started_at")
    table status_changes: CREATE TABLE "status_changes" ("id" TEXT PRIMARY KEY NOT NULL,
      "server_seq" INTEGER NOT NULL,
      "user_tune_id" TEXT NOT NULL,
      "from_status" TEXT,
      "to_status" TEXT NOT NULL,
      "changed_at" TEXT NOT NULL)
    index status_changes_on_changed_at: CREATE INDEX "status_changes_on_changed_at" ON "status_changes"("changed_at")
    """

private let v5LoopsSchema = """
    table recording_loops: CREATE TABLE "recording_loops" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "recording_id" TEXT NOT NULL,
      "label" TEXT,
      "start_ms" INTEGER NOT NULL,
      "end_ms" INTEGER NOT NULL,
      "color" INTEGER NOT NULL,
      "extra" TEXT NOT NULL)
    index recording_loops_on_recording_id: CREATE INDEX "recording_loops_on_recording_id" ON "recording_loops"("recording_id")
    """

private let v4Schema = """
    table list_items: CREATE TABLE "list_items" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "list_id" TEXT NOT NULL,
      "user_tune_id" TEXT NOT NULL,
      "position" INTEGER NOT NULL,
      "extra" TEXT NOT NULL)
    index list_items_on_list_id: CREATE INDEX "list_items_on_list_id" ON "list_items"("list_id")
    index list_items_on_user_tune_id: CREATE INDEX "list_items_on_user_tune_id" ON "list_items"("user_tune_id")
    table lists: CREATE TABLE "lists" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "position" INTEGER NOT NULL,
      "extra" TEXT NOT NULL)
    table meta: CREATE TABLE "meta" ("key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL)
    table outbox: CREATE TABLE "outbox" ("seq" INTEGER PRIMARY KEY AUTOINCREMENT,
      "table_name" TEXT NOT NULL,
      "row_id" TEXT NOT NULL,
      "op" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "data" TEXT,
      UNIQUE ("table_name",
      "row_id"))
    table recording_files: CREATE TABLE "recording_files" ("id" TEXT PRIMARY KEY NOT NULL,
      "local_state" TEXT NOT NULL,
      "file_name" TEXT,
      "content_type" TEXT,
      "bytes" INTEGER,
      "local_duration_ms" INTEGER,
      "blob_rev" TEXT,
      "blob_start_ms" INTEGER NOT NULL DEFAULT 0,
      "peaks_file_name" TEXT,
      "peaks_rev" TEXT,
      "error" TEXT,
      "tune_id" TEXT,
      "recorded_at" TEXT,
      "upload_attempts" INTEGER NOT NULL DEFAULT 0,
      "next_attempt_at" TEXT,
      "updated_at" TEXT NOT NULL)
    index recording_files_on_local_state: CREATE INDEX "recording_files_on_local_state" ON "recording_files"("local_state")
    table recording_links: CREATE TABLE "recording_links" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "tune_id" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "provider_ref" TEXT,
      "title" TEXT,
      "label" TEXT,
      "artwork_url" TEXT,
      "position" INTEGER NOT NULL,
      "extra" TEXT NOT NULL)
    index recording_links_on_tune_id: CREATE INDEX "recording_links_on_tune_id" ON "recording_links"("tune_id")
    table recordings: CREATE TABLE "recordings" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "tune_id" TEXT,
      "source" TEXT NOT NULL,
      "recorded_at" TEXT NOT NULL,
      "label" TEXT,
      "position" INTEGER NOT NULL,
      "state" TEXT NOT NULL,
      "duration_ms" INTEGER,
      "playback_mime" TEXT,
      "playback_bytes" INTEGER,
      "error" TEXT,
      "source_duration_ms" INTEGER,
      "playback_start_ms" INTEGER,
      "playback_end_ms" INTEGER,
      "playback_rev" TEXT,
      "peaks_rev" TEXT,
      "trim_start_ms" INTEGER NOT NULL DEFAULT 0,
      "trim_end_ms" INTEGER,
      "speed_percent" INTEGER NOT NULL DEFAULT 100,
      "pitch_cents" INTEGER NOT NULL DEFAULT 0,
      "extra" TEXT NOT NULL)
    index recordings_on_tune_id: CREATE INDEX "recordings_on_tune_id" ON "recordings"("tune_id")
    table tunes: CREATE TABLE "tunes" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "title" TEXT NOT NULL,
      "alternate_titles" TEXT NOT NULL,
      "composer" TEXT,
      "genre" TEXT,
      "tune_type" TEXT,
      "key" TEXT,
      "modes" TEXT NOT NULL,
      "time_signature" TEXT,
      "part_structure" TEXT,
      "is_crooked" BOOLEAN NOT NULL,
      "lyrics" TEXT,
      "tunings" TEXT NOT NULL,
      "extra" TEXT NOT NULL)
    index tunes_on_title: CREATE INDEX "tunes_on_title" ON "tunes"("title")
    table user_settings: CREATE TABLE "user_settings" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "audio_quality" TEXT NOT NULL,
      "instruments" TEXT NOT NULL,
      "extra" TEXT NOT NULL)
    table user_tunes: CREATE TABLE "user_tunes" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "tune_id" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "learned_from" TEXT,
      "learned_on" TEXT,
      "notes" TEXT,
      "archived_at" TEXT,
      "extra" TEXT NOT NULL)
    index user_tunes_on_tune_id: CREATE INDEX "user_tunes_on_tune_id" ON "user_tunes"("tune_id")
    """

private let v7UserSettingsSchema = """
    CREATE TABLE "user_settings" ("id" TEXT PRIMARY KEY NOT NULL,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      "deleted_at" TEXT,
      "server_seq" INTEGER NOT NULL,
      "audio_quality" TEXT NOT NULL,
      "instruments" TEXT NOT NULL,
      "extra" TEXT NOT NULL,
      "search_providers" TEXT NOT NULL DEFAULT '["apple_music","tidal","internet_archive","youtube","spotify","bandcamp","soundcloud"]')
    """

@Test func theV15MigrationAddsNewTuneDefaultsAndKeepsRowsAndQueuedChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v14")
    let time = "2026-09-25T12:00:00.000Z"
    try queue.write { db in
        // Rows pulled after the server added the fields kept them in `extra`.
        try db.execute(
            sql: """
                INSERT INTO user_settings
                    (id, created_at, updated_at, server_seq, audio_quality, instruments, extra)
                VALUES
                    ('s-1', ?, ?, 0, 'high', '[]', '{}'),
                    ('s-2', ?, ?, 3, 'standard', '[]',
                        '{"new_tune_genre":"Irish","new_tune_status":"known","theme":"dark"}')
                """,
            arguments: [time, time, time, time])
        try db.execute(
            sql: """
                INSERT INTO outbox (table_name, row_id, op, updated_at, data) VALUES
                    ('user_settings', 's-1', 'upsert', ?, '{"instruments":[]}'),
                    ('user_settings', 's-2', 'upsert', ?, '{"new_tune_genre":"Irish","new_tune_status":"known"}'),
                    ('user_settings', 's-3', 'upsert', ?, '{"instruments":["violin"]}'),
                    ('tunes', 't-1', 'upsert', ?, '{"title":"Jam"}')
                """,
            arguments: [time, time, time, time])
    }

    try Schema.migrator.migrate(queue, upTo: "v15")

    try queue.read { db in
        // Read as rows, since the record follows the current schema and later migrations add
        // settings columns.
        let settings = try Row.fetchAll(
            db, sql: "SELECT new_tune_genre, new_tune_status, audio_quality, extra FROM user_settings ORDER BY id")
        #expect(settings.map { $0["new_tune_genre"] as String? } == [nil, "Irish"])
        #expect(settings.map { $0["new_tune_status"] as String } == ["want_to_learn", "known"])
        #expect(settings.map { $0["audio_quality"] as String } == ["high", "standard"])
        #expect(settings.map { $0["extra"] as String } == ["{}", #"{"theme":"dark"}"#])

        let data = try String?.fetchAll(db, sql: "SELECT data FROM outbox ORDER BY seq")
        #expect(
            data == [
                #"{"instruments":[],"new_tune_genre":null,"new_tune_status":"want_to_learn"}"#,
                #"{"new_tune_genre":"Irish","new_tune_status":"known"}"#,
                // No row to read, so the queued change takes the defaults.
                #"{"instruments":["violin"],"new_tune_genre":null,"new_tune_status":"want_to_learn"}"#,
                #"{"title":"Jam"}"#,
            ])
    }
}
