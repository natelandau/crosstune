import Observation
import SwiftUI

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

    /// Whether the window is compact, where Settings is a sheet rather than a tab. The shell picks
    /// its layout from this rather than the size class, so ``widened()`` runs before the compact
    /// shell and its sheet are torn down.
    var isCompact = false
    /// Whether `isCompact` has been set from the window, which happens as the shell appears.
    private(set) var knowsSize = false
    /// Whether the Settings sheet is up over a compact window.
    var settingsSheetShown = false
    /// Whether the catalog stands in for a saved Settings tab, which a compact window lacks,
    /// until the musician closes the Settings sheet or the window widens.
    private(set) var catalogStandsInForSettings = false
    /// The page open in the iPad Settings tab's detail column, and the root's page the compact
    /// window's sheet is on, so a size change keeps the same page.
    var settingsPage: SettingsPage?
    /// The pages pushed in the compact window's Settings sheet. The sheet keeps them between
    /// showings, so it reopens where it was left.
    var settingsPath = NavigationPath() {
        didSet {
            // A page popped on iPhone must not come back in the iPad detail column when the
            // window widens.
            if settingsPath.isEmpty { settingsPage = nil }
        }
    }

    /// Shows `destination` in the iPhone and iPad tabs: its tab, with nothing open.
    func showTabRoot(_ destination: Destination) {
        tabTunes[destination] = nil
        if destination == .lists { tabList = nil }
        if destination == .settings {
            settingsPage = nil
            settingsPath = NavigationPath()
        }
        tab = destination
    }

    /// Opens `page` from the Settings root: in the Settings sheet over a compact window, on the
    /// Settings tab otherwise.
    func showSettingsPage(_ page: SettingsPage) {
        if isCompact {
            settingsPage = page
            settingsPath = NavigationPath([page])
            settingsSheetShown = true
        } else {
            showTabRoot(.settings)
            settingsPage = page
            settingsPath.append(page)
        }
    }

    /// Opens the Settings sheet over a compact window where it was left.
    func showSettings() {
        settingsSheetShown = true
    }

    /// Takes the sheet's own show or dismiss. The compact shell outlasts ``widened()``, so a
    /// dismissal that arrives once the window is no longer compact is the sheet's teardown, not a
    /// close.
    func settingsSheetChanged(shown: Bool) {
        guard shown || isCompact else { return }
        settingsSheetShown = shown
        if !shown { catalogStandsInForSettings = false }
    }

    /// The tab to save as the scene's, given the one saved now: a saved Settings while the catalog
    /// stands in for it, so a wider window opens on Settings again, and otherwise the tab shown.
    func tabToSave(saved: Destination) -> Destination {
        catalogStandsInForSettings && saved == .settings && tab == .catalog ? saved : tab
    }

    /// Whether the window shows the compact shell. Until the place knows the window's size, as on
    /// the first frame, the window's own size class says.
    func showsCompactShell(windowIsCompact: Bool) -> Bool {
        knowsSize ? isCompact : windowIsCompact
    }

    /// Takes the tab a scene saved. A compact window has no Settings tab, so a saved Settings
    /// opens the catalog rather than the sheet nobody asked for.
    func restore(tab saved: Destination, compact: Bool) {
        knowsSize = true
        isCompact = compact
        catalogStandsInForSettings = compact && saved == .settings
        tab = catalogStandsInForSettings ? .catalog : saved
    }

    /// Rebuilds the Settings sheet's stack from the iPad detail column's page as the window
    /// narrows, since the iPad shell never pushes or pops that stack. A window narrowed on the
    /// Settings tab, which a compact window lacks, keeps Settings up in the sheet over the catalog.
    func narrowed() {
        knowsSize = true
        isCompact = true
        settingsPath = settingsPage.map { NavigationPath([$0]) } ?? NavigationPath()
        if tab == .settings {
            catalogStandsInForSettings = true
            tab = .catalog
            settingsSheetShown = true
        }
    }

    /// Moves Settings from the sheet to its tab as the window widens, since the sheet belongs to
    /// the compact shell.
    func widened() {
        knowsSize = true
        isCompact = false
        catalogStandsInForSettings = false
        if settingsSheetShown {
            settingsSheetShown = false
            tab = .settings
        }
    }

    /// Shows `destination`'s row in the Mac sidebar. The Lists root and Settings, which the Mac
    /// keeps in its own window, have no row, so they fall back to the catalog.
    func showSidebarRoot(_ destination: Destination) {
        sidebar =
            switch destination {
            case .catalog, .lists, .settings: .catalog
            case .recordings: .recordings
            case .tuner: .tuner
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
