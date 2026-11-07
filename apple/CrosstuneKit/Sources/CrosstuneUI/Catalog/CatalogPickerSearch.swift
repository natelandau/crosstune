import CrosstuneCommands
import CrosstuneStore
import Foundation

/// The search a tune picker runs over the whole catalog A to Z, archived tunes included: the
/// catalog and the musician's instruments, read on the store's reader, and what a query finds.
@MainActor
final class CatalogPickerSearch {
    /// The catalog as read, each entry folded for search once rather than on each keystroke.
    struct Catalog: Sendable {
        let searchable: [SearchableEntry]
        let entries: [CatalogEntry]

        nonisolated init(_ entries: [CatalogEntry]) {
            self.entries = entries
            searchable = entries.map(SearchableEntry.init)
        }
    }

    /// What a query finds: every match, and what Return or the add row offers for it.
    struct Found {
        let matches: [SearchableEntry]
        let outcome: SearchOutcome
    }

    private let store: CrosstuneStore
    private let catalog: LiveQuery<Catalog?>
    /// The catalog ``load()`` read, used until the live query publishes its first value.
    private var loaded: Catalog?
    private let storedInstruments: LiveQuery<Set<String>?>

    init(store: CrosstuneStore) {
        self.store = store
        catalog = LiveQuery(store, initial: nil) { Catalog(try CatalogModel.fetchEntries($0)) }
        let settingsRow = settingsID(clerkUserID: store.userID)
        storedInstruments = LiveQuery(store, initial: nil) { db in
            guard let row = try UserSettings.fetchOne(db, key: settingsRow), row.deletedAt == nil else { return [] }
            return Set(row.instruments)
        }
    }

    /// Whether `query` holds nothing to search for.
    nonisolated static func isIdle(_ query: String) -> Bool {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The instruments the musician plays, for the tunings each row shows. A row shows no tunings
    /// until they are read, rather than the results waiting on them.
    var instruments: Set<String> { storedInstruments.value ?? [] }

    /// Reads the catalog once, so a picker can show it without waiting on the live query.
    func load() async throws {
        guard current == nil else { return }
        loaded = try await store.read { Catalog(try CatalogModel.fetchEntries($0)) }
    }

    /// The live query's catalog once it has one, which follows every later write.
    private var current: Catalog? { catalog.value ?? loaded }

    /// The catalog A to Z, nil until read.
    var entries: [CatalogEntry]? { current?.entries }

    /// What `query` finds, with no matches while it is idle. Nil until the catalog is read: an
    /// unread catalog looks like one holding no such tune, and would offer to start a tune that
    /// is already there.
    func find(_ query: String) -> Found? {
        guard let catalog = current else { return nil }
        let matches = Self.isIdle(query) ? [] : CatalogSearch.matching(catalog.searchable, query: query)
        return Found(
            matches: matches,
            outcome: SearchOutcome(entries: catalog.searchable, visible: matches, query: query, archivedShown: true))
    }
}
