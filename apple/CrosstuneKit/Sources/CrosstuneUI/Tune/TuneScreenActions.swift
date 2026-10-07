import CrosstuneStore
import SwiftUI

/// What the tune screen starts but another part of the app owns: the list picker, the paste
/// link and Find recordings sheets, the record sheet, the lyrics reader, and the scan viewer.
/// The shell supplies them; a control whose action is missing shows disabled.
public struct TuneScreenActions {
    /// Opens the list picker for the musician's own row of a tune.
    public var addToList: (@MainActor (_ userTuneID: String) -> Void)?
    /// Opens the paste link sheet for a tune.
    public var addLink: (@MainActor (_ tuneID: String) -> Void)?
    /// Opens the Find recordings sheet for a tune, on its list of services or straight on one
    /// service's results.
    public var findRecordings: (@MainActor (_ tuneID: String, _ service: String?) -> Void)?
    /// Starts a recording filed under a tune.
    public var record: (@MainActor (_ tuneID: String) -> Void)?
    /// Opens a tune's lyrics to read.
    public var readLyrics: (@MainActor (_ tuneID: String) -> Void)?
    /// Opens a tune's scans full screen, on the scan at `startIndex`, logging each look as
    /// opened from `origin`. Tune rows offer it too, at the first scan.
    public var viewScans: (@MainActor (_ tuneID: String, _ startIndex: Int, _ origin: ScanViewOrigin) -> Void)?

    public init(
        addToList: (@MainActor (String) -> Void)? = nil, addLink: (@MainActor (String) -> Void)? = nil,
        findRecordings: (@MainActor (String, String?) -> Void)? = nil, record: (@MainActor (String) -> Void)? = nil,
        readLyrics: (@MainActor (String) -> Void)? = nil,
        viewScans: (@MainActor (String, Int, ScanViewOrigin) -> Void)? = nil
    ) {
        self.addToList = addToList
        self.addLink = addLink
        self.findRecordings = findRecordings
        self.record = record
        self.readLyrics = readLyrics
        self.viewScans = viewScans
    }
}

extension EnvironmentValues {
    /// The sheets and transfers the tune screen hands off.
    @Entry public var tuneScreenActions = TuneScreenActions()
    /// The split view's sidebar row, which a screen sets to show a list in the content column.
    /// Nil on iPhone, where a screen pushes the list onto its own stack instead.
    @Entry public var sidebarSelection: ShellValue<SidebarItem>?
}
