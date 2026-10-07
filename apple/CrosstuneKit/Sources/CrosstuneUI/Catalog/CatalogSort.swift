import CrosstuneStore
import Foundation
import GRDB

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

    /// Each tune's latest play or practice session, found in SQL so the reader decodes one row
    /// per tune however long the history grows. `started_at` is fixed-width ISO text, so its
    /// largest value as text is its latest as a time.
    public static func lastPlayed(_ db: Database) throws -> [String: Timestamp] {
        let rows = try Row.fetchCursor(
            db,
            sql: """
                SELECT tune_id, MAX(started_at) AS started_at FROM (
                    SELECT tune_id, started_at FROM \(SyncTable.playEvents.rawValue) WHERE tune_id IS NOT NULL
                    UNION ALL
                    SELECT tune_id, started_at FROM \(SyncTable.practiceSessions.rawValue) WHERE tune_id IS NOT NULL
                ) GROUP BY tune_id
                """)
        var latest: [String: Timestamp] = [:]
        while let row = try rows.next() {
            // The throwing decode, since the subscript traps on a time that does not parse.
            latest[try row.decode(String.self, forColumn: "tune_id")] = try row.decode(
                Timestamp.self, forColumn: "started_at")
        }
        return latest
    }
}
