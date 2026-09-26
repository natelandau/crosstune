import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// A tune and the musician's own row for it: one entry in the catalog.
public struct CatalogEntry: Hashable, Sendable, Identifiable {
    public let tune: Tune
    public let userTune: UserTune

    public init(tune: Tune, userTune: UserTune) {
        self.tune = tune
        self.userTune = userTune
    }

    public var id: String { userTune.id }
    public var isArchived: Bool { userTune.archivedAt != nil }
}

/// The catalog's filters: status, one value per facet, and whether archived tunes show. Stored
/// in the meta table under `catalog_filters` in the web client's shape, so both read the same.
public struct CatalogFilters: Hashable, Sendable {
    /// The stored value of a filter that narrows nothing.
    nonisolated public static let any = "all"
    public static let `default` = CatalogFilters()

    /// Nil shows every status.
    public var status: String?
    /// Each set facet's value. A facet missing here narrows nothing.
    public var facets: [CatalogFacet: String]
    public var archived: Bool

    public init(status: String? = nil, facets: [CatalogFacet: String] = [:], archived: Bool = false) {
        self.status = status
        self.facets = facets
        self.archived = archived
    }

    /// The filters a stored value holds, with every missing or malformed field read as its
    /// default. Only current facet keys are read, so a filter stored under a retired key reads as
    /// Any and the next write drops it.
    public init(stored: JSONValue?) {
        guard case .object(let object) = stored ?? .null else {
            self.init()
            return
        }
        var status: String?
        if case .string(let value) = object["status"] ?? .null, Vocabulary.statuses.contains(value) {
            status = value
        }
        var facets: [CatalogFacet: String] = [:]
        for facet in CatalogFacet.all {
            if case .string(let value) = object[facet.storageKey] ?? .null, value != Self.any {
                facets[facet] = value
            }
        }
        self.init(status: status, facets: facets, archived: object["archived"] == .bool(true))
    }

    /// The value to store: every field, with `all` for one that narrows nothing.
    public var stored: JSONValue {
        var object: JSONObject = ["status": .string(status ?? Self.any), "archived": .bool(archived)]
        for facet in CatalogFacet.all {
            object[facet.storageKey] = .string(facets[facet] ?? Self.any)
        }
        return .object(object)
    }

    public subscript(facet: CatalogFacet) -> String? {
        get { facets[facet] }
        set { facets[facet] = newValue }
    }

    /// Clears every facet not in `visible`. A facet the musician cannot see must not narrow the
    /// list, and every write forgets it, so turning an instrument back on later does not bring a
    /// stale filter back with it.
    public func clearingHidden(visible: [CatalogFacet]) -> CatalogFilters {
        var filters = self
        for facet in CatalogFacet.all where !visible.contains(facet) {
            filters[facet] = nil
        }
        return filters
    }

    /// How many of the sheet's filters are set: the count on the Filters button and the gate on
    /// Reset. Status, key, and type sit on the screen, so they are not among them.
    public var sheetCount: Int { sheetCount(railsOnScreen: true) }

    /// ``sheetCount`` with the key and type rails on the screen or, when `railsOnScreen` is
    /// false, in the sheet.
    public func sheetCount(railsOnScreen: Bool) -> Int {
        facets.keys.count { $0.isInSheet(railsOnScreen: railsOnScreen) } + (archived ? 1 : 0)
    }

    /// These filters with the sheet's cleared and the screen's kept.
    public var sheetReset: CatalogFilters { sheetReset(railsOnScreen: true) }

    /// ``sheetReset`` with the key and type rails on the screen or, when `railsOnScreen` is
    /// false, in the sheet.
    public func sheetReset(railsOnScreen: Bool) -> CatalogFilters {
        CatalogFilters(status: status, facets: facets.filter { !$0.key.isInSheet(railsOnScreen: railsOnScreen) })
    }
}

/// Matching, sorting, and counting the catalog, ignoring case and accents throughout.
public enum CatalogSearch {
    nonisolated static let folding: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    /// Whether two strings are the same ignoring case and accents.
    public static func same(_ first: String, _ second: String) -> Bool {
        first.compare(second, options: folding, locale: Locale.current) == .orderedSame
    }

    /// Sorts ignoring case and accents, in the reader's locale.
    public static func precedes(_ first: String, _ second: String) -> Bool {
        first.compare(second, options: folding, locale: Locale.current) == .orderedAscending
    }

    /// Every active tune with its active user row, sorted by title.
    public static func entries(tunes: [Tune], userTunes: [UserTune]) -> [CatalogEntry] {
        let tunesByID = Dictionary(
            tunes.filter { $0.deletedAt == nil }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return
            userTunes
            .filter { $0.deletedAt == nil }
            .compactMap { userTune in tunesByID[userTune.tuneID].map { CatalogEntry(tune: $0, userTune: userTune) } }
            .sorted { first, second in
                if same(first.tune.title, second.tune.title) { return first.id < second.id }
                return precedes(first.tune.title, second.tune.title)
            }
    }

    /// True when the trimmed query equals the tune's title or an alternate title.
    public static func titleMatches(_ tune: Tune, query: String) -> Bool {
        let title = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return !title.isEmpty && ([tune.title] + tune.alternateTitles).contains { same($0, title) }
    }

    public static func hidingArchived(_ entries: [CatalogEntry], shown: Bool) -> [CatalogEntry] {
        shown ? entries : entries.filter { !$0.isArchived }
    }

    /// The entries the filters and the query let through, in catalog order. The query matches
    /// anywhere in a title, an alternate title, or the composer.
    public static func filter(_ entries: [CatalogEntry], by filters: CatalogFilters, query: String = "")
        -> [CatalogEntry]
    {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return hidingArchived(entries, shown: filters.archived).filter { entry in
            if let status = filters.status, entry.userTune.status != status { return false }
            for (facet, value) in filters.facets {
                guard facet.values(of: entry.tune).contains(where: { $0.map { same(value, $0) } ?? false })
                else { return false }
            }
            guard !needle.isEmpty else { return true }
            let haystack = [entry.tune.title] + entry.tune.alternateTitles + [entry.tune.composer ?? ""]
            return haystack.contains { $0.range(of: needle, options: folding, locale: Locale.current) != nil }
        }
    }

    /// Each facet's distinct values across every entry, archived included, sorted. Spellings
    /// that differ only by case or accents fold into one option, as matching folds them.
    public static func facetValues(_ entries: [CatalogEntry]) -> [CatalogFacet: [String]] {
        var values: [CatalogFacet: [String]] = [:]
        for facet in CatalogFacet.all {
            var seen: [String] = []
            for entry in entries {
                for case let value? in facet.values(of: entry.tune)
                where !value.isEmpty && !seen.contains(where: { same($0, value) }) {
                    seen.append(value)
                }
            }
            values[facet] = seen.sorted(by: precedes)
        }
        return values
    }

    /// The facets worth offering: those with values, minus tunings for instruments the musician
    /// does not play.
    public static func visibleFacets(_ values: [CatalogFacet: [String]], instruments: Set<String>) -> [CatalogFacet] {
        CatalogFacet.all.filter { facet in
            guard !(values[facet] ?? []).isEmpty else { return false }
            return facet.instrument.map(instruments.contains) ?? true
        }
    }

    /// A facet's choices: the values the catalog holds, plus a set value it no longer holds, so a
    /// stale filter never reads as Any.
    public static func choices(_ values: [String], set: String?) -> [String] {
        guard let set, !values.contains(set) else { return values }
        return values + [set]
    }

    /// "84 tunes", or "11 of 84 tunes" while narrowed: the one wording for a catalog count.
    public static func countLabel(visible: Int, total: Int) -> String {
        if visible != total { return "\(visible) of \(total) tunes" }
        return tunes(total)
    }

    /// "1 tune" or "3 tunes": the one wording for a number of tunes.
    public static func tunes(_ count: Int) -> String {
        count == 1 ? "1 tune" : "\(count) tunes"
    }
}
