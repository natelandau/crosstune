import Foundation

/// The App Group folder the app and the share extension both read: who is signed in, each user's
/// tune list and limits, and each user's inbox of shared items.
public struct ShareContainer: Sendable {
    public static let appGroupID = "group.app.crosstune.Crosstune"

    let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// The App Group's folder, or nil when this build lacks the entitlement.
    public static func appGroup() -> ShareContainer? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID).map {
            ShareContainer(root: $0)
        }
    }

    var shareFolder: URL { root.appending(path: "Share", directoryHint: .isDirectory) }

    private var currentFile: URL { shareFolder.appending(path: "current") }

    /// The signed-in user's ID, or nil when no one is signed in.
    public func currentUserID() -> String? {
        guard let data = try? ShareFile.read(currentFile),
            let id = String(data: data, encoding: .utf8), !id.isEmpty
        else { return nil }
        return id
    }

    /// Records who is signed in. Nil records that no one is.
    public func setCurrentUserID(_ id: String?) throws {
        guard let id else {
            try ShareFile.remove(currentFile)
            return
        }
        try ShareFile.write(Data(id.utf8), to: currentFile)
    }

    public func userFolder(_ userID: String) -> URL {
        shareFolder.appending(path: userID, directoryHint: .isDirectory)
    }

    /// Removes everything held for `userID`, including items not yet added to the app.
    public func removeUser(_ userID: String) throws {
        try ShareFile.remove(userFolder(userID))
    }

    /// Removes everything held for every user but those in `kept`.
    public func removeUsers(except kept: Set<String>) throws {
        let items =
            (try? FileManager.default.contentsOfDirectory(
                at: shareFolder, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for item in items where !kept.contains(item.lastPathComponent) {
            guard (try? item.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
            try ShareFile.remove(item)
        }
    }
}

/// Reads and writes the small files in the shared folder.
enum ShareFile {
    /// Another process can replace a shared file at any moment, so a read goes through a file
    /// handle, never a mapped `Data`.
    static func read(_ url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        return try handle.readToEnd() ?? Data()
    }

    /// Writes atomically, so the other process never reads half a file.
    static func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    /// Removes the item at `url`. One already gone is not an error.
    static func remove(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {}
    }

    static func writeJSON(_ value: some Encodable, to url: URL) throws {
        try write(try JSONEncoder().encode(value), to: url)
    }

    /// The decoded value, or nil when the file is missing or unreadable.
    static func readJSON<Value: Decodable>(_ type: Value.Type, from url: URL) -> Value? {
        guard let data = try? read(url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Writes `value` to the file `name` in `userID`'s folder.
    static func writeJSON(_ value: some Encodable, named name: String, userID: String, in container: ShareContainer)
        throws
    {
        try writeJSON(value, to: container.userFolder(userID).appending(path: name))
    }

    /// The value in the file `name` in `userID`'s folder, or nil when it is missing or unreadable.
    static func readJSON<Value: Decodable>(
        _ type: Value.Type, named name: String, userID: String, in container: ShareContainer
    ) -> Value? {
        readJSON(type, from: container.userFolder(userID).appending(path: name))
    }
}
