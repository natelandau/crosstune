import Foundation

/// An exact title match that search found but a filter or the archived setting hides.
public struct HiddenMatch: Hashable, Sendable {
    public enum Reason: Hashable, Sendable {
        case archived
        case filtered
    }

    public let entry: CatalogEntry
    public let reason: Reason

    /// `"Soldier's Joy" is archived.`
    public var note: String {
        let why = reason == .archived ? "archived" : "hidden by your filters"
        return "\"\(entry.tune.title)\" is \(why)."
    }

    /// The Open control's spoken name.
    public var openName: String { "\(SearchOutcome.open) \(entry.tune.title)" }
}

/// What the search box offers beyond the visible results.
public enum SearchOutcome: Hashable, Sendable {
    nonisolated public static let open = "Open"

    case none
    /// Offers to add the trimmed query as a tune. `another` is true when some tune already
    /// carries the title; `hidden` is set when every such tune is hidden.
    case create(title: String, another: Bool, hidden: HiddenMatch?)

    /// What the search offers for `query`, given every entry and the visible ones. Different
    /// tunes can share a title, so an exact match never suppresses create. Exact matches are
    /// looked for across the whole catalog so a tune hidden by a filter is pointed to before a
    /// second one is added.
    public init(entries: [CatalogEntry], visible: [CatalogEntry], query: String, archivedShown: Bool) {
        let title = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            self = .none
            return
        }
        if visible.contains(where: { CatalogSearch.titleMatches($0.tune, query: title) }) {
            self = .create(title: title, another: true, hidden: nil)
            return
        }
        guard let entry = entries.first(where: { CatalogSearch.titleMatches($0.tune, query: title) }) else {
            self = .create(title: title, another: false, hidden: nil)
            return
        }
        let reason: HiddenMatch.Reason = entry.isArchived && !archivedShown ? .archived : .filtered
        self = .create(title: title, another: true, hidden: HiddenMatch(entry: entry, reason: reason))
    }

    /// The add row's label: `Add "query"`, or `Add another "query"` when the title exists.
    public var offerLabel: String? {
        guard case .create(let title, let another, _) = self else { return nil }
        return another ? "Add another \"\(title)\"" : "Add \"\(title)\""
    }

    public var title: String? {
        guard case .create(let title, _, _) = self else { return nil }
        return title
    }

    public var hidden: HiddenMatch? {
        guard case .create(_, _, let hidden) = self else { return nil }
        return hidden
    }
}

/// What Return in the search field does.
public enum SearchSubmit: Hashable, Sendable {
    case open(tuneID: String)
    case create(title: String)
    /// Only closes the keyboard.
    case dismiss

    /// Return opens the only visible result, or the hidden exact match, or creates when nothing
    /// matches. With two or more results it only closes the keyboard. It never adds a tune whose
    /// title already exists; that takes a deliberate tap.
    public init(query: String, visible: [CatalogEntry], outcome: SearchOutcome) {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, visible.count <= 1 else {
            self = .dismiss
            return
        }
        if let only = visible.first {
            self = .open(tuneID: only.tune.id)
        } else if case .create(let title, _, let hidden) = outcome {
            self = hidden.map { .open(tuneID: $0.entry.tune.id) } ?? .create(title: title)
        } else {
            self = .dismiss
        }
    }
}
