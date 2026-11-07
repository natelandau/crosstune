import CrosstuneAnalytics
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
    /// The tune in the Mac split view's detail column, and the recording page over it, under
    /// which the tune stays mounted.
    var detailPath = PagePath()
    /// The iPhone and iPad shells' tab.
    var tab: Destination = .catalog
    /// Whether the scene's saved tab replaces `tab` as the shell appears. False keeps a tab chosen
    /// before the shell shows, as a sample screen's.
    var restoresTab = true
    /// The list open on the Lists tab.
    var tabList: String? {
        didSet {
            // A tune pushed over one list, or a place scrolled to in it, does not belong to the next.
            if tabList != oldValue {
                tabPaths[.lists] = nil
                scrollAnchors[.lists] = nil
            }
        }
    }
    /// What each tab has open over its screen: pushed on iPhone, in the detail column on iPad.
    var tabPaths: [Destination: PagePath] = [:]
    /// The last recording page asked for in this window, until that page reports it opened.
    /// Observed, so a page already on show takes a fresh request for its own recording.
    private(set) var unreportedOpen: PageOpen?
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
    /// Whether the catalog replaces a saved Settings tab, which a compact window lacks,
    /// until the musician closes the Settings sheet or the window widens.
    private(set) var catalogReplacesSettings = false
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
        tabPaths[destination] = nil
        if destination == .lists { tabList = nil }
        if destination == .settings {
            settingsPage = nil
            settingsPath = NavigationPath()
        }
        tab = destination
    }

    /// Opens a tune from outside any tab's own screens: in the Mac detail column, beside the
    /// catalog where the tuner fills it, and on iPhone and iPad in the tab on show where that tab
    /// shows tunes, else in the catalog's.
    func openTune(_ tuneID: String) {
        #if os(macOS)
            if sidebar == .tuner { sidebar = .catalog }
            detailPath.recording = nil
            detailPath.tune = tuneID
        #else
            openTuneInTabs(tuneID)
        #endif
    }

    /// Opens a tune in the iPhone and iPad tabs: in the tab on show where that tab shows tunes,
    /// else in the catalog's. Over a compact window's recording page, the tune is pushed over the
    /// page, so Back returns to it, unless the page sits over that same tune, which the page then
    /// goes back to. Elsewhere it takes the tab's tune and closes the page.
    func openTuneInTabs(_ tuneID: String) {
        if showsTunes(tab), isCompact, let path = tabPaths[tab], path.recording != nil, path.tune != tuneID {
            tabPaths[tab]?.pageTune = tuneID
            return
        }
        if !showsTunes(tab) { tab = .catalog }
        tabPaths[tab, default: PagePath()].recording = nil
        tabPaths[tab, default: PagePath()].tune = tuneID
    }

    /// Opens recording `id`'s page from outside any tab's own screens: over the Mac detail
    /// column's tune, beside the recordings where the tuner fills the window, and on iPhone and
    /// iPad over the tab on show where that tab shows tunes, else in the Recordings tab. The page
    /// shows `tab`, or Practice when nil, and reports `source` as where it was asked for.
    func openRecordingPage(_ id: String, tab: RecordingPageTab? = nil, source: ActionSource) {
        unreportedOpen = PageOpen(recordingID: id, tab: tab, source: source)
        #if os(macOS)
            if sidebar == .tuner { sidebar = .recordings }
            detailPath.recording = id
        #else
            openRecordingPageInTabs(id)
        #endif
    }

    /// The request for recording `id`'s page still to report, once: nil when there is none, as for
    /// a page that shows again on its own.
    func takeUnreportedOpen(of id: String) -> PageOpen? {
        guard let open = unreportedOpen, open.recordingID == id else { return nil }
        unreportedOpen = nil
        return open
    }

    /// Opens recording `id`'s page in the iPhone and iPad tabs: over the tab on show where that
    /// tab shows tunes, else in the Recordings tab. Reopening the page on show takes it back from
    /// a tune pushed over it.
    func openRecordingPageInTabs(_ id: String) {
        if !showsTunes(tab) { tab = .recordings }
        tabPaths[tab, default: PagePath()].recording = id
        tabPaths[tab]?.pageTune = nil
    }

    /// Opens the new-tune draft: in the Mac detail column, beside the catalog where the tuner
    /// fills it, and on iPhone and iPad on the catalog's tab.
    func openNewTune(source: ActionSource) {
        let draft = NewTuneDraft.id(source: source)
        #if os(macOS)
            if sidebar == .tuner { sidebar = .catalog }
            detailPath.recording = nil
            detailPath.tune = draft
        #else
            tab = .catalog
            tabPaths[.catalog, default: PagePath()].recording = nil
            tabPaths[.catalog, default: PagePath()].tune = draft
        #endif
    }

    /// Whether a tab's screen opens tunes: the catalog, the recordings, and an open list.
    private func showsTunes(_ destination: Destination) -> Bool {
        switch destination {
        case .catalog, .recordings: true
        case .lists: tabList != nil
        case .tuner, .settings: false
        }
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
        if !shown { catalogReplacesSettings = false }
    }

    /// The tab to save as the scene's, given the one saved now: a saved Settings while the catalog
    /// replaces it, so a wider window opens on Settings again, and otherwise the tab shown.
    func tabToSave(saved: Destination) -> Destination {
        catalogReplacesSettings && saved == .settings && tab == .catalog ? saved : tab
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
        guard restoresTab else { return }
        catalogReplacesSettings = compact && saved == .settings
        tab = catalogReplacesSettings ? .catalog : saved
    }

    /// Rebuilds the Settings sheet's stack from the iPad detail column's page as the window
    /// narrows, since the iPad shell never pushes or pops that stack. A window narrowed on the
    /// Settings tab, which a compact window lacks, keeps Settings up in the sheet over the catalog.
    func narrowed() {
        knowsSize = true
        isCompact = true
        settingsPath = settingsPage.map { NavigationPath([$0]) } ?? NavigationPath()
        if tab == .settings {
            catalogReplacesSettings = true
            tab = .catalog
            settingsSheetShown = true
        }
    }

    /// Moves Settings from the sheet to its tab as the window widens, since the sheet belongs to
    /// the compact shell.
    func widened() {
        knowsSize = true
        isCompact = false
        // The split view has no place for a tune over a page, so narrowing never brings one back.
        for destination in tabPaths.keys { tabPaths[destination]?.pageTune = nil }
        catalogReplacesSettings = false
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

/// A request for a recording's page: the tab it opens on, nil for Practice, and where it
/// was asked for.
struct PageOpen: Equatable {
    let recordingID: String
    let tab: RecordingPageTab?
    let source: ActionSource
    /// Tells two requests for the same page apart.
    let id = UUID()
}

/// What a tab, or the Mac detail column, has open over its own screen, each part belonging to the
/// one before it: a tune, a recording page opened over it, and the tune a compact window pushes
/// over that page, so Back returns to the page. Another tune closes the page, and another page
/// closes the tune pushed over it.
struct PagePath: Equatable {
    var tune: String? {
        didSet { if tune != oldValue { recording = nil } }
    }
    var recording: String? {
        didSet { if recording != oldValue { pageTune = nil } }
    }
    var pageTune: String?

    /// What a detail column shows of the path.
    var detail: DetailPage {
        if let recording { return .recording(recording) }
        return tune.map(DetailPage.tune) ?? .placeholder
    }

    /// The detail column's tune as a list sees it: none while a recording page covers it, so no
    /// row shows as open and a press on the covered tune still writes.
    var listedTune: String? { detail.tuneID }

    /// A list's write of the detail column's tune. Any tune closes the recording page, the covered
    /// one included; a clear while a page shows leaves the tune under it.
    mutating func setListedTune(_ tuneID: String?) {
        if let tuneID {
            recording = nil
            tune = tuneID
        } else if recording == nil {
            tune = nil
        }
    }
}

/// What a detail column shows: the recording page opened there, which covers the tune under it,
/// otherwise the tune, otherwise the placeholder. What the player has loaded never decides it.
enum DetailPage: Equatable {
    case recording(String)
    case tune(String)
    case placeholder

    /// The tune on show, nil while a recording page covers it.
    var tuneID: String? {
        if case .tune(let id) = self { id } else { nil }
    }
}

/// A list pushed on the iPhone and iPad Lists tab.
struct ListRoute: Hashable {
    let id: String
}
