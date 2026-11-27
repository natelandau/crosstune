import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneStore

private func handoff(_ address: String = "https://storage.example/a") -> UploadHandoff {
    UploadHandoff(
        url: URL(string: address)!, confirmToken: "token", contentType: "audio/mp4",
        expiresAt: Timestamp(milliseconds: 1_800_000_000_000), attempts: 1, refused: false, putLanded: true)
}

@Test(.timeLimit(.minutes(1))) func aHandoffReadsBackAsSaved() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let saved = handoff()
    try await store.write { writer in
        try RecordingFile(id: "r1", localState: .uploading, handoff: saved).insert(writer.db)
    }

    let fetched = try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") }
    #expect(fetched?.handoff == saved)
}

@Test(.timeLimit(.minutes(1))) func aFileFromBeforeHandoffsHasNone() throws {
    let root = TemporaryRoot()
    let folder = try CrosstuneStore.folder(for: "user_a", in: root.url)
    try FileManager.default.createDirectory(
        at: folder.appending(path: "audio", directoryHint: .isDirectory), withIntermediateDirectories: true)
    let pool = try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
    try Schema.migrator.migrate(pool, upTo: "v24")
    try pool.write { db in
        try db.execute(
            sql: """
                INSERT INTO recording_files (id, local_state, blob_start_ms, upload_attempts, updated_at)
                VALUES ('r1', 'captured', 0, 0, '2026-09-25T12:00:00.000Z')
                """)
    }
    try Schema.migrator.migrate(pool)

    #expect(try pool.read { db in try RecordingFile.fetchOne(db, key: "r1") }?.handoff == nil)
}

@Test(.timeLimit(.minutes(1))) func aWriteForAnotherHandoffChangesNothing() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await store.write { writer in
        try RecordingFile(id: "r1", localState: .uploading, handoff: handoff("https://storage.example/a"))
            .insert(writer.db)
    }

    let changed = try await store.write { writer in
        try writer.updateFile("r1", whileHolding: handoff("https://storage.example/b")) { $0.localState = .uploaded }
    }

    #expect(changed == false)
    #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") }?.localState == .uploading)
}

@Test(.timeLimit(.minutes(1))) func aWriteForTheHeldHandoffApplies() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let held = handoff("https://storage.example/a")
    try await store.write { writer in
        try RecordingFile(id: "r1", localState: .uploading, handoff: held).insert(writer.db)
    }

    let changed = try await store.write { writer in
        try writer.updateFile("r1", whileHolding: held) { $0.localState = .uploaded }
    }

    #expect(changed)
    #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: "r1") }?.localState == .uploaded)
}
