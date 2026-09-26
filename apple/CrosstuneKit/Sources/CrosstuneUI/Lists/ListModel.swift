import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// A tune in a list: the item that puts it there, with the tune and the musician's row for it.
public struct ListEntry: Hashable, Sendable, Identifiable {
    public let item: ListItem
    public let tune: Tune
    public let userTune: UserTune

    public var id: String { item.id }
    public var isArchived: Bool { userTune.archivedAt != nil }
    public var catalogEntry: CatalogEntry { CatalogEntry(tune: tune, userTune: userTune) }
}

/// A live list and its tunes in stored order, archived ones included.
public struct ListContents: Hashable, Sendable {
    public let list: TuneList
    public let entries: [ListEntry]

    /// The list and every item whose tune is live, or nil when the list is gone.
    nonisolated static func fetch(_ db: Database, listID: String) throws -> ListContents? {
        guard let list = try TuneList.fetchOne(db, key: listID), list.deletedAt == nil else { return nil }
        let items = activeByPosition(try ListItem.filter(ListItem.CodingKeys.listID == listID).fetchAll(db))
        let userTunes = try UserTune.fetchAll(db, keys: items.map(\.userTuneID))
        let userTunesByID = Dictionary(userTunes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let tunes = try Tune.fetchAll(db, keys: userTunes.map(\.tuneID))
        let tunesByID = Dictionary(tunes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let entries = items.compactMap { item -> ListEntry? in
            guard let userTune = userTunesByID[item.userTuneID], userTune.deletedAt == nil,
                let tune = tunesByID[userTune.tuneID], tune.deletedAt == nil
            else { return nil }
            return ListEntry(item: item, tune: tune, userTune: userTune)
        }
        return ListContents(list: list, entries: entries)
    }
}

/// The list screen's state: the live list, the Show archived setting every list shares, the
/// musician's instruments, and the writes the screen makes, reorders shown at once.
@MainActor
@Observable
public final class ListModel {
    /// Where the screen stands with its list.
    public enum Phase: Equatable {
        /// Nothing read yet, which the screen shows as silence.
        case loading
        case shown(ListContents)
        /// A confirmed delete is running, or has landed while the screen leaves. Holds the name,
        /// so the screen does not flash the list as gone on its way out.
        case deleting(name: String)
        case gone
    }

    /// Said after a move, so a screen reader hears where the tune landed.
    public struct Announcement: Equatable {
        public let id: Int
        public let text: String
    }

    public let listID: String
    /// The last write failure, cleared by the next write.
    public private(set) var failure: String?
    /// The last move, for the screen to read out and to feel.
    public private(set) var announcement: Announcement?

    private let store: CrosstuneStore
    private let contents: LiveQuery<ListContents??>
    private let storedShowArchived: LiveQuery<Bool?>
    private let storedInstruments: LiveQuery<Set<String>?>
    private var moves = PendingMoves()
    /// Counts each read of the list, so a settled move can tell whether a read has landed since.
    private var revision = 0
    private var deletingName: String?
    @ObservationIgnored private var removing: Set<String> = []
    @ObservationIgnored private var lastWrite: Task<Void, Never>?
    @ObservationIgnored private var following: Task<Void, Never>?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "list")

    public init(store: CrosstuneStore, listID: String) {
        self.store = store
        self.listID = listID
        contents = LiveQuery(store, initial: nil) { db in .some(try ListContents.fetch(db, listID: listID)) }
        storedShowArchived = LiveQuery(store, initial: nil) { db in
            // Anything but a stored true reads as off, as the web reads it.
            (try? MetaKey.listShowArchived.value(in: db, as: Bool.self)) == true
        }
        let settingsRow = settingsID(clerkUserID: store.userID)
        storedInstruments = LiveQuery(store, initial: nil) { db in
            guard let row = try UserSettings.fetchOne(db, key: settingsRow), row.deletedAt == nil else { return [] }
            return Set(row.instruments)
        }
        let contents = contents
        following = Task { [weak self] in
            for await value in Observations({ @MainActor in contents.value }) {
                guard let self, case .some(let read) = value else { continue }
                revision += 1
                moves.retire(order: read?.entries.map(\.item.id) ?? [], revision: revision)
            }
        }
    }

    isolated deinit {
        following?.cancel()
    }

    public var phase: Phase {
        if let deletingName { return .deleting(name: deletingName) }
        switch contents.value {
        case nil: return .loading
        case .some(nil): return .gone
        case .some(.some(let contents)): return .shown(contents)
        }
    }

    /// The list as last read, or nil while loading, deleting, or gone.
    public var list: TuneList? {
        if case .shown(let contents) = phase { return contents.list }
        return nil
    }

    /// Whether list screens show archived tunes. Nil until read.
    public var showArchived: Bool? { storedShowArchived.value }

    /// The instruments the musician plays, empty until read.
    public var instruments: Set<String> { storedInstruments.value ?? [] }

    /// Every tune in the list, archived included, in stored order with the moves in flight
    /// replayed.
    public var entries: [ListEntry] {
        guard case .shown(let contents) = phase else { return [] }
        let byID = Dictionary(contents.entries.map { ($0.item.id, $0) }, uniquingKeysWith: { first, _ in first })
        return moves.apply(to: contents.entries.map(\.item.id)).compactMap { byID[$0] }
    }

    /// The tunes the screen shows, in order: every entry, less archived ones unless shown.
    public var rows: [ListEntry] {
        showArchived == true ? entries : entries.filter { !$0.isArchived }
    }

    /// The musician's rows of the tunes in the list, which a picker marks as already in it.
    public var members: Set<String> { Set(entries.map(\.userTune.id)) }

    /// The moves that go somewhere from this row among the rows on screen.
    func places(for entry: ListEntry) -> [MovePlace] {
        let rows = rows
        guard let index = rows.firstIndex(where: { $0.id == entry.id }) else { return [] }
        return MovePlace.places(at: index, count: rows.count)
    }

    /// Sends a row where the menu says, among the rows on screen when it is chosen.
    func move(_ entry: ListEntry, to place: MovePlace) {
        let rows = rows
        guard let index = rows.firstIndex(where: { $0.id == entry.id }) else { return }
        move(from: index, to: place.destination(from: index, count: rows.count))
    }

    /// Moves the row at `from` to where the row at `to` stands, among the rows on screen.
    public func move(from: Int, to: Int) {
        let rows = rows
        guard let move = ListMove(ids: rows.map(\.item.id), from: from, to: to) else { return }
        let said = "Moved \(rows[from].tune.title) to position \(to + 1) of \(rows.count)"
        let spoken = Announcement(id: (announcement?.id ?? 0) + 1, text: said)
        announcement = spoken
        failure = nil
        let handle = moves.begin(move)
        let previous = lastWrite
        let listID = listID
        let store = store
        // Chained, so the store applies the moves in the order they were made, which is the
        // order they replay in.
        lastWrite = Task {
            await previous?.value
            do {
                try await Commands(store: store).moveItem(listID: listID, itemID: move.itemID, targetID: move.targetID)
            } catch {
                Self.logger.warning("A list move failed: \(error)")
                moves.drop(handle)
                // The tune is back where it was, so this move's announcement would still claim it moved.
                if announcement == spoken { announcement = nil }
                failure = Self.message(error)
                return
            }
            // Taken before the read, or a read landing inside it would leave these two describing
            // different moments and neither able to retire the move.
            let shownRevision = revision
            guard let stored = try? await store.read({ db in try Self.storedOrder(db, listID: listID) }) else {
                // The write landed, so the store holds the move. With no read to say when the
                // screen catches up, following the store now beats waiting on an answer that is
                // not coming.
                moves.drop(handle)
                return
            }
            moves.settle(handle, revision: shownRevision, storedOrder: stored)
            if case .shown(let contents) = phase {
                moves.retire(order: contents.entries.map(\.item.id), revision: revision)
            }
        }
    }

    nonisolated private static func storedOrder(_ db: Database, listID: String) throws -> [String] {
        activeByPosition(try ListItem.filter(ListItem.CodingKeys.listID == listID).fetchAll(db)).map(\.id)
    }

    /// Takes a tune out of the list. A second press while the first is running does nothing.
    public func remove(_ entry: ListEntry) async {
        guard removing.insert(entry.item.id).inserted else { return }
        defer { removing.remove(entry.item.id) }
        await run { try await $0.removeFromList(entry.item.id) }
    }

    /// Adds a tune to the end of the list, or leaves it where it is when it is already there.
    public func add(userTuneID: String) async {
        let listID = listID
        await run { try await $0.addToList(listID, userTuneID: userTuneID) }
    }

    /// Shows or hides archived tunes on every list screen.
    public func setShowArchived(_ show: Bool) async {
        failure = nil
        do {
            try await store.setMeta(.listShowArchived, to: show)
        } catch {
            Self.logger.warning("Could not save the list archived setting: \(error)")
            failure = Self.message(error)
        }
    }

    /// Deletes the list, its tunes staying in the catalog. True once the delete has landed, when
    /// the screen should leave.
    public func delete() async -> Bool {
        guard let name = list?.name, deletingName == nil else { return false }
        deletingName = name
        let listID = listID
        let deleted = await run { try await $0.deleteList(listID) }
        if !deleted { deletingName = nil }
        return deleted
    }

    /// Shows a failure from a write this screen started but that finished elsewhere, such as a
    /// picker that has closed.
    func report(_ message: String) {
        failure = message
    }

    @discardableResult
    private func run(_ write: (Commands) async throws -> Void) async -> Bool {
        failure = nil
        do {
            try await write(Commands(store: store))
            return true
        } catch {
            Self.logger.warning("A list screen write failed: \(error)")
            failure = Self.message(error)
            return false
        }
    }

    static func message(_ error: any Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed
    }
}
