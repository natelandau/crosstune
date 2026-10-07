import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB

/// A list as the lists screen and the pickers show it: its name, how many tunes it holds, and
/// when it was last edited.
public struct ListSummary: Hashable, Sendable, Identifiable {
    public let list: TuneList
    public let count: Int
    /// The newest edit across the list and its items. A removed item counts, since removing a
    /// tune edits the list.
    public let lastEditedAt: Timestamp

    public init(list: TuneList, count: Int, lastEditedAt: Timestamp) {
        self.list = list
        self.count = count
        self.lastEditedAt = lastEditedAt
    }

    public var id: String { list.id }
    public var name: String { list.name }

    /// "5 tunes · Edited today", the row's second line.
    public func details(now: Date = .now) -> String {
        ListRow.detail(count: count, edited: lastEditedAt, now: now)
    }

    /// Every live list in the musician's order.
    nonisolated static func fetchAll(_ db: Database) throws -> [ListSummary] {
        let lists = activeByPosition(try TuneList.fetchAll(db))
        // A stored timestamp sorts as text in time order, so MAX finds the newest edit.
        let rows = try Row.fetchAll(
            db,
            sql: """
                SELECT list_id, SUM(deleted_at IS NULL) AS live, MAX(updated_at) AS edited
                FROM list_items GROUP BY list_id
                """)
        let items = Dictionary(
            rows.map { row -> (String, (live: Int, edited: Timestamp?)) in
                (row["list_id"], (row["live"], row["edited"]))
            },
            uniquingKeysWith: { first, _ in first })
        return lists.map { list in
            let own = items[list.id]
            return ListSummary(
                list: list, count: own?.live ?? 0,
                lastEditedAt: max(list.updatedAt, own?.edited ?? list.updatedAt))
        }
    }
}

/// The words for deleting a list, on every screen that offers it.
public enum DeleteListMessage {
    public static let delete = "Delete"
    /// What deleting a list does to its tunes.
    public static let message = "Its tunes stay in the catalog."

    /// `Delete "Tuesday session"?`
    public static func title(_ name: String) -> String {
        "Delete \"\(name)\"?"
    }
}
