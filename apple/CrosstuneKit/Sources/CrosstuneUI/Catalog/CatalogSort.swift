import CrosstuneStore
import Foundation

public enum CatalogSort: String, SortKind {
    case title
    case added
    case modified
    case played

    public var isDate: Bool { self != .title }

    public var label: String {
        switch self {
        case .title: "Title"
        case .added: "Date added"
        case .modified: "Date modified"
        case .played: "Last played"
        }
    }
}

public typealias CatalogSortChoice = SortChoice<CatalogSort>

extension SortChoice where Sort == CatalogSort {
    public static var storageKey: String { "catalogSort.v1" }  // gitleaks:allow -- a defaults key, not a secret
    public static var `default`: SortChoice { SortChoice(sort: .title, descending: false) }
}

extension CatalogSearch {
    /// The entries in the chosen order. Equal or unknown dates fall back to title A to Z, and a
    /// tune never played comes last in both directions, as an unknown date does on the
    /// recordings screen.
    public static func sorted(
        _ entries: [CatalogEntry], by choice: CatalogSortChoice, lastPlayed: [String: Timestamp]
    ) -> [CatalogEntry] {
        let descending = choice.descending
        let date: (CatalogEntry) -> Timestamp? =
            switch choice.sort {
            case .title: { _ in nil }
            case .added: { $0.userTune.createdAt }
            case .modified: { max($0.tune.updatedAt, $0.userTune.updatedAt) }
            case .played: { lastPlayed[$0.tune.id] }
            }
        if choice.sort == .title {
            return entries.sorted { descending ? titleFirst($1, $0) : titleFirst($0, $1) }
        }
        return entries.sorted { a, b in
            switch (date(a), date(b)) {
            case (nil, nil): titleFirst(a, b)
            case (nil, _): false
            case (_, nil): true
            case (let x?, let y?): x == y ? titleFirst(a, b) : (descending ? x > y : x < y)
            }
        }
    }

    /// Each tune's latest play or practice session.
    public static func lastPlayed(plays: [PlayEvent], sessions: [PracticeSession]) -> [String: Timestamp] {
        var latest: [String: Timestamp] = [:]
        let starts = plays.map { ($0.tuneID, $0.startedAt) } + sessions.map { ($0.tuneID, $0.startedAt) }
        for case (let tuneID?, let startedAt) in starts where latest[tuneID].map({ startedAt > $0 }) ?? true {
            latest[tuneID] = startedAt
        }
        return latest
    }
}
