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
public final class TunePickerModel: TunePickerSource {
    public static let inThisList = "In this list"
    /// How many results show at once; a longer query narrows them.
    public static let maxResults = 8

    public typealias Row = TunePickerRow
    public typealias Results = TunePickerResults
    public typealias Submit = TunePickerSubmit

    public let listID: String
    public var query = ""
    /// The last pick's failure while the sheet is open, cleared by the next pick.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let search: CatalogPickerSearch
    private let members: LiveQuery<Set<String>?>
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
        search = CatalogPickerSearch(store: store)
        members = LiveQuery(store, initial: nil) { db in
            Set(
                try ListItem.filter(ListItem.CodingKeys.listID == listID)
                    .filter(ListItem.CodingKeys.deletedAt == nil)
                    .fetchAll(db).map(\.userTuneID))
        }
    }

    /// The instruments the musician plays. A row shows no tunings until they are read, rather
    /// than the results waiting on them.
    public var instruments: Set<String> { search.instruments }

    /// Whether the search field is empty, when the sheet says what it is for.
    public var isIdle: Bool { CatalogPickerSearch.isIdle(query) }

    /// Nil until the catalog and the list are read: an unread catalog looks like one holding no
    /// such tune, and would offer to create a tune that is already there.
    public var results: Results? {
        guard let members = members.value, let found = search.find(query) else { return nil }
        let matches = found.matches
        return Results(
            rows: matches.prefix(Self.maxResults).map { row($0.entry, members: members) },
            matches: matches.map(\.entry), outcome: found.outcome)
    }

    /// The whole catalog A to Z while the search field is empty, archived tunes included; empty
    /// once something is typed, when ``results`` takes over. Nil until the catalog and the list
    /// are read. The catalog is read in that order, so nothing sorts it on each redraw.
    public var idleResults: [Row]? {
        guard let entries = search.entries, let members = members.value else { return nil }
        guard isIdle else { return [] }
        return entries.map { row($0, members: members) }
    }

    /// A tune in the list shows, marked and inert, so the picker never hides a tune.
    private func row(_ entry: CatalogEntry, members: Set<String>) -> Row {
        Row(
            entry: entry, state: members.contains(entry.id) ? .taken : .open, action: "Add",
            instruments: instruments)
    }

    /// Whether the idle picker has nothing to list, so its sheet says what it is for.
    public var showsHint: Bool { isIdle && members.value != nil && search.entries?.isEmpty == true }

    /// Adds a tune to the list. The search stays as typed, so the next tune can be picked from
    /// the same results. A tune already in the list, or one whose add is running, is left alone.
    public func pick(_ entry: CatalogEntry) async {
        let userTuneID = entry.userTune.id
        guard members.value?.contains(userTuneID) == false, adding.insert(userTuneID).inserted else { return }
        defer {
            adding.remove(userTuneID)
            reportIfDone()
        }
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

    /// Return adds the only match, or creates when nothing matches. Every match counts, the
    /// taken ones included, so Return never creates a title that exists; a lone taken match
    /// does nothing.
    public func submit() async -> Submit {
        guard let results else { return .nothing }
        switch SearchSubmit(query: query, visible: results.matches, outcome: results.outcome) {
        case .open(let tuneID):
            guard let entry = results.matches.first(where: { $0.tune.id == tuneID }),
                members.value?.contains(entry.userTune.id) == false
            else { return .nothing }
            await pick(entry)
            return .picked
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
