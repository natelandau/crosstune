import Foundation

/// The account's limits, written by the app so the share extension can refuse a file the server
/// would refuse.
public struct ShareAccount: Codable, Equatable, Sendable {
    public let maxFileBytes: Int

    public init(maxFileBytes: Int) {
        self.maxFileBytes = maxFileBytes
    }

    private static let fileName = "account.json"

    public static func write(_ account: ShareAccount, userID: String, in container: ShareContainer) throws {
        try ShareFile.writeJSON(account, named: fileName, userID: userID, in: container)
    }

    /// The written limits, or nil when the app has not written them.
    public static func read(userID: String, in container: ShareContainer) -> ShareAccount? {
        ShareFile.readJSON(ShareAccount.self, named: fileName, userID: userID, in: container)
    }
}
