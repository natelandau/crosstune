import GRDB

/// Live rows in a signed-in user's account: the tunes they keep, the lists they made, and the
/// recordings they hold, the same tables the web client counts before it warns of a delete.
public struct AccountCounts: Equatable, Sendable {
    public let tunes: Int
    public let lists: Int
    public let recordings: Int

    public init(tunes: Int, lists: Int, recordings: Int) {
        self.tunes = tunes
        self.lists = lists
        self.recordings = recordings
    }
}

extension CrosstuneStore {
    /// How many tunes, lists, and recordings a delete would erase, counting live rows only so a
    /// soft-deleted row already gone from every screen is not counted again.
    public func accountCounts() async throws -> AccountCounts {
        try await read { db in
            AccountCounts(
                tunes: try UserTune.filter(UserTune.CodingKeys.deletedAt == nil).fetchCount(db),
                lists: try TuneList.filter(TuneList.CodingKeys.deletedAt == nil).fetchCount(db),
                recordings: try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchCount(db)
            )
        }
    }
}
