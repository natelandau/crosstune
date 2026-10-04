import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// Everything the catalog screen shows at one moment, worked out once per redraw.
public struct CatalogResults: Sendable {
    /// Every tune in the catalog, archived included.
    public let entries: [CatalogEntry]
    /// The instruments the musician plays, whose tunings rows name.
    public let instruments: Set<String>
    /// The filters in force: the stored ones with any hidden facet cleared.
    public let filters: CatalogFilters
    public let facetValues: [CatalogFacet: [String]]
    /// The facets worth offering, in sheet order.
    public let facets: [CatalogFacet]
    /// The tunes the filters and the query let through.
    public let visible: [CatalogEntry]
    public let outcome: SearchOutcome
    /// The tunes the archived setting lets through, the whole of "11 of 84 tunes".
    public let total: Int
    public let archivedCount: Int
    /// The attributes the Missing picker offers.
    public let missingChoices: [MissingAttribute]

    public var countLabel: String { CatalogSearch.countLabel(visible: visible.count, total: total) }

    /// The facet's choices, with a set value the catalog no longer holds kept, so a stale filter
    /// never reads as Any.
    public func choices(_ facet: CatalogFacet) -> [String] {
        CatalogSearch.choices(facetValues[facet] ?? [], set: filters[facet])
    }

    /// The Missing picker's options, with a set attribute no tune holds any more kept, so the
    /// picker never reads as Any.
    public var missingOptions: [MissingAttribute] {
        guard let set = filters.missing, !missingChoices.contains(set) else { return missingChoices }
        return missingChoices + [set]
    }

    /// The visible facets the filter sheet sets.
    public var sheetFacets: [CatalogFacet] { sheetFacets(railsOnScreen: true) }

    /// The visible facets the filter sheet sets, with the key and type rails on the screen or,
    /// when `railsOnScreen` is false, in the sheet.
    public func sheetFacets(railsOnScreen: Bool) -> [CatalogFacet] {
        facets.filter { $0.isInSheet(railsOnScreen: railsOnScreen) }
    }
}

/// What the catalog says as a whole, worked out when the stored tunes or the instruments change
/// rather than on every keystroke of a search.
struct CatalogOverview: Sendable {
    let entries: [CatalogEntry]
    let instruments: Set<String>
    let facetValues: [CatalogFacet: [String]]
    let facets: [CatalogFacet]
    let archivedCount: Int
    let missingChoices: [MissingAttribute]

    init(entries: [CatalogEntry], instruments: Set<String>) {
        self.entries = entries
        self.instruments = instruments
        facetValues = CatalogSearch.facetValues(entries)
        facets = CatalogSearch.visibleFacets(facetValues, instruments: instruments)
        archivedCount = entries.count(where: \.isArchived)
        let facets = facets
        // A tuning for an instrument not played is cleared from the filters, so offering it
        // would snap back to Any.
        missingChoices = CatalogSearch.missingChoices(entries).filter { attribute in
            attribute.tuningFacet.map(facets.contains) ?? true
        }
    }
}

/// The catalog screen's state: the live catalog, the persisted filters, the musician's
/// instruments, and the search query.
///
/// One model lives as long as the signed-in shell, so the query lasts the app session and
/// signing out drops it; the filters persist in the store.
@MainActor
@Observable
public final class CatalogModel {
    public static let filterSaveError = "The filters could not be saved."
    /// Shown when a write fails without a message of its own.
    public static let actionFailed = "Something went wrong"

    /// The search text.
    public var query = ""
    /// The last filter write failure, cleared by the next write that lands.
    public private(set) var filterError: String?
    /// The last row action failure, cleared by the next action.
    public private(set) var actionError: String?

    private let store: CrosstuneStore
    private let entries: LiveQuery<[CatalogEntry]?>
    private let storedFilters: LiveQuery<CatalogFilters?>
    private let instruments: LiveQuery<Set<String>?>
    /// The filters as the screen shows them: a change is applied here at once and written after.
    private var filters: CatalogFilters?
    private var writesInFlight = 0
    private var overview: CatalogOverview?
    /// Counts each time the stored tunes or instruments are read anew, so a screen can tell a
    /// catalog change from a search.
    public private(set) var catalogRevision = 0
    @ObservationIgnored private var following: [Task<Void, Never>] = []
    /// The count as last read out, or as first loaded.
    @ObservationIgnored private var spokenCount: String?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "catalog")

    public init(store: CrosstuneStore) {
        self.store = store
        entries = LiveQuery(store, initial: nil) { try Self.fetchEntries($0, withHeard: true) }
        storedFilters = LiveQuery(store, initial: nil) { db in
            CatalogFilters(stored: try MetaKey.catalogFilters.value(in: db, as: JSONValue.self))
        }
        let settingsRow = settingsID(clerkUserID: store.userID)
        instruments = LiveQuery(store, initial: nil) { db in
            guard let row = try UserSettings.fetchOne(db, key: settingsRow), row.deletedAt == nil else { return [] }
            return Set(row.instruments)
        }
        let stored = storedFilters
        let entries = entries
        let instruments = instruments
        following = [
            Task { [weak self] in
                for await value in Observations({ @MainActor in stored.value }) {
                    self?.storedFiltersChanged(value)
                }
            },
            Task { [weak self] in
                for await (entries, instruments) in Observations({ @MainActor in (entries.value, instruments.value) }) {
                    guard let entries, let instruments else { continue }
                    self?.overview = CatalogOverview(entries: entries, instruments: instruments)
                    self?.catalogRevision += 1
                }
            },
        ]
    }

    isolated deinit {
        for task in following { task.cancel() }
    }

    /// Every active tune with its user row, sorted by title.
    nonisolated static func fetchEntries(_ db: Database) throws -> [CatalogEntry] {
        try fetchEntries(db, withHeard: false)
    }

    /// ``fetchEntries(_:)``, and with `withHeard` the tunes holding a live recording or link
    /// marked heard. Only the catalog filters on it, so other readers skip the two extra reads.
    nonisolated static func fetchEntries(_ db: Database, withHeard: Bool) throws -> [CatalogEntry] {
        var heard: Set<String> = []
        if withHeard {
            heard.formUnion(
                try String.fetchAll(
                    db,
                    Recording.filter(Recording.CodingKeys.deletedAt == nil && Recording.CodingKeys.tuneID != nil)
                        .select(Recording.CodingKeys.tuneID)))
            heard.formUnion(
                try String.fetchAll(
                    db,
                    RecordingLink.filter(RecordingLink.CodingKeys.deletedAt == nil)
                        .select(RecordingLink.CodingKeys.tuneID)))
        }
        return CatalogSearch.entries(
            tunes: try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchAll(db),
            userTunes: try UserTune.filter(UserTune.CodingKeys.deletedAt == nil).fetchAll(db), heard: heard)
    }

    /// A stored change from elsewhere, such as another window, replaces what the screen shows.
    /// While this model's own writes are in flight the store may still hold an older value, so
    /// the last write's result stands in for it instead.
    private func storedFiltersChanged(_ value: CatalogFilters?) {
        guard writesInFlight == 0, let value else { return }
        filters = value
    }

    /// Whether a filter change is still being written.
    public var isSavingFilters: Bool { writesInFlight > 0 }

    /// Nil until the catalog, the filters, and the instruments have all been read.
    public var results: CatalogResults? {
        guard let overview, let filters else { return nil }
        let entries = overview.entries
        let effective = filters.clearingHidden(visible: overview.facets)
        let visible = CatalogSearch.filter(entries, by: effective, query: query)
        return CatalogResults(
            entries: entries, instruments: overview.instruments, filters: effective,
            facetValues: overview.facetValues, facets: overview.facets, visible: visible,
            outcome: SearchOutcome(
                entries: entries, visible: visible, query: query, archivedShown: effective.archived),
            total: effective.archived ? entries.count : entries.count - overview.archivedCount,
            archivedCount: overview.archivedCount, missingChoices: overview.missingChoices)
    }

    /// The count to read out after the filters or the stored tunes change, or nil when its
    /// wording is what the musician last heard. The first count loaded is only remembered, so the
    /// screen stays quiet on load.
    public func countToAnnounce() -> String? {
        guard let label = results?.countLabel else { return nil }
        defer { spokenCount = label }
        guard let spoken = spokenCount, spoken != label else { return nil }
        return label
    }

    /// Changes the filters: shown at once, then written onto the stored row. Every write also
    /// clears the facets the screen cannot show, so none narrows the catalog in silence.
    public func updateFilters(_ change: @escaping @Sendable (inout CatalogFilters) -> Void) {
        guard let current = filters, let facets = overview?.facets else { return }
        let apply: @Sendable (CatalogFilters) -> CatalogFilters = { filters in
            var next = filters.clearingHidden(visible: facets)
            change(&next)
            return next
        }
        write(apply, showing: apply(current))
    }

    /// Replaces every filter with `next`, written even before the catalog has been read, so a
    /// filter set from another screen is never dropped. Once the catalog is read, hidden facets
    /// are cleared as ``updateFilters(_:)`` clears them.
    public func replaceFilters(with next: CatalogFilters) {
        let facets = overview?.facets
        let apply: @Sendable (CatalogFilters) -> CatalogFilters = { _ in
            facets.map { next.clearingHidden(visible: $0) } ?? next
        }
        write(apply, showing: apply(next))
    }

    /// Shows `shown` at once, then writes `apply` onto the stored row.
    private func write(_ apply: @escaping @Sendable (CatalogFilters) -> CatalogFilters, showing shown: CatalogFilters) {
        filters = shown
        writesInFlight += 1
        Task {
            do {
                // Merged onto the row read inside the transaction, so each write builds on the
                // one before it rather than on a value read before it.
                let written = try await store.write { writer in
                    let next = apply(CatalogFilters(stored: try writer.meta(.catalogFilters, as: JSONValue.self)))
                    try writer.setMeta(.catalogFilters, to: next.stored)
                    return next
                }
                filterError = nil
                writesInFlight -= 1
                if writesInFlight == 0 { filters = written }
            } catch {
                Self.logger.warning("Could not save the catalog filters: \(error)")
                filterError = Self.filterSaveError
                writesInFlight -= 1
                if writesInFlight == 0, let stored = storedFilters.value { filters = stored }
            }
        }
    }

    /// Opens the new tune form, ending any search: a tune created from a search ends that search,
    /// whatever the form's outcome.
    public func newTune(title: String? = nil) -> TuneFormTarget {
        query = ""
        return .new(title: title)
    }

    /// Archives or unarchives one tune.
    public func setArchived(_ entry: CatalogEntry, archived: Bool) async {
        actionError = nil
        do {
            try await Commands(store: store).setArchived(entry.userTune.id, archived: archived)
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? Self.actionFailed
        }
    }
}
