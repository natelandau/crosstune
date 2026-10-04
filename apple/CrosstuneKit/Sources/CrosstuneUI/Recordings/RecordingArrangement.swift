import CrosstuneStore
import CrosstuneVocabulary
import Foundation

public enum RecordingSort: String, CaseIterable, Sendable {
    case added
    case recorded
    case title
    case tune
}

extension RecordingSort {
    /// True for a sort whose first direction is newest first rather than A first.
    public var isDate: Bool { self == .added || self == .recorded }
}

/// A sort and its direction, stored per device as `"<sort>.<asc|desc>"`. `descending` is newest
/// first for a date sort and Z first otherwise. A date sort starts descending; Title and Tune
/// start ascending.
public struct SortChoice: Equatable, Sendable, RawRepresentable {
    public static let storageKey = "recordingsSort.v2"  // gitleaks:allow -- a defaults key, not a secret
    public static let `default` = SortChoice(sort: .added, descending: true)

    public var sort: RecordingSort
    public var descending: Bool

    public init(sort: RecordingSort, descending: Bool) {
        self.sort = sort
        self.descending = descending
    }

    public init?(rawValue: String) {
        let parts = rawValue.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, let sort = RecordingSort(rawValue: String(parts[0])),
            parts[1] == "asc" || parts[1] == "desc"
        else { return nil }
        self.init(sort: sort, descending: parts[1] == "desc")
    }

    public var rawValue: String { "\(sort.rawValue).\(descending ? "desc" : "asc")" }

    /// Picking the current sort reverses it; picking another starts it at its first direction.
    public func picking(_ picked: RecordingSort) -> SortChoice {
        if picked == sort { return SortChoice(sort: picked, descending: !descending) }
        return SortChoice(sort: picked, descending: picked.isDate)
    }
}

/// One tune's recordings: own before imported, each newest added first.
public struct TuneRecordings: Identifiable, Hashable, Sendable {
    public let tuneID: String
    public let tuneTitle: String
    public let views: [RecordingView]

    public var id: String { tuneID }
}

public enum FiledRecordings: Equatable, Sendable {
    case flat([RecordingView])
    case byTune([TuneRecordings])
}

public enum RecordingsListText {
    public static let search = "Search recordings"
    public static let sort = "Sort"
    public static let filed = "Filed"
    public static let unfiled = "Unfiled"
    public static let nothingMatches = CatalogScreen.nothingMatches
    public static let goToTune = "Go to tune"
    /// The filter sheet's one section, and its first two choices.
    public static let source = "Source"
    public static let all = "All"
    public static let mine = "Mine"
    /// Why Filters is disabled while every recording is the musician's own.
    public static let filtersDisabledReason = "All recordings are yours"

    public static func label(_ sort: RecordingSort) -> String {
        switch sort {
        case .added: "Date added"
        case .recorded: "Date recorded"
        case .title: "Title"
        case .tune: "Tune"
        }
    }

    public static func openTune(_ title: String) -> String { "Open \(title)" }

    public static let newestFirst = "Newest first"
    public static let oldestFirst = "Oldest first"
    public static let aToZ = "A to Z"
    public static let zToA = "Z to A"

    /// The words for a sort's direction, shown with its checked menu item.
    public static func direction(_ choice: SortChoice) -> String {
        if choice.sort.isDate { return choice.descending ? newestFirst : oldestFirst }
        return choice.descending ? zToA : aToZ
    }

    /// Down for newest first and Z to A, up for oldest first and A to Z.
    public static func directionSymbol(_ choice: SortChoice) -> String {
        choice.descending ? "arrow.down" : "arrow.up"
    }
}

/// The recordings screen's two sections: those with no tune, and those filed under one.
public struct RecordingArrangement: Equatable, Sendable {
    public let unfiled: [RecordingView]
    public let filed: FiledRecordings

    /// True when neither section has a recording.
    public var isEmpty: Bool {
        guard unfiled.isEmpty else { return false }
        switch filed {
        case .flat(let views): return views.isEmpty
        case .byTune(let tunes): return tunes.isEmpty
        }
    }

    nonisolated private static let folding: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    public static func arrange(_ views: [RecordingView], choice: SortChoice, query: String) -> RecordingArrangement {
        let needle = trimmedText(query)
        let visible = needle.isEmpty ? views : views.filter { matches($0, needle) }
        let unfiled = visible.filter { $0.tuneID == nil }
        let filed = visible.filter { $0.tuneID != nil }

        switch choice.sort {
        case .added, .recorded:
            let order = (choice.sort == .added ? byAdded : byRecorded)(choice.descending)
            return RecordingArrangement(unfiled: sort(unfiled, order), filed: .flat(sort(filed, order)))
        case .title:
            let order = byTitle(descending: choice.descending)
            return RecordingArrangement(unfiled: sort(unfiled, order), filed: .flat(sort(filed, order)))
        case .tune:
            return RecordingArrangement(
                unfiled: sort(unfiled, byAddedForAFirst(choice.descending)),
                filed: .byTune(groupByTune(filed, descending: choice.descending)))
        }
    }

    // Swift's sort makes no stability promise, so ties keep their input order explicitly.
    nonisolated private static func sort(
        _ views: [RecordingView], _ order: (RecordingView, RecordingView) -> Int
    ) -> [RecordingView] {
        views.enumerated().sorted { a, b in
            let result = order(a.element, b.element)
            return result == 0 ? a.offset < b.offset : result < 0
        }.map(\.element)
    }

    nonisolated private static func sign<T: Comparable>(_ a: T, _ b: T) -> Int { a < b ? -1 : a > b ? 1 : 0 }

    // Equal instants break by id, so the order is stable and reversing it mirrors it exactly.
    nonisolated private static func newestAddedFirst(_ a: RecordingView, _ b: RecordingView) -> Int {
        let byDate = sign(b.recording.addedAt.milliseconds, a.recording.addedAt.milliseconds)
        return byDate != 0 ? byDate : sign(b.recording.id, a.recording.id)
    }

    nonisolated private static func byAdded(_ descending: Bool) -> (RecordingView, RecordingView) -> Int {
        { a, b in descending ? newestAddedFirst(a, b) : -newestAddedFirst(a, b) }
    }

    // Title and Tune start at A, which reads as newest first for the dates beside them.
    nonisolated private static func byAddedForAFirst(_ descending: Bool) -> (RecordingView, RecordingView) -> Int {
        byAdded(!descending)
    }

    // A partial date is stored as the start of its period, so it sorts there with no adjustment.
    // Unknown dates come last in both directions; equal or unknown dates fall back to date added.
    nonisolated private static func byRecorded(_ descending: Bool) -> (RecordingView, RecordingView) -> Int {
        let added = byAdded(descending)
        return { a, b in
            let x = a.recording.knownRecordedDate?.at.milliseconds
            let y = b.recording.knownRecordedDate?.at.milliseconds
            guard let x, let y else {
                let unknown = (x == nil ? 1 : 0) - (y == nil ? 1 : 0)
                return unknown != 0 ? unknown : added(a, b)
            }
            let order = descending ? sign(y, x) : sign(x, y)
            return order != 0 ? order : added(a, b)
        }
    }

    nonisolated private static func label(_ view: RecordingView) -> String {
        trimmedText(view.recording.label ?? "")
    }

    nonisolated private static func compare(_ a: String, _ b: String) -> Int {
        switch a.compare(b, options: folding, locale: Locale.current) {
        case .orderedAscending: -1
        case .orderedSame: 0
        case .orderedDescending: 1
        }
    }

    nonisolated private static func byTitle(descending: Bool) -> (RecordingView, RecordingView) -> Int {
        let dates = byAddedForAFirst(descending)
        return { a, b in
            let x = label(a)
            let y = label(b)
            if x.isEmpty || y.isEmpty {
                let untitled = (x.isEmpty ? 1 : 0) - (y.isEmpty ? 1 : 0)
                return untitled != 0 ? untitled : dates(a, b)
            }
            let order = compare(x, y)
            return order != 0 ? (descending ? -order : order) : dates(a, b)
        }
    }

    nonisolated private static func matches(_ view: RecordingView, _ needle: String) -> Bool {
        [label(view), view.tuneTitle ?? ""].contains { containsText($0, needle) }
    }

    nonisolated private static func groupByTune(_ views: [RecordingView], descending: Bool) -> [TuneRecordings] {
        var order: [String] = []
        var members: [String: [RecordingView]] = [:]
        var titles: [String: String] = [:]
        for view in views {
            guard let tuneID = view.tuneID else { continue }
            if members[tuneID] == nil {
                order.append(tuneID)
                titles[tuneID] = view.tuneTitle ?? ""
            }
            members[tuneID, default: []].append(view)
        }
        let sorted = order.sorted { a, b in
            let result = compare(titles[a] ?? "", titles[b] ?? "")
            let directed = descending ? -result : result
            return directed != 0 ? directed < 0 : a < b
        }
        return sorted.map { tuneID in
            TuneRecordings(
                tuneID: tuneID, tuneTitle: titles[tuneID] ?? "",
                views: sort(members[tuneID] ?? [], ownFirstThenNewestAdded))
        }
    }

    nonisolated private static func ownFirstThenNewestAdded(_ a: RecordingView, _ b: RecordingView) -> Int {
        let imported = { (view: RecordingView) in view.recording.origin == RecordingText.ownOrigin ? 0 : 1 }
        let order = imported(a) - imported(b)
        return order != 0 ? order : newestAddedFirst(a, b)
    }
}
