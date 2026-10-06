import CrosstuneStore

/// A top-level place in the app: a tab on iPhone and iPad, a sidebar row on the Mac.
public enum Destination: String, CaseIterable, Hashable, Identifiable, Sendable {
    case catalog
    case lists
    case recordings
    case settings

    public static let catalogTitle = "Catalog"
    public static let listsTitle = "Lists"
    public static let recordingsTitle = "Recordings"
    public static let settingsTitle = "Settings"

    public var id: Self { self }

    public var title: String {
        switch self {
        case .catalog: Self.catalogTitle
        case .lists: Self.listsTitle
        case .recordings: Self.recordingsTitle
        case .settings: Self.settingsTitle
        }
    }

    public var systemImage: String {
        switch self {
        case .catalog: "music.note"
        case .lists: "music.note.list"
        case .recordings: "waveform"
        case .settings: "gearshape"
        }
    }
}

/// A row of the Mac sidebar. Lists are a section of their own rather than a
/// destination, so each list is a row.
public enum SidebarItem: Hashable, Sendable {
    case catalog
    /// The catalog with this status filter set, as the Catalog row is the catalog with none.
    case status(String)
    case recordings
    case list(id: String)

    public static let newList = "New list…"

    /// The catalog row that shows the catalog filtered by `status`, or every status for nil.
    public static func catalogRow(status: String?) -> SidebarItem {
        status.map(SidebarItem.status) ?? .catalog
    }

    /// The status filter this row sets: nil for a row that does not show the catalog, `.some(nil)`
    /// for the Catalog row, which shows every status.
    public var statusFilter: String?? {
        switch self {
        case .catalog: .some(nil)
        case .status(let status): .some(status)
        case .recordings, .list: nil
        }
    }

    /// The destination this row opens, or nil for a list, which opens that list's own screen.
    public var destination: Destination? {
        switch self {
        case .catalog, .status: .catalog
        case .recordings: .recordings
        case .list: nil
        }
    }

    /// The selection to keep once the lists change: a list that is gone falls back to the
    /// catalog rather than leaving the content column pointing at nothing.
    public func kept(among lists: [TuneList]) -> SidebarItem {
        guard case .list(let id) = self, !lists.contains(where: { $0.id == id }) else { return self }
        return .catalog
    }
}
