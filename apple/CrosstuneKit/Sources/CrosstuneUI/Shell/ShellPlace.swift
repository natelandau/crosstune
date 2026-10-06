import Observation

/// Where the musician is in one window: the destination, the list, and the tune on screen. The
/// shell keeps it above the layout switch, and the iPhone and iPad shells read the same tab
/// fields, so resizing an iPad window between them keeps the same tab, list, and tune. The Mac
/// split view reads the sidebar and detail fields.
@MainActor @Observable
final class ShellPlace {
    /// The Mac split view's sidebar row.
    var sidebar: SidebarItem = .catalog
    /// The tune in the Mac split view's detail column.
    var detailTune: String?
    /// The iPhone and iPad shells' tab.
    var tab: Destination = .catalog
    /// The list open on the Lists tab.
    var tabList: String? {
        didSet {
            // A tune pushed over one list, or a place scrolled to in it, does not belong to the next.
            if tabList != oldValue {
                tabTunes[.lists] = nil
                scrollAnchors[.lists] = nil
            }
        }
    }
    /// The tune each tab shows: pushed on iPhone, in the detail column on iPad.
    var tabTunes: [Destination: String] = [:]
    /// The row each destination's list keeps at its top, which every iPad tab showing that
    /// destination shares.
    var scrollAnchors: [Destination: String] = [:]

    /// The page open in the iPad Settings tab's detail column.
    var settingsPage: SettingsPage?

    /// Shows `destination` in the iPhone and iPad tabs: its tab, with nothing open.
    func showTabRoot(_ destination: Destination) {
        tabTunes[destination] = nil
        if destination == .lists { tabList = nil }
        if destination == .settings { settingsPage = nil }
        tab = destination
    }

    /// Shows `destination`'s row in the Mac sidebar. The Lists root and Settings, which the Mac
    /// keeps in its own window, have no row, so they fall back to the catalog.
    func showSidebarRoot(_ destination: Destination) {
        sidebar =
            switch destination {
            case .catalog, .lists, .settings: .catalog
            case .recordings: .recordings
            }
    }

    /// The Lists tab's stack: the open list, or nothing pushed.
    var listPath: [ListRoute] {
        get { tabList.map { [ListRoute(id: $0)] } ?? [] }
        set { tabList = newValue.last?.id }
    }
}

/// A list pushed on the iPhone and iPad Lists tab.
struct ListRoute: Hashable {
    let id: String
}
