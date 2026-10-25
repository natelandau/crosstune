import CrosstuneAnalytics
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
    private let entries: LiveQuery<[SearchableEntry]?>
    private let members: LiveQuery<Set<String>?>
    private let storedInstruments: LiveQuery<Set<String>?>
    private var adding: Set<String> = []
    /// True from a create until it lands or fails, so a second press or Return makes no second tune.
    @ObservationIgnored private var isCreating = false
    @ObservationIgnored private var isClosed = false
    /// Takes a failure that lands after the sheet has closed, which has no line of its own left.
    @ObservationIgnored private let onLateFailure: @MainActor (String) -> Void
    private let analytics: AnalyticsClient
    /// Tunes this visit added, reported together once the picker has closed and every add has
    /// landed.
    @ObservationIgnored private var added = 0
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune-picker")

    public init(
        store: CrosstuneStore, listID: String, analytics: AnalyticsClient = .noop,
        onLateFailure: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.store = store
        self.analytics = analytics
        self.listID = listID
        self.onLateFailure = onLateFailure
        // Folded on the store's reader rather than on each keystroke.
        entries = LiveQuery(store, initial: nil) { try CatalogModel.fetchEntries($0).map(SearchableEntry.init) }
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
        let matches = isIdle ? [] : CatalogSearch.matching(entries, query: query)
        return Results(
            rows: matches.prefix(Self.maxResults).map { Row(entry: $0.entry, isTaken: members.contains($0.id)) },
            matches: matches.map(\.entry),
            outcome: SearchOutcome(entries: entries, visible: matches, query: query, archivedShown: true))
    }

    /// The whole catalog A to Z while the search field is empty, archived tunes included; empty
    /// once something is typed, when ``results`` takes over. Nil until the catalog and the list
    /// are read. The catalog is read in that order, so nothing sorts it on each redraw.
    public var idleResults: [Row]? {
        guard let entries = entries.value, let members = members.value else { return nil }
        guard isIdle else { return [] }
        return entries.map { Row(entry: $0.entry, isTaken: members.contains($0.id)) }
    }

    /// Whether the idle picker has nothing to list, so its sheet says what it is for.
    public var showsHint: Bool { isIdle && members.value != nil && entries.value?.isEmpty == true }

    /// Adds a tune to the list and clears the search for the next. A tune already in the list,
    /// or one whose add is running, is left alone.
    public func pick(_ entry: CatalogEntry) async {
        let userTuneID = entry.userTune.id
        guard members.value?.contains(userTuneID) == false, adding.insert(userTuneID).inserted else { return }
        defer {
            adding.remove(userTuneID)
            reportIfDone()
        }
        query = ""
        failure = nil
        let listID = listID
        do {
            try await Commands(store: store).addToList(listID, userTuneID: userTuneID)
            added += 1
        } catch {
            Self.logger.warning("A tune pick failed: \(error)")
            if isClosed {
                onLateFailure(failureMessage(error))
            } else {
                failure = failureMessage(error)
            }
        }
    }

    /// Creates a tune by the typed title and adds it to the list. The picker stays open with the
    /// search as typed, so the new tune shows among the results as in this list. A list that
    /// refused it leaves the tune made, with the refusal on the sheet.
    public func create(_ title: String) async {
        guard !isCreating else { return }
        isCreating = true
        defer { isCreating = false }
        failure = nil
        do {
            let created = try await Commands(store: store).createTitleOnly(
                title: title, source: .list, listID: listID, analytics: analytics)
            if let refusal = created.filingError { throw refusal }
        } catch {
            Self.logger.warning("A tune could not be created from the picker: \(error)")
            if isClosed {
                onLateFailure(failureMessage(error))
            } else {
                failure = failureMessage(error)
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
        reportIfDone()
    }

    private func reportIfDone() {
        guard isClosed, adding.isEmpty, added > 0 else { return }
        analytics.send(.tunesAddedToList(listID: listID, count: added))
        added = 0
    }
}
