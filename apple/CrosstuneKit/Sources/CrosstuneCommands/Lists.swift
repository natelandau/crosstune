import CrosstuneStore
import Foundation
import GRDB

extension StoreWriter {
    /// A list's items that have not been tombstoned, in position order.
    func activeItems(listID: String) throws -> [ListItem] {
        activeByPosition(try ListItem.filter(Column("list_id") == listID).fetchAll(db))
    }

    /// Creates a list past every other active list.
    @discardableResult
    public func createList(_ name: String, at time: Timestamp = .now) throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CommandError.listNameRequired }
        let active = try TuneList.fetchAll(db).filter { $0.deletedAt == nil }
        let id = newID(at: time)
        try put(TuneList(id: id, createdAt: time, name: trimmed, position: nextPosition(active)), at: time)
        return id
    }

    /// Renames a live list. Refuses a name that trims to nothing or a missing list.
    public func renameList(_ listID: String, name: String, at time: Timestamp = .now) throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CommandError.listNameRequired }
        guard var list = try TuneList.fetchOne(db, key: listID), list.deletedAt == nil else {
            throw CommandError.listNotFound
        }
        list.name = trimmed
        try put(list, at: time)
    }

    /// Tombstones a list and its items, queuing only the list's own delete.
    public func deleteList(_ listID: String, at time: Timestamp = .now) throws {
        try tombstone(TuneList.self, id: listID, at: time)
        let items = try ListItem.filter(Column("list_id") == listID).fetchAll(db)
        for item in items {
            try tombstone(ListItem.self, id: item.id, at: time, enqueueDelete: false)
        }
    }

    /// Adds a tune to a list past its other items, or returns the item already there.
    @discardableResult
    public func addToList(_ listID: String, userTuneID: String, at time: Timestamp = .now) throws -> String {
        guard let list = try TuneList.fetchOne(db, key: listID), list.deletedAt == nil else {
            throw CommandError.listNotFound
        }
        let items = try activeItems(listID: listID)
        if let existing = items.first(where: { $0.userTuneID == userTuneID }) {
            return existing.id
        }
        let id = newID(at: time)
        try put(
            ListItem(id: id, createdAt: time, listID: listID, userTuneID: userTuneID, position: nextPosition(items)),
            at: time)
        return id
    }

    public func removeFromList(_ itemID: String, at time: Timestamp = .now) throws {
        try tombstone(ListItem.self, id: itemID, at: time)
    }

    /// Renumbers `ordered` from 0, writing only the items whose position changed.
    public func writeOrder(_ ordered: [ListItem], at time: Timestamp = .now) throws {
        for (position, item) in ordered.enumerated() where item.position != position {
            var moved = item
            moved.position = position
            try put(moved, at: time)
        }
    }

    /// Moves an item just past the target; see ``moveBeside(_:id:itemID:targetID:)``.
    public func moveItem(listID: String, itemID: String, targetID: String, at time: Timestamp = .now) throws {
        let items = try activeItems(listID: listID)
        try writeOrder(moveBeside(items, id: \.id, itemID: itemID, targetID: targetID), at: time)
    }
}

extension Commands {
    @discardableResult
    public func createList(_ name: String, at time: Timestamp = .now) async throws -> String {
        try await store.write { writer in try writer.createList(name, at: time) }
    }

    public func renameList(_ listID: String, name: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.renameList(listID, name: name, at: time) }
    }

    public func deleteList(_ listID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.deleteList(listID, at: time) }
    }

    @discardableResult
    public func addToList(_ listID: String, userTuneID: String, at time: Timestamp = .now) async throws -> String {
        try await store.write { writer in try writer.addToList(listID, userTuneID: userTuneID, at: time) }
    }

    public func removeFromList(_ itemID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.removeFromList(itemID, at: time) }
    }

    public func moveItem(listID: String, itemID: String, targetID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in
            try writer.moveItem(listID: listID, itemID: itemID, targetID: targetID, at: time)
        }
    }
}
