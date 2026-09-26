import Observation

/// Where the musician is in one window: the destination, the list, and the tune on screen. The
/// shell keeps it above the layout switch, so resizing an iPad window between the tab bar and
/// the split view keeps the same destination, list, and tune wherever the new layout can show
/// them.
@MainActor @Observable
final class ShellPlace {
    /// The split view's sidebar row.
    var sidebar: SidebarItem = .catalog
    /// The tune in the split view's detail column.
    var detailTune: String?
    /// The tab bar's tab.
    var tab: Destination = .catalog
    /// The list pushed on the Lists tab.
    var tabList: String? {
        didSet {
            // A tune pushed over one list does not belong over the next.
            if tabList != oldValue { tabTunes[.lists] = nil }
        }
    }
    /// The tune pushed on each tab, over its list on the Lists tab.
    var tabTunes: [Destination: String] = [:]

    /// Carries the split view's place into the tab bar.
    func enterTabs() {
        if case .list(let id) = sidebar {
            tab = .lists
            tabList = id
        } else {
            tab = sidebar.destination ?? .catalog
            tabList = nil
        }
        tabTunes = detailTune.map { [tab: $0] } ?? [:]
    }

    /// Carries the tab bar's place into the split view. The Lists tab with no list open has no
    /// sidebar row, so it falls back to the catalog.
    func enterSplit() {
        switch tab {
        case .catalog: sidebar = .catalog
        case .recordings: sidebar = .recordings
        case .settings: sidebar = .settings
        case .lists: sidebar = tabList.map { .list(id: $0) } ?? .catalog
        }
        detailTune = tabTunes[tab]
    }
}

/// A list pushed on the iPhone Lists tab.
struct ListRoute: Hashable {
    let id: String
}
