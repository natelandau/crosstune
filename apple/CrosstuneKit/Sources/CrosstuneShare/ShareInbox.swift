import Foundation
import os

/// Items the share extension saved for the app to add. Each item is a folder holding `item.json`
/// and, for audio, the file.
public enum ShareInbox {
    static let itemFile = "item.json"
    /// Names a folder still being written. Never listed, so the app never reads half an item.
    static let partialPrefix = ".partial-"
    /// How long a folder still being written, or a copy on its way in, may sit before it counts as
    /// left behind by an extension that was stopped mid-save. No save takes near this long.
    static let abandonedAfter: TimeInterval = 60 * 60
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-inbox")

    static func folder(userID: String, in container: ShareContainer) -> URL {
        container.userFolder(userID).appending(path: "inbox", directoryHint: .isDirectory)
    }

    static func incomingFolder(userID: String, in container: ShareContainer) -> URL {
        container.userFolder(userID).appending(path: "incoming", directoryHint: .isDirectory)
    }

    /// A scratch name that starts with when it was made, so its age reads from the name and never
    /// from file dates.
    private static func scratchName(at date: Date) -> String {
        "\(ShareTime.milliseconds(date))-\(UUID().uuidString)"
    }

    /// Saves `item` to the inbox. An audio item needs `audioFrom`, and a link takes none. The file
    /// at `audioFrom` is consumed: moved into the inbox on success, and removed on failure. Items
    /// shared at the same moment are added in `order`.
    public static func add(
        _ item: ShareItem, audioFrom: URL?, order: Int = 0, userID: String, in container: ShareContainer
    ) throws {
        let inbox = folder(userID: userID, in: container)
        let partial = inbox.appending(path: partialPrefix + scratchName(at: .now), directoryHint: .isDirectory)
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: partial, withIntermediateDirectories: true)
            switch (item, audioFrom) {
            case (.audio(let fileName, _, _, _), let audioFrom?) where isPlainName(fileName):
                try manager.moveItem(at: audioFrom, to: partial.appending(path: fileName))
            case (.link, nil):
                break
            default:
                throw CocoaError(.fileWriteInvalidFileName)
            }
            try ShareFile.writeJSON(item, to: partial.appending(path: itemFile))
            // Zero-padded, so names that share a time sort by order.
            let position = String(format: "%04d", order)
            let name = "\(item.sharedAt)-\(position)-\(UUID().uuidString)"
            try manager.moveItem(at: partial, to: inbox.appending(path: name))
        } catch {
            try? manager.removeItem(at: partial)
            if let audioFrom { try? manager.removeItem(at: audioFrom) }
            throw error
        }
    }

    /// The complete items, oldest first. An item that cannot be read is skipped.
    public static func pending(userID: String, in container: ShareContainer) -> [PendingItem] {
        items(userID: userID, in: container).map { folder, item in
            var audioFile: URL?
            if case .audio(let fileName, _, _, _) = item, isPlainName(fileName) {
                let file = folder.appending(path: fileName)
                if FileManager.default.fileExists(atPath: file.path) { audioFile = file }
            }
            return PendingItem(folder: folder, item: item, audioFile: audioFile)
        }
    }

    /// Each complete item's folder and contents, oldest first, with no check of an audio file.
    private static func items(userID: String, in container: ShareContainer) -> [(folder: URL, item: ShareItem)] {
        let inbox = folder(userID: userID, in: container)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: inbox.path) else { return [] }
        let items = names.filter { !$0.hasPrefix(".") }.compactMap { name -> (Int64, String, URL, ShareItem)? in
            let folder = inbox.appending(path: name, directoryHint: .isDirectory)
            guard let item = ShareFile.readJSON(ShareItem.self, from: folder.appending(path: itemFile)) else {
                return nil
            }
            return (timePrefix(of: name[...]) ?? 0, name, folder, item)
        }
        return items.sorted { ($0.0, $0.1) < ($1.0, $1.1) }.map { ($0.2, $0.3) }
    }

    /// Removes an item once the app has added it.
    public static func remove(_ item: PendingItem) throws {
        try FileManager.default.removeItem(at: item.folder)
    }

    /// Tunes made in the share extension that the app has not created yet, so a second share can
    /// pick one before the app opens.
    public static func pendingNewTunes(userID: String, in container: ShareContainer) -> [ShareTuneEntry] {
        items(userID: userID, in: container).compactMap {
            guard case .link(_, _, .new(let id, let title), _) = $0.item else { return nil }
            return ShareTuneEntry(id: id, title: title, detail: nil)
        }
    }

    /// A new empty folder for files on their way into the inbox. It shares the inbox's volume, so
    /// ``add(_:audioFrom:order:userID:in:)`` moves a file in without a second copy, and it goes with
    /// the user's folder when the user leaves.
    public static func newIncomingFolder(
        userID: String, in container: ShareContainer, now: Date = .now
    ) throws -> URL {
        removeAbandoned(userID: userID, in: container, now: now)
        let folder = incomingFolder(userID: userID, in: container).appending(
            path: scratchName(at: now), directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// Removes copies on their way in, items still being written, and items that cannot be read
    /// that are older than ``abandonedAfter``: what an extension stopped mid-save leaves, and
    /// what no pass can add. A name that gives no time counts as abandoned, since only this type
    /// makes them.
    public static func removeAbandoned(userID: String, in container: ShareContainer, now: Date = .now) {
        let cutoff = ShareTime.milliseconds(now) - Int64(abandonedAfter * 1000)
        let manager = FileManager.default
        func isAbandoned(_ name: Substring) -> Bool {
            guard let made = timePrefix(of: name) else { return true }
            return made < cutoff
        }
        let incoming = incomingFolder(userID: userID, in: container)
        for name in (try? manager.contentsOfDirectory(atPath: incoming.path)) ?? [] where isAbandoned(name[...]) {
            try? manager.removeItem(at: incoming.appending(path: name))
        }
        let inbox = folder(userID: userID, in: container)
        for name in (try? manager.contentsOfDirectory(atPath: inbox.path)) ?? [] {
            let entry = inbox.appending(path: name, directoryHint: .isDirectory)
            if name.hasPrefix(partialPrefix) {
                if isAbandoned(name.dropFirst(partialPrefix.count)) { try? manager.removeItem(at: entry) }
            } else if !name.hasPrefix("."), isAbandoned(name[...]),
                ShareFile.readJSON(ShareItem.self, from: entry.appending(path: itemFile)) == nil
            {
                logger.warning("A shared item that cannot be read was removed")
                try? manager.removeItem(at: entry)
            }
        }
    }

    /// The millisecond a scratch or item name starts with, or nil when it gives none.
    private static func timePrefix(of name: Substring) -> Int64? {
        name.split(separator: "-", maxSplits: 1).first.flatMap { Int64($0) }
    }

    /// A single path component, so a stored name can never point outside its item's folder.
    private static func isPlainName(_ name: String) -> Bool {
        !name.isEmpty && name != "." && name != ".." && !name.contains("/")
    }
}
