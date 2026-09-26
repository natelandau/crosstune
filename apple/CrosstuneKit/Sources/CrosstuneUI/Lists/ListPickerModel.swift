import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// What one successful pick in the list picker did, for a caller that offers to undo it.
public struct ListAddition: Sendable {
    public let listID: String
    public let listName: String
    /// How many of the tunes were added; a tune already in the list does not count again.
    public let added: Int
    /// True when the pick made the list rather than adding to one that already existed.
    public let created: Bool
    /// The items the pick added to an existing list.
    public let itemIDs: [String]
    /// The tunes the pick was over, which a made list is made with again on redo.
    public var userTuneIDs: [String] = []

    /// Takes the pick back: deletes a list it made, or removes the items it added.
    public func undo(with commands: Commands) async throws {
        if created {
            try await commands.deleteList(listID)
        } else {
            try await commands.removeTunesFromList(itemIDs)
        }
    }

    /// Makes the pick again after its undo: makes the list anew, or puts the added items back.
    /// Returns the pick as it now stands, for the next undo.
    public func redo(with commands: Commands) async throws -> ListAddition {
        guard created else {
            try await commands.restoreListItems(itemIDs)
            return self
        }
        let listID = try await commands.createListWithTunes(name: listName, userTuneIDs: userTuneIDs)
        return ListAddition(
            listID: listID, listName: listName, added: added, created: true, itemIDs: [], userTuneIDs: userTuneIDs)
    }
}

/// Asks for the list picker over one or more tunes.
public struct ListPickerRequest: Identifiable {
    public let id = UUID()
    public let userTuneIDs: [String]
    /// A fixed title; without one the picker names how many tunes it adds.
    public let title: String?
    /// A list left off the offered ones, such as the list already open.
    public let excludeListID: String?
    /// Runs after a pick lands, for a caller that offers to undo it.
    public let onAdded: (@MainActor (ListAddition) -> Void)?

    public init(
        userTuneIDs: [String], title: String? = nil, excludeListID: String? = nil,
        onAdded: (@MainActor (ListAddition) -> Void)? = nil
    ) {
        self.userTuneIDs = userTuneIDs
        self.title = title
        self.excludeListID = excludeListID
        self.onAdded = onAdded
    }
}

/// The list picker's state: the lists on offer with how many of the tunes each already holds,
/// and the one write a pick or a new list makes.
@MainActor
@Observable
public final class ListPickerModel {
    public static let noneInIt = "none in it"
    public static let allInIt = "all in it"

    /// One list on offer.
    public struct Row: Identifiable, Equatable {
        public let id: String
        public let name: String
        /// How much of the selection the list holds; nil until membership is read.
        public let note: String?
        /// False while membership is unread or the list already holds every tune.
        public let isOffered: Bool
    }

    public let userTuneIDs: [String]
    /// The name typed for a new list.
    public var newName = ""
    public private(set) var isPending = false
    /// Set once a pick lands; the picker never adds twice, so a second tap does nothing.
    public private(set) var isDone = false
    /// The last pick's failure, cleared by the next.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let excludeListID: String?
    private let lists: LiveQuery<[ListSummary]?>
    private let counts: LiveQuery<[String: Int]?>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "list-picker")

    public init(store: CrosstuneStore, userTuneIDs: [String], excludeListID: String? = nil) {
        self.store = store
        self.userTuneIDs = userTuneIDs
        self.excludeListID = excludeListID
        lists = LiveQuery(store, initial: nil) { db in try ListSummary.fetchAll(db) }
        let ids = userTuneIDs
        counts = LiveQuery(store, initial: nil) { db in try Self.membership(db, userTuneIDs: ids) }
    }

    /// `Add 3 tunes to a list`, the picker's title unless the caller fixes one.
    public static func title(count: Int) -> String {
        "Add \(CatalogSearch.tunes(count)) to a list"
    }

    /// How much of a selection of `total` tunes a list holding `inList` of them already has.
    public static func note(inList: Int, total: Int) -> String {
        if inList == 0 { return noneInIt }
        if total > 0 && inList >= total { return allInIt }
        return "\(inList) of \(total) in it"
    }

    /// How many of the tunes each list holds, keyed by list id.
    nonisolated static func membership(_ db: Database, userTuneIDs: [String]) throws -> [String: Int] {
        guard !userTuneIDs.isEmpty else { return [:] }
        let items = try ListItem.filter(userTuneIDs.contains(ListItem.CodingKeys.userTuneID))
            .filter(ListItem.CodingKeys.deletedAt == nil)
            .fetchAll(db)
        var counts: [String: Int] = [:]
        for item in items { counts[item.listID, default: 0] += 1 }
        return counts
    }

    /// Whether the lists have been read, so the picker can show its rows.
    public var isLoaded: Bool { lists.value != nil }

    /// Every list but the excluded one, in the musician's order.
    public var rows: [Row] {
        let total = Set(userTuneIDs).count
        let counts = counts.value
        return (lists.value ?? []).filter { $0.id != excludeListID }.map { summary in
            let inList = counts?[summary.id] ?? 0
            let full = total > 0 && inList >= total
            return Row(
                id: summary.id, name: summary.name, note: counts.map { _ in Self.note(inList: inList, total: total) },
                isOffered: counts != nil && !full)
        }
    }

    /// Adds the tunes the list lacks. What the pick did once it lands, nil when it could not run
    /// or failed, with the reason in ``failure``.
    public func add(to row: Row) async -> ListAddition? {
        guard row.isOffered else { return nil }
        let ids = userTuneIDs
        return await run { commands in
            let added = try await commands.addTunesToList(listID: row.id, userTuneIDs: ids)
            return ListAddition(
                listID: row.id, listName: row.name, added: added.added, created: false, itemIDs: added.itemIDs,
                userTuneIDs: ids)
        }
    }

    /// Makes a list by the typed name holding every tune. Nil for a name that trims to nothing.
    public func create() async -> ListAddition? {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        let ids = userTuneIDs
        return await run { commands in
            let listID = try await commands.createListWithTunes(name: name, userTuneIDs: ids)
            return ListAddition(
                listID: listID, listName: name, added: Set(ids).count, created: true, itemIDs: [], userTuneIDs: ids)
        }
    }

    private func run(_ write: (Commands) async throws -> ListAddition) async -> ListAddition? {
        guard !isPending, !isDone else { return nil }
        isPending = true
        failure = nil
        defer { isPending = false }
        do {
            let addition = try await write(Commands(store: store))
            isDone = true
            return addition
        } catch {
            Self.logger.warning("A list pick failed: \(error)")
            failure = ListModel.message(error)
            return nil
        }
    }
}
