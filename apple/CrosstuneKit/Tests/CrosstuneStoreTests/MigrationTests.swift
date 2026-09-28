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
    #expect(outboxRowIDs == fixture.outboxRowIDs)
    #expect(outboxSeqs == fixture.outboxSeqs)
    let left = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
    #expect(Set(left) == Set(fixture.fileNames))
    #expect(try await store.meta(.pullCursor, as: Int.self) == 5)
    #expect(try await store.meta(.keepOffline, as: Bool.self) == true)
}

/// A merged migration never changes: GRDB treats a store whose schema differs from what its
/// applied migrations build as written by a newer build, and opening it deletes the store.
@Test func theV4SchemaNeverChanges() throws {
    let queue = try DatabaseQueue()
    try Schema.migrator.migrate(queue, upTo: "v4")
    let schema = try queue.read(describeSchema)
    #expect(schema == v4Schema)
}

private func describeSchema(_ db: Database) throws -> String {
    let tables = try String.fetchAll(
        db,
        sql: """
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations'
            ORDER BY name
            """)
    var lines: [String] = []
    for table in tables {
        for column in try Row.fetchAll(db, sql: "PRAGMA table_info(\(table.quotedDatabaseIdentifier))")
            .sorted(by: { ($0["name"] as String) < ($1["name"] as String) })
        {
            let name: String = column["name"]
            let type: String = column["type"]
            let notNull: Int = column["notnull"]
            let defaultValue: String? = column["dflt_value"]
            let primaryKey: Int = column["pk"]
            lines.append(
                "\(table).\(name) \(type) notnull=\(notNull) default=\(defaultValue ?? "NULL") pk=\(primaryKey)")
        }
        for index in try Row.fetchAll(db, sql: "PRAGMA index_list(\(table.quotedDatabaseIdentifier))")
            .sorted(by: { ($0["name"] as String) < ($1["name"] as String) })
        {
            let name: String = index["name"]
            let unique: Int = index["unique"]
            let columns = try String.fetchAll(
                db, sql: "SELECT name FROM pragma_index_info(?) ORDER BY seqno", arguments: [name])
            lines.append("\(table) index \(name) unique=\(unique) (\(columns.joined(separator: ", ")))")
        }
    }
    return lines.joined(separator: "\n")
}

private let v4Schema = """
    list_items.created_at TEXT notnull=1 default=NULL pk=0
    list_items.deleted_at TEXT notnull=0 default=NULL pk=0
    list_items.extra TEXT notnull=1 default=NULL pk=0
    list_items.id TEXT notnull=1 default=NULL pk=1
    list_items.list_id TEXT notnull=1 default=NULL pk=0
    list_items.position INTEGER notnull=1 default=NULL pk=0
    list_items.server_seq INTEGER notnull=1 default=NULL pk=0
    list_items.updated_at TEXT notnull=1 default=NULL pk=0
    list_items.user_tune_id TEXT notnull=1 default=NULL pk=0
    list_items index list_items_on_list_id unique=0 (list_id)
    list_items index list_items_on_user_tune_id unique=0 (user_tune_id)
    list_items index sqlite_autoindex_list_items_1 unique=1 (id)
    lists.created_at TEXT notnull=1 default=NULL pk=0
    lists.deleted_at TEXT notnull=0 default=NULL pk=0
    lists.extra TEXT notnull=1 default=NULL pk=0
    lists.id TEXT notnull=1 default=NULL pk=1
    lists.name TEXT notnull=1 default=NULL pk=0
    lists.position INTEGER notnull=1 default=NULL pk=0
    lists.server_seq INTEGER notnull=1 default=NULL pk=0
    lists.updated_at TEXT notnull=1 default=NULL pk=0
    lists index sqlite_autoindex_lists_1 unique=1 (id)
    meta.key TEXT notnull=1 default=NULL pk=1
    meta.value TEXT notnull=1 default=NULL pk=0
    meta index sqlite_autoindex_meta_1 unique=1 (key)
    outbox.data TEXT notnull=0 default=NULL pk=0
    outbox.op TEXT notnull=1 default=NULL pk=0
    outbox.row_id TEXT notnull=1 default=NULL pk=0
    outbox.seq INTEGER notnull=0 default=NULL pk=1
    outbox.table_name TEXT notnull=1 default=NULL pk=0
    outbox.updated_at TEXT notnull=1 default=NULL pk=0
    outbox index sqlite_autoindex_outbox_1 unique=1 (table_name, row_id)
    recording_files.blob_rev TEXT notnull=0 default=NULL pk=0
    recording_files.blob_start_ms INTEGER notnull=1 default=0 pk=0
    recording_files.bytes INTEGER notnull=0 default=NULL pk=0
    recording_files.content_type TEXT notnull=0 default=NULL pk=0
    recording_files.error TEXT notnull=0 default=NULL pk=0
    recording_files.file_name TEXT notnull=0 default=NULL pk=0
    recording_files.id TEXT notnull=1 default=NULL pk=1
    recording_files.local_duration_ms INTEGER notnull=0 default=NULL pk=0
    recording_files.local_state TEXT notnull=1 default=NULL pk=0
    recording_files.next_attempt_at TEXT notnull=0 default=NULL pk=0
    recording_files.peaks_file_name TEXT notnull=0 default=NULL pk=0
    recording_files.peaks_rev TEXT notnull=0 default=NULL pk=0
    recording_files.recorded_at TEXT notnull=0 default=NULL pk=0
    recording_files.tune_id TEXT notnull=0 default=NULL pk=0
    recording_files.updated_at TEXT notnull=1 default=NULL pk=0
    recording_files.upload_attempts INTEGER notnull=1 default=0 pk=0
    recording_files index recording_files_on_local_state unique=0 (local_state)
    recording_files index sqlite_autoindex_recording_files_1 unique=1 (id)
    recording_links.artwork_url TEXT notnull=0 default=NULL pk=0
    recording_links.created_at TEXT notnull=1 default=NULL pk=0
    recording_links.deleted_at TEXT notnull=0 default=NULL pk=0
    recording_links.extra TEXT notnull=1 default=NULL pk=0
    recording_links.id TEXT notnull=1 default=NULL pk=1
    recording_links.label TEXT notnull=0 default=NULL pk=0
    recording_links.position INTEGER notnull=1 default=NULL pk=0
    recording_links.provider TEXT notnull=1 default=NULL pk=0
    recording_links.provider_ref TEXT notnull=0 default=NULL pk=0
    recording_links.server_seq INTEGER notnull=1 default=NULL pk=0
    recording_links.title TEXT notnull=0 default=NULL pk=0
    recording_links.tune_id TEXT notnull=1 default=NULL pk=0
    recording_links.updated_at TEXT notnull=1 default=NULL pk=0
    recording_links.url TEXT notnull=1 default=NULL pk=0
    recording_links index recording_links_on_tune_id unique=0 (tune_id)
    recording_links index sqlite_autoindex_recording_links_1 unique=1 (id)
    recordings.created_at TEXT notnull=1 default=NULL pk=0
    recordings.deleted_at TEXT notnull=0 default=NULL pk=0
    recordings.duration_ms INTEGER notnull=0 default=NULL pk=0
    recordings.error TEXT notnull=0 default=NULL pk=0
    recordings.extra TEXT notnull=1 default=NULL pk=0
    recordings.id TEXT notnull=1 default=NULL pk=1
    recordings.label TEXT notnull=0 default=NULL pk=0
    recordings.peaks_rev TEXT notnull=0 default=NULL pk=0
    recordings.pitch_cents INTEGER notnull=1 default=0 pk=0
    recordings.playback_bytes INTEGER notnull=0 default=NULL pk=0
    recordings.playback_end_ms INTEGER notnull=0 default=NULL pk=0
    recordings.playback_mime TEXT notnull=0 default=NULL pk=0
    recordings.playback_rev TEXT notnull=0 default=NULL pk=0
    recordings.playback_start_ms INTEGER notnull=0 default=NULL pk=0
    recordings.position INTEGER notnull=1 default=NULL pk=0
    recordings.recorded_at TEXT notnull=1 default=NULL pk=0
    recordings.server_seq INTEGER notnull=1 default=NULL pk=0
    recordings.source TEXT notnull=1 default=NULL pk=0
    recordings.source_duration_ms INTEGER notnull=0 default=NULL pk=0
    recordings.speed_percent INTEGER notnull=1 default=100 pk=0
    recordings.state TEXT notnull=1 default=NULL pk=0
    recordings.trim_end_ms INTEGER notnull=0 default=NULL pk=0
    recordings.trim_start_ms INTEGER notnull=1 default=0 pk=0
    recordings.tune_id TEXT notnull=0 default=NULL pk=0
    recordings.updated_at TEXT notnull=1 default=NULL pk=0
    recordings index recordings_on_tune_id unique=0 (tune_id)
    recordings index sqlite_autoindex_recordings_1 unique=1 (id)
    tunes.alternate_titles TEXT notnull=1 default=NULL pk=0
    tunes.composer TEXT notnull=0 default=NULL pk=0
    tunes.created_at TEXT notnull=1 default=NULL pk=0
    tunes.deleted_at TEXT notnull=0 default=NULL pk=0
    tunes.extra TEXT notnull=1 default=NULL pk=0
    tunes.genre TEXT notnull=0 default=NULL pk=0
    tunes.id TEXT notnull=1 default=NULL pk=1
    tunes.is_crooked BOOLEAN notnull=1 default=NULL pk=0
    tunes.key TEXT notnull=0 default=NULL pk=0
    tunes.lyrics TEXT notnull=0 default=NULL pk=0
    tunes.modes TEXT notnull=1 default=NULL pk=0
    tunes.part_structure TEXT notnull=0 default=NULL pk=0
    tunes.server_seq INTEGER notnull=1 default=NULL pk=0
    tunes.time_signature TEXT notnull=0 default=NULL pk=0
    tunes.title TEXT notnull=1 default=NULL pk=0
    tunes.tune_type TEXT notnull=0 default=NULL pk=0
    tunes.tunings TEXT notnull=1 default=NULL pk=0
    tunes.updated_at TEXT notnull=1 default=NULL pk=0
    tunes index sqlite_autoindex_tunes_1 unique=1 (id)
    tunes index tunes_on_title unique=0 (title)
    user_settings.audio_quality TEXT notnull=1 default=NULL pk=0
    user_settings.created_at TEXT notnull=1 default=NULL pk=0
    user_settings.deleted_at TEXT notnull=0 default=NULL pk=0
    user_settings.extra TEXT notnull=1 default=NULL pk=0
    user_settings.id TEXT notnull=1 default=NULL pk=1
    user_settings.instruments TEXT notnull=1 default=NULL pk=0
    user_settings.server_seq INTEGER notnull=1 default=NULL pk=0
    user_settings.updated_at TEXT notnull=1 default=NULL pk=0
    user_settings index sqlite_autoindex_user_settings_1 unique=1 (id)
    user_tunes.archived_at TEXT notnull=0 default=NULL pk=0
    user_tunes.created_at TEXT notnull=1 default=NULL pk=0
    user_tunes.deleted_at TEXT notnull=0 default=NULL pk=0
    user_tunes.extra TEXT notnull=1 default=NULL pk=0
    user_tunes.id TEXT notnull=1 default=NULL pk=1
    user_tunes.learned_from TEXT notnull=0 default=NULL pk=0
    user_tunes.learned_on TEXT notnull=0 default=NULL pk=0
    user_tunes.notes TEXT notnull=0 default=NULL pk=0
    user_tunes.server_seq INTEGER notnull=1 default=NULL pk=0
    user_tunes.status TEXT notnull=1 default=NULL pk=0
    user_tunes.tune_id TEXT notnull=1 default=NULL pk=0
    user_tunes.updated_at TEXT notnull=1 default=NULL pk=0
    user_tunes index sqlite_autoindex_user_tunes_1 unique=1 (id)
    user_tunes index user_tunes_on_tune_id unique=0 (tune_id)
    """
