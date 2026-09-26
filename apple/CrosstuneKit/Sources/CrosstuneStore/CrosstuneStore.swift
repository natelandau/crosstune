import Foundation
import GRDB

/// One user's on-device catalog: the synced tables, the outbox of unsent changes, and `meta`.
///
/// Each user has a folder, `<root>/<user ID>/`, holding `crosstune.sqlite` and an `audio/`
/// folder, so two accounts on one device never share data and sign-out removes both together.
/// Screens read only this store. Every write goes through ``write(_:)``, which stores a row
/// and queues its change in one transaction.
public final class CrosstuneStore: Sendable {
    public enum StoreError: Error, Equatable {
        /// A user ID that is not safe as a folder name.
        case invalidUserID(String)
    }

    public let userID: String
    public let folder: URL
    /// Read queries, including `ValueObservation`, run against this.
    public let database: DatabasePool

    public var audioFolder: URL { folder.appending(path: "audio", directoryHint: .isDirectory) }

    /// The extension of a capture still being written, which launch recovery finds and finishes
    /// even when no row names it.
    public static let captureExtension = "aac"
    /// The extension of a finished capture, which recovery writes before the row names it.
    public static let finishedExtension = "m4a"

    /// The audio files the folder held when the store opened, the only ones
    /// ``deleteUnnamedAudio()`` may delete, since anything written after is still settling.
    private let audioAtOpen: Set<String>

    private init(userID: String, folder: URL, database: DatabasePool) {
        self.userID = userID
        self.folder = folder
        self.database = database
        let audio = folder.appending(path: "audio", directoryHint: .isDirectory)
        audioAtOpen = Set(
            (try? FileManager.default.contentsOfDirectory(atPath: audio.path(percentEncoded: false))) ?? [])
    }

    /// Where every user's folder lives: `Application Support/Users/`.
    public static var defaultRoot: URL {
        URL.applicationSupportDirectory.appending(path: "Users", directoryHint: .isDirectory)
    }

    /// Opens the user's store, creating it on first use.
    ///
    /// A store from a newer build, as after installing an older TestFlight build, is deleted
    /// with its folder and the next sync pulls everything again. One from an older build
    /// starts over, as ``Schema`` describes.
    public static func open(userID: String, root: URL = defaultRoot) throws -> CrosstuneStore {
        try open(userID: userID, root: root, schemaVersion: Schema.version)
    }

    static func open(userID: String, root: URL, schemaVersion: Int) throws -> CrosstuneStore {
        let folder = try folder(for: userID, in: root)
        var database = try openDatabase(in: folder)
        if try database.read(Schema.storedVersion) > schemaVersion {
            try database.close()
            try FileManager.default.removeItem(at: folder)
            database = try openDatabase(in: folder)
        }
        try database.write { db in try Schema.prepare(db, version: schemaVersion) }
        return CrosstuneStore(userID: userID, folder: folder, database: database)
    }

    /// Deletes every audio file no recording file row names, as a crash leaves between a file and
    /// its row landing or going. Call once launch recovery has run.
    ///
    /// Only files already there when the store opened are candidates, so an import, download,
    /// or take written since, whose row lands after its file, is never touched. A capture is
    /// left for recovery, and so is the finished file of a row still capturing, which recovery
    /// records.
    public func deleteUnnamedAudio() async {
        let named: Set<String>
        do {
            named = try await database.read { db in
                let files = try String.fetchAll(
                    db, sql: "SELECT file_name FROM recording_files WHERE file_name IS NOT NULL")
                let capturing = try String.fetchAll(
                    db, sql: "SELECT id FROM recording_files WHERE local_state = ?",
                    arguments: [LocalFileState.capturing.rawValue])
                return Set(files + capturing.map { "\($0).\(Self.finishedExtension)" })
            }
        } catch {
            return
        }
        for name in audioAtOpen where !named.contains(name) {
            let file = audioFolder.appending(path: name)
            guard file.pathExtension != Self.captureExtension else { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// Deletes a user's folder: their database and every audio file. Close their open store
    /// first.
    public static func delete(userID: String, root: URL = defaultRoot) throws {
        try removeIfPresent(folder(for: userID, in: root))
    }

    /// Deletes every user's folder except `userID`'s, such as one a failed sign-out left behind.
    public static func deleteOthers(keeping userID: String, root: URL = defaultRoot) throws {
        try deleteOthers(keeping: [userID], root: root)
    }

    /// Deletes every user's folder except those of `userIDs`.
    public static func deleteOthers(keeping userIDs: Set<String>, root: URL = defaultRoot) throws {
        let keep = Set(try userIDs.map { try folder(for: $0, in: root).lastPathComponent })
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for folder in folders where !keep.contains(folder.lastPathComponent) {
            try removeIfPresent(folder)
        }
    }

    /// Closes the database. The store cannot be used after this.
    public func close() throws {
        try database.close()
    }

    /// Runs `body` in one write transaction: every row it stores and every change it queues
    /// land together, or none do.
    @discardableResult
    public func write<Value: Sendable>(_ body: @escaping @Sendable (StoreWriter) throws -> Value) async throws
        -> Value
    {
        try await database.write { db in try body(StoreWriter(db: db)) }
    }

    /// Runs `body` as ``write(_:)`` does, then deletes every audio file a recording file row named
    /// before it and none names after it, whether the row was dropped or its file let go. The
    /// files go only after the transaction commits, so a write that fails keeps every file its
    /// rows still point to.
    @discardableResult
    public func writeDroppingAudio<Value: Sendable>(_ body: @escaping @Sendable (StoreWriter) throws -> Value)
        async throws -> Value
    {
        let (value, dropped) = try await write { writer in
            let named = "SELECT file_name FROM recording_files WHERE file_name IS NOT NULL"
            let before = Set(try String.fetchAll(writer.db, sql: named))
            let value = try body(writer)
            let after = Set(try String.fetchAll(writer.db, sql: named))
            return (value, before.subtracting(after))
        }
        for name in dropped {
            try? FileManager.default.removeItem(at: audioFolder.appending(path: name))
        }
        return value
    }

    public func read<Value: Sendable>(_ body: @escaping @Sendable (Database) throws -> Value) async throws -> Value {
        try await database.read(body)
    }

    /// How many changes are waiting to be pushed.
    public func pendingChangeCount() async throws -> Int {
        try await database.read { db in try OutboxEntry.fetchCount(db) }
    }

    /// The oldest pending changes, in the order they were first queued.
    public func pendingChanges(limit: Int) async throws -> [OutboxEntry] {
        try await database.read { db in
            try OutboxEntry.order(OutboxEntry.CodingKeys.seq).limit(limit).fetchAll(db)
        }
    }

    public func meta<Value: Decodable & Sendable>(_ key: MetaKey, as type: Value.Type = Value.self) async throws
        -> Value?
    {
        try await database.read { db in try Meta.value(db, key) }
    }

    public func setMeta(_ key: MetaKey, to value: some Encodable & Sendable) async throws {
        try await database.write { db in try Meta.set(db, key, to: value) }
    }

    private static func folder(for userID: String, in root: URL) throws -> URL {
        // Clerk IDs are letters, digits, and underscores; anything else could leave the root.
        guard !userID.isEmpty, userID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") })
        else { throw StoreError.invalidUserID(userID) }
        return root.appending(path: userID, directoryHint: .isDirectory)
    }

    private static func openDatabase(in folder: URL) throws -> DatabasePool {
        try FileManager.default.createDirectory(
            at: folder.appending(path: "audio", directoryHint: .isDirectory), withIntermediateDirectories: true)
        return try DatabasePool(path: folder.appending(path: "crosstune.sqlite").path(percentEncoded: false))
    }

    private static func removeIfPresent(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            return
        }
    }
}

/// The one way to change synced rows, handed to ``CrosstuneStore/write(_:)``.
public struct StoreWriter {
    public let db: Database

    /// Stores a row and queues its upsert.
    ///
    /// `updated_at` becomes `time`, or one millisecond past the stored row's when that is not
    /// earlier. The stored row's `extra` is kept whatever the given row holds, since only a
    /// pull may change fields this build does not know.
    @discardableResult
    public func put<Record: SyncedRecord>(_ row: Record, at time: Timestamp = .now) throws -> Record {
        let stored = try Record.fetchOne(db, key: row.id)
        var stamped = row
        stamped.updatedAt = time.stamped(after: stored?.updatedAt)
        if let stored { stamped.extra = stored.extra }
        try stamped.upsert(db)
        try Outbox.enqueue(
            db, table: Record.table, rowID: row.id, op: .upsert, updatedAt: stamped.updatedAt,
            data: stamped.changeData())
        return stamped
    }

    /// Soft-deletes a row and queues its delete. A row a cascading parent's delete already
    /// covers passes `enqueueDelete: false`, which drops any pending change for it instead.
    public func tombstone<Record: SyncedRecord>(
        _ type: Record.Type, id: String, at time: Timestamp = .now, enqueueDelete: Bool = true
    ) throws {
        guard var row = try Record.fetchOne(db, key: id), row.deletedAt == nil else { return }
        let stamp = time.stamped(after: row.updatedAt)
        row.updatedAt = stamp
        row.deletedAt = stamp
        try row.update(db)
        if enqueueDelete {
            try Outbox.enqueue(db, table: Record.table, rowID: id, op: .delete, updatedAt: stamp, data: nil)
        } else {
            try Outbox.drop(db, table: Record.table, rowID: id)
        }
    }

    public func meta<Value: Decodable>(_ key: MetaKey, as type: Value.Type = Value.self) throws -> Value? {
        try Meta.value(db, key)
    }

    public func setMeta(_ key: MetaKey, to value: some Encodable) throws {
        try Meta.set(db, key, to: value)
    }
}
