import Foundation

/// A tune as the share extension lists it.
public struct ShareTuneEntry: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let title: String
    /// A second line that tells apart tunes with the same title.
    public let detail: String?

    public init(id: String, title: String, detail: String?) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

/// The user's tunes, written by the app for the share extension to search.
public enum ShareTuneList {
    private static let fileName = "tunes.json"

    public static func write(_ entries: [ShareTuneEntry], userID: String, in container: ShareContainer) throws {
        try ShareFile.writeJSON(entries, named: fileName, userID: userID, in: container)
    }

    /// The written list, or empty when there is none.
    public static func read(userID: String, in container: ShareContainer) -> [ShareTuneEntry] {
        ShareFile.readJSON([ShareTuneEntry].self, named: fileName, userID: userID, in: container) ?? []
    }
}
