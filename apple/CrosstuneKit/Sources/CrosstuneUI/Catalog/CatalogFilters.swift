import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// A tune and the musician's own row for it: one entry in the catalog.
public struct CatalogEntry: Hashable, Sendable, Identifiable {
    public let tune: Tune
    public let userTune: UserTune
    /// Whether the tune has a live recording or link. Only a catalog that filters on it reads it;
    /// every other entry reads as unheard.
    public let heard: Bool

    public init(tune: Tune, userTune: UserTune, heard: Bool = false) {
        self.tune = tune
        self.userTune = userTune
        self.heard = heard
    }

    public var id: String { userTune.id }
    public var isArchived: Bool { userTune.archivedAt != nil }
}

/// A field the Missing filter can ask about. The learned fields read the musician's own row;
/// every other attribute reads the tune. Raw values are the web client's, so both read the same
/// stored filter.
public enum MissingAttribute: Hashable, Sendable, RawRepresentable {
    case key
    case mode
    case tuneType
    case genre
    case timeSignature
    case composer
    case partStructure
    case tuning(String)
    case learnedFrom
    case learnedOn

    /// Every attribute in the order the sheet lists them.
    nonisolated public static let all: [MissingAttribute] =
        [.key, .mode, .tuneType, .genre, .timeSignature, .composer, .partStructure]
        + Vocabulary.instruments.map(MissingAttribute.tuning) + [.learnedFrom, .learnedOn]

    public init?(rawValue: String) {
        guard let match = Self.all.first(where: { $0.rawValue == rawValue }) else { return nil }
        self = match
    }

    public var rawValue: String {
        switch self {
        case .key: "key"
        case .mode: "mode"
        case .tuneType: "tune_type"
        case .genre: "genre"
        case .timeSignature: "time_signature"
        case .composer: "composer"
        case .partStructure: "part_structure"
        case .tuning(let instrument): "tuning:\(instrument)"
        case .learnedFrom: "learned_from"
        case .learnedOn: "learned_on"
        }
    }

    public var label: String {
        switch self {
        case .key: CatalogFacet.key.label
        case .mode: CatalogFacet.mode.label
        case .tuneType: CatalogFacet.tuneType.label
        case .genre: CatalogFacet.genre.label
        case .timeSignature: TuneFieldLabels.timeSignature
        case .composer: TuneFieldLabels.composer
        case .partStructure: TuneFieldLabels.partStructure
        case .tuning(let instrument): CatalogFacet.tuning(instrument).label
        case .learnedFrom: TuneFieldLabels.learnedFrom
        case .learnedOn: TuneFieldLabels.learnedOn
        }
    }

    /// The facet whose visibility gates this attribute: a tuning for an instrument the musician
    /// does not play is hidden, so it cannot narrow the list.
    var tuningFacet: CatalogFacet? {
        if case .tuning(let instrument) = self { return .tuning(instrument) }
        return nil
    }

    /// Every value the entry holds for this attribute.
    func values(of entry: CatalogEntry) -> [String?] {
        switch self {
        case .key: CatalogFacet.key.values(of: entry.tune)
        case .mode: CatalogFacet.mode.values(of: entry.tune)
        case .tuneType: CatalogFacet.tuneType.values(of: entry.tune)
        case .genre: CatalogFacet.genre.values(of: entry.tune)
        case .timeSignature: [entry.tune.timeSignature]
        case .composer: [entry.tune.composer]
        case .partStructure: [entry.tune.partStructure]
        case .tuning(let instrument): CatalogFacet.tuning(instrument).values(of: entry.tune)
        case .learnedFrom: [entry.userTune.learnedFrom]
        case .learnedOn: [entry.userTune.learnedOn]
        }
    }

    /// Whether the entry holds nothing for this attribute.
    func isMissing(in entry: CatalogEntry) -> Bool {
        !values(of: entry).contains(where: CatalogSearch.isHeld)
    }
}

/// The catalog's filters: status, one value per facet, and whether archived tunes show. Stored
/// in the meta table under `catalog_filters` in the web client's shape, so both read the same.
public struct CatalogFilters: Hashable, Sendable {
    /// The stored value of a filter that narrows nothing.
    nonisolated public static let any = "all"
    /// The stored key filter for tunes with no key. It must never be a key a tune can hold, the
    /// way `all` is not.
    nonisolated public static let noKey = "none"
    public static let `default` = CatalogFilters()

    /// Nil shows every status.
    public var status: String?
    /// Each set facet's value. A facet missing here narrows nothing.
    public var facets: [CatalogFacet: String]
    public var archived: Bool
    /// Whether only tunes with no recording or link show.
    public var unheard: Bool
    /// Nil narrows nothing; otherwise only tunes holding nothing for the attribute show.
    public var missing: MissingAttribute?

    public init(
        status: String? = nil, facets: [CatalogFacet: String] = [:], archived: Bool = false,
        unheard: Bool = false, missing: MissingAttribute? = nil
    ) {
        self.status = status
        self.facets = facets
        self.archived = archived
        self.unheard = unheard
        self.missing = missing
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
        var missing: MissingAttribute?
        if case .string(let value) = object["missing"] ?? .null { missing = MissingAttribute(rawValue: value) }
        self.init(
            status: status, facets: facets, archived: object["archived"] == .bool(true),
            unheard: object["unheard"] == .bool(true), missing: missing)
    }

    /// The value to store: every field, with `all` for one that narrows nothing.
    public var stored: JSONValue {
        var object: JSONObject = [
            "status": .string(status ?? Self.any), "archived": .bool(archived),
            "unheard": .bool(unheard), "missing": .string(missing?.rawValue ?? Self.any),
        ]
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
        if let facet = filters.missing?.tuningFacet, !visible.contains(facet) { filters.missing = nil }
        return filters
    }

    /// How many of the sheet's filters are set: the count on the Filters button and the gate on
    /// Reset. Status, key, and type sit on the screen, so they are not among them.
    public var sheetCount: Int { sheetCount(railsOnScreen: true) }

    /// ``sheetCount`` with the key and type rails on the screen or, when `railsOnScreen` is
    /// false, in the sheet.
    public func sheetCount(railsOnScreen: Bool) -> Int {
        facets.keys.count { $0.isInSheet(railsOnScreen: railsOnScreen) } + (archived ? 1 : 0)
            + (unheard ? 1 : 0) + (missing != nil ? 1 : 0)
    }

    /// These filters with the sheet's cleared and the screen's kept.
    public var sheetReset: CatalogFilters { sheetReset(railsOnScreen: true) }

    /// ``sheetReset`` with the key and type rails on the screen or, when `railsOnScreen` is
    /// false, in the sheet.
    public func sheetReset(railsOnScreen: Bool) -> CatalogFilters {
        CatalogFilters(status: status, facets: facets.filter { !$0.key.isInSheet(railsOnScreen: railsOnScreen) })
    }
}

/// Matching, sorting, and counting the catalog, ignoring case and accents throughout. Matching
/// uses the shared fold, so every client matches the same tunes; sorting follows the reader's
/// locale.
public enum CatalogSearch {
    nonisolated static let folding: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    private static func order(_ first: String, _ second: String) -> ComparisonResult {
        first.compare(second, options: folding, locale: Locale.current)
    }

    /// Sorts ignoring case and accents, in the reader's locale.
    public static func precedes(_ first: String, _ second: String) -> Bool {
        order(first, second) == .orderedAscending
    }

    /// Every active tune with its active user row, sorted by title.
    public static func entries(tunes: [Tune], userTunes: [UserTune], heard: Set<String> = []) -> [CatalogEntry] {
        let tunesByID = Dictionary(
            tunes.filter { $0.deletedAt == nil }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return
            userTunes
            .filter { $0.deletedAt == nil }
            .compactMap { userTune in
                tunesByID[userTune.tuneID].map {
                    CatalogEntry(tune: $0, userTune: userTune, heard: heard.contains($0.id))
                }
            }
            .sorted { first, second in
                let titles = order(first.tune.title, second.tune.title)
                return titles == .orderedSame ? first.id < second.id : titles == .orderedAscending
            }
    }

    /// True when the query names the tune's title or an alternate title, as `sameText` compares
    /// them.
    public static func titleMatches(_ tune: Tune, query: String) -> Bool {
        isHeld(query) && ([tune.title] + tune.alternateTitles).contains { sameText($0, query) }
    }

    public static func hidingArchived(_ entries: [CatalogEntry], shown: Bool) -> [CatalogEntry] {
        shown ? entries : entries.filter { !$0.isArchived }
    }

    /// The entries the filters and the query let through, in catalog order. The query matches
    /// anywhere in a title, an alternate title, or the composer.
    public static func filter(_ entries: [CatalogEntry], by filters: CatalogFilters, query: String = "")
        -> [CatalogEntry]
    {
        let needle = trimmedText(query)
        return hidingArchived(entries, shown: filters.archived).filter { entry in
            if let status = filters.status, entry.userTune.status != status { return false }
            if filters.unheard, entry.heard { return false }
            if let missing = filters.missing, !missing.isMissing(in: entry) { return false }
            for (facet, value) in filters.facets {
                let values = facet.values(of: entry.tune)
                if facet == .key, value == CatalogFilters.noKey {
                    guard !values.contains(where: isHeld) else { return false }
                } else {
                    guard values.contains(where: { isHeld($0) && sameText(value, $0 ?? "") }) else { return false }
                }
            }
            guard !needle.isEmpty else { return true }
            let haystack = [entry.tune.title] + entry.tune.alternateTitles + [entry.tune.composer ?? ""]
            return haystack.contains { containsText($0, needle) }
        }
    }

    /// Whether a value holds anything the fold keeps; whitespace or combining marks alone are blank.
    static func isHeld(_ value: String?) -> Bool {
        !foldText(value ?? "").isEmpty
    }

    /// Whether a facet can filter by a value. A value the fold calls the same as ``CatalogFilters/any``,
    /// or as ``CatalogFilters/noKey`` for the key, is not one: the stored filter would read it as
    /// Any or No key.
    public static func isFilterValue(_ value: String, for facet: CatalogFacet) -> Bool {
        let key = foldText(value)
        return !key.isEmpty && key != CatalogFilters.any && !(facet == .key && key == CatalogFilters.noKey)
    }

    /// Each facet's distinct values across every entry, archived included, sorted. Spellings
    /// that differ only by case or accents fold into one option, as matching folds them. The key
    /// leads with ``CatalogFilters/noKey`` while some tunes have a key and some do not; with no
    /// keys at all it would narrow nothing.
    public static func facetValues(_ entries: [CatalogEntry]) -> [CatalogFacet: [String]] {
        var values: [CatalogFacet: [String]] = [:]
        for facet in CatalogFacet.all {
            var seen: [String] = []
            var keys: Set<[UInt16]> = []
            for entry in entries {
                for case let value? in facet.values(of: entry.tune)
                where isFilterValue(value, for: facet) && keys.insert(Array(foldText(value).utf16)).inserted {
                    seen.append(value)
                }
            }
            values[facet] = seen.sorted(by: precedes)
        }
        if let keys = values[.key], !keys.isEmpty, entries.contains(where: { !isHeld($0.tune.key) }) {
            values[.key] = [CatalogFilters.noKey] + keys
        }
        return values
    }

    /// The attributes some entry holds, in sheet order: asking for a missing one is only useful
    /// then.
    public static func missingChoices(_ entries: [CatalogEntry]) -> [MissingAttribute] {
        MissingAttribute.all.filter { attribute in entries.contains { !attribute.isMissing(in: $0) } }
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
    /// stale filter never reads as Any. No key keeps its place at the front.
    public static func choices(_ values: [String], set: String?) -> [String] {
        guard let set, !values.contains(set) else { return values }
        return set == CatalogFilters.noKey ? [set] + values : values + [set]
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
