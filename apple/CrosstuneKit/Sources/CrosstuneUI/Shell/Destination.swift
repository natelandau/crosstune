import CrosstuneStore

/// A top-level place in the app: a tab on iPhone, a sidebar row on iPad and Mac.
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

/// A row of the iPad and Mac sidebar. Lists are a section of their own rather than a
/// destination, so each list is a row.
public enum SidebarItem: Hashable, Sendable {
    case catalog
    case recordings
    case list(id: String)
    /// Only on iPad: the Mac keeps settings in its Settings window.
    case settings

    public static let newList = "New list…"

    /// The destination this row opens, or nil for a list, which opens that list's own screen.
    public var destination: Destination? {
        switch self {
        case .catalog: .catalog
        case .recordings: .recordings
        case .settings: .settings
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
