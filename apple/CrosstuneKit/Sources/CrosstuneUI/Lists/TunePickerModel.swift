import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// The tune picker's state: a search over the whole catalog, archived tunes included, that adds
/// each picked tune to one list, several in one visit, and offers to create a tune by the typed
/// title.
@MainActor
@Observable
public final class TunePickerModel {
    public static let inThisList = "In this list"
    /// How many results show at once; a longer query narrows them.
    public static let maxResults = 8

    /// One search result.
    public struct Row: Identifiable, Equatable {
        public let entry: CatalogEntry
        /// Already in the list: shown, marked, and inert, so the picker never hides a tune.
        public let isTaken: Bool

        public var id: String { entry.id }

        /// The offered row's spoken name. Pickers search archived tunes on purpose, so the name
        /// says which ones they are.
        public var name: String {
            let add = "Add \(entry.tune.title)"
            return entry.isArchived ? "\(add), archived" : add
        }
    }

    /// What the search shows for the current query.
    public struct Results: Equatable {
        public let rows: [Row]
        /// Every match, beyond the rows shown.
        public let matches: [CatalogEntry]
        public let outcome: SearchOutcome
        /// `No tune called "query"`, when nothing carries the typed title.
        public var noTuneCalled: String? {
            guard matches.isEmpty, case .create(let title, false, _) = outcome else { return nil }
            return CatalogScreen.noTuneCalled(title)
        }
    }

    /// What Return in the search field asks the sheet to do, beyond a pick the model makes.
    public enum Submit: Equatable {
        case nothing
        case create(title: String)
        case dismissKeyboard
    }

    public let listID: String
    public var query = ""
    /// The last pick's failure while the sheet is open, cleared by the next pick.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let entries: LiveQuery<[CatalogEntry]?>
    private let members: LiveQuery<Set<String>?>
    private let storedInstruments: LiveQuery<Set<String>?>
    private var adding: Set<String> = []
    @ObservationIgnored private var isClosed = false
    /// Takes a failure that lands after the sheet has closed, which has no line of its own left.
    @ObservationIgnored private let onLateFailure: @MainActor (String) -> Void
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune-picker")

    public init(store: CrosstuneStore, listID: String, onLateFailure: @escaping @MainActor (String) -> Void = { _ in })
    {
        self.store = store
        self.listID = listID
        self.onLateFailure = onLateFailure
        entries = LiveQuery(store, initial: nil, fetch: CatalogModel.fetchEntries)
        members = LiveQuery(store, initial: nil) { db in
            Set(
                try ListItem.filter(ListItem.CodingKeys.listID == listID)
                    .filter(ListItem.CodingKeys.deletedAt == nil)
                    .fetchAll(db).map(\.userTuneID))
        }
        let settingsRow = settingsID(clerkUserID: store.userID)
        storedInstruments = LiveQuery(store, initial: nil) { db in
            guard let row = try UserSettings.fetchOne(db, key: settingsRow), row.deletedAt == nil else { return [] }
            return Set(row.instruments)
        }
    }

    /// The instruments the musician plays. A row shows no tunings until they are read, rather
    /// than the results waiting on them.
    public var instruments: Set<String> { storedInstruments.value ?? [] }

    /// Whether the search field is empty, when the sheet says what it is for.
    public var isIdle: Bool { query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Nil until the catalog and the list are read: an unread catalog looks like one holding no
    /// such tune, and would offer to create a tune that is already there.
    public var results: Results? {
        guard let entries = entries.value, let members = members.value else { return nil }
        let matches =
            isIdle ? [] : CatalogSearch.filter(entries, by: CatalogFilters(archived: true), query: query)
        return Results(
            rows: matches.prefix(Self.maxResults).map { Row(entry: $0, isTaken: members.contains($0.id)) },
            matches: matches,
            outcome: SearchOutcome(entries: entries, visible: matches, query: query, archivedShown: true))
    }

    /// Adds a tune to the list and clears the search for the next. A tune already in the list,
    /// or one whose add is running, is left alone.
    public func pick(_ entry: CatalogEntry) async {
        let userTuneID = entry.userTune.id
        guard members.value?.contains(userTuneID) == false, adding.insert(userTuneID).inserted else { return }
        defer { adding.remove(userTuneID) }
        query = ""
        failure = nil
        let listID = listID
        do {
            try await Commands(store: store).addToList(listID, userTuneID: userTuneID)
        } catch {
            Self.logger.warning("A tune pick failed: \(error)")
            if isClosed {
                onLateFailure(ListModel.message(error))
            } else {
                failure = ListModel.message(error)
            }
        }
    }

    /// Return opens the only match by adding it, or creates when nothing matches. Every match
    /// counts, the taken ones included, so Return never creates a title that exists; a lone
    /// taken match does nothing.
    public func submit() async -> Submit {
        guard let results else { return .nothing }
        switch SearchSubmit(query: query, visible: results.matches, outcome: results.outcome) {
        case .open(let tuneID):
            if let entry = results.matches.first(where: { $0.tune.id == tuneID }) { await pick(entry) }
            return .nothing
        case .create(let title):
            return .create(title: title)
        case .dismiss:
            return .dismissKeyboard
        }
    }

    /// The sheet has gone, so a failure still to land reports through `onLateFailure`.
    public func close() {
        isClosed = true
    }
}
