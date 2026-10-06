import CrosstuneStore
import CrosstuneVocabulary
import Foundation

public enum RecordingSort: String, SortKind {
    case added
    case recorded
    case title
    case tune

    public var isDate: Bool { self == .added || self == .recorded }

    public var label: String {
        switch self {
        case .added: "Date added"
        case .recorded: "Date recorded"
        case .title: "Title"
        case .tune: "Tune"
        }
    }
}

public typealias RecordingSortChoice = SortChoice<RecordingSort>

extension SortChoice where Sort == RecordingSort {
    public static var storageKey: String { "recordingsSort.v2" }  // gitleaks:allow -- a defaults key, not a secret
    public static var `default`: SortChoice { SortChoice(sort: .added, descending: true) }
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

    public static func openTune(_ title: String) -> String { "Open \(title)" }

    /// The list header's count: "24 recordings", or "3 of 24 recordings" when narrowed.
    public static func countLabel(visible: Int, total: Int) -> String {
        if visible != total { return "\(visible) of \(total) recordings" }
        return total == 1 ? "1 recording" : "\(total) recordings"
    }
}

/// One block of the iPhone recordings list, top to bottom.
public enum RecordingsSection: Equatable, Sendable {
    case unfinished
    /// The count line over a list that a search or filter has emptied.
    case count
    case unfiled
    case tunes
    case storage
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

    /// How many recordings both sections show.
    public var count: Int {
        switch filed {
        case .flat(let views): unfiled.count + views.count
        case .byTune(let tunes): unfiled.count + tunes.reduce(0) { $0 + $1.views.count }
        }
    }

    /// The sections the iPhone list shows, in order: absent ones left out, storage last. While
    /// an empty state shows over the list, the storage row stands aside so it never sits under
    /// the empty state's words.
    public static func sectionOrder(
        hasUnfinished: Bool, hasUnfiled: Bool, tuneCount: Int, narrowedToNothing: Bool = false,
        showsEmptyState: Bool = false
    ) -> [RecordingsSection] {
        var order: [RecordingsSection] = []
        if hasUnfinished { order.append(.unfinished) }
        if narrowedToNothing { order.append(.count) }
        if hasUnfiled { order.append(.unfiled) }
        if tuneCount > 0 { order.append(.tunes) }
        return showsEmptyState ? order : order + [.storage]
    }

    nonisolated private static let folding: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    public static func arrange(_ views: [RecordingView], choice: RecordingSortChoice, query: String)
        -> RecordingArrangement
    {
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
