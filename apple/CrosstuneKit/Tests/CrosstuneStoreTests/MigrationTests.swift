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
    await store.deleteUnnamedAudio()

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
    #expect(try await store.meta(.pullCursor, as: Int.self) == 5)
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
