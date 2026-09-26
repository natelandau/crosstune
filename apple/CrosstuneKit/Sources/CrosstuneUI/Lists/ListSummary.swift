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
        "\(CatalogSearch.tunes(count)) · \(EditedText.label(lastEditedAt, now: now))"
    }

    /// Every live list in the musician's order.
    nonisolated static func fetchAll(_ db: Database) throws -> [ListSummary] {
        let lists = activeByPosition(try TuneList.fetchAll(db))
        let items = Dictionary(grouping: try ListItem.fetchAll(db), by: \.listID)
        return lists.map { list in
            let own = items[list.id] ?? []
            return ListSummary(
                list: list, count: own.count(where: { $0.deletedAt == nil }),
                lastEditedAt: own.map(\.updatedAt).reduce(list.updatedAt, max))
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
