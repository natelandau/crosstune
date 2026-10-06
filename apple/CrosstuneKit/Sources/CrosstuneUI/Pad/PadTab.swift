/// One tab of the iPad shell's `TabView`. Status and list rows exist only in the sidebar form;
/// the top bar shows destinations alone.
enum PadTab: Hashable {
    case destination(Destination)
    case status(String)
    case list(id: String)

    /// The tab the shell shows as chosen. `inSidebar` is false in the top-bar form, where
    /// status and list rows are not shown.
    @MainActor static func selected(place: ShellPlace, status: String?, inSidebar: Bool) -> PadTab {
        guard inSidebar else { return .destination(place.tab) }
        switch place.tab {
        case .catalog:
            return status.map { .status($0) } ?? .destination(.catalog)
        case .lists:
            return place.tabList.map { .list(id: $0) } ?? .destination(.lists)
        case .recordings, .settings:
            return .destination(place.tab)
        }
    }

    /// Applies a choice. Only `.status` and, in the sidebar, `.destination(.catalog)` write the
    /// status filter.
    @MainActor static func choose(_ tab: PadTab, place: ShellPlace, catalog: CatalogModel?, inSidebar: Bool) {
        switch tab {
        case .destination(let destination):
            if destination == .catalog, inSidebar, let catalog { write(nil, to: catalog, place: place) }
            place.tab = destination
        case .status(let status):
            if let catalog { write(status, to: catalog, place: place) }
            place.tab = .catalog
        case .list(let id):
            place.tabList = id
            place.tab = .lists
        }
    }

    /// A place scrolled to under one status does not belong to the next, as a list's does not.
    @MainActor private static func write(_ status: String?, to catalog: CatalogModel, place: ShellPlace) {
        if catalog.status != status { place.scrollAnchors[.catalog] = nil }
        StatusScope.choose(status, in: catalog)
    }

    /// Closes the open list once the lists have read and it is not among them, rather than
    /// leaving its page pointing at nothing. `lists` is nil until the first read, so a list open
    /// before then is not taken for a deleted one.
    @MainActor static func closeDeletedList(place: ShellPlace, lists: [String]?) {
        guard let lists, let open = place.tabList, !lists.contains(open) else { return }
        place.tabList = nil
    }

    /// The list a tune page's list chip names, as the sidebar item the page reads.
    @MainActor static func openList(place: ShellPlace) -> SidebarItem {
        place.tabList.map { .list(id: $0) } ?? .catalog
    }

    /// Opens the list a tune page's list chip names on the Lists tab, never over the detail
    /// column.
    @MainActor static func openList(_ item: SidebarItem, place: ShellPlace) {
        guard case .list(let id) = item else { return }
        place.tabList = id
        place.tab = .lists
    }
}
