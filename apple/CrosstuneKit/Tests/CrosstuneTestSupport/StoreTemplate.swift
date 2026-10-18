import Foundation
import Synchronization

@testable import CrosstuneStore

/// Store folders made once per test process and copied into each test's root, so a test opens a
/// store without paying again for the migrations or for the rows its template holds.
public enum StoreTemplate {
    private static let templateUser = "template"
    private static let migrated = Mutex<URL?>(nil)
    @MainActor private static var made: [String: Task<URL, any Error>] = [:]

    /// Copies a migrated, empty store into `root` as `userID`'s, unless `userID` already has one
    /// there, as a test that reopens its store does.
    static func copyMigrated(userID: String, into root: URL) throws {
        let template = try migrated.withLock { folder in
            if let folder { return folder }
            let made = try make { root in try CrosstuneStore.open(userID: templateUser, root: root) }
            folder = made
            return made
        }
        try copy(template, as: userID, into: root)
    }

    /// Opens a copy, as `userID`'s store in `root`, of the store `make` opens as `userID` in the
    /// root it is handed. `make` runs the first time `name` is asked for; later calls copy its store.
    @MainActor
    public static func open(
        _ name: String, userID: String, root: URL, make: @escaping @MainActor (URL) async throws -> CrosstuneStore
    ) async throws -> CrosstuneStore {
        let task =
            made[name]
            ?? Task {
                let templateRoot = scratchRoot()
                let store = try await make(templateRoot)
                try store.close()
                return try CrosstuneStore.folder(for: userID, in: templateRoot)
            }
        made[name] = task
        try copy(try await task.value, as: userID, into: root)
        return try CrosstuneStore.open(userID: userID, root: root)
    }

    private static func make(_ open: (URL) throws -> CrosstuneStore) throws -> URL {
        let root = scratchRoot()
        // Closing folds the write-ahead log into the database file, so the folder copies whole.
        try open(root).close()
        return try CrosstuneStore.folder(for: templateUser, in: root)
    }

    private static func scratchRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: "crosstune-template-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private static func copy(_ template: URL, as userID: String, into root: URL) throws {
        let folder = try CrosstuneStore.folder(for: userID, in: root)
        guard !FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)) else { return }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: template, to: folder)
    }
}
