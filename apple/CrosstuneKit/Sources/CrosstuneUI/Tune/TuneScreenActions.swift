import CrosstuneStore
import SwiftUI

/// What the tune screen starts but another part of the app owns: the list picker, the paste
/// link sheet, the record sheet, and the lyrics reader. The shell supplies them; a control whose
/// action is missing shows disabled.
public struct TuneScreenActions {
    /// Opens the list picker for the musician's own row of a tune.
    public var addToList: (@MainActor (_ userTuneID: String) -> Void)?
    /// Opens the paste link sheet for a tune.
    public var addLink: (@MainActor (_ tuneID: String) -> Void)?
    /// Starts a recording filed under a tune.
    public var record: (@MainActor (_ tuneID: String) -> Void)?
    /// Opens a tune's lyrics to read.
    public var readLyrics: (@MainActor (_ tuneID: String) -> Void)?

    public init(
        addToList: (@MainActor (String) -> Void)? = nil, addLink: (@MainActor (String) -> Void)? = nil,
        record: (@MainActor (String) -> Void)? = nil, readLyrics: (@MainActor (String) -> Void)? = nil
    ) {
        self.addToList = addToList
        self.addLink = addLink
        self.record = record
        self.readLyrics = readLyrics
    }
}

extension EnvironmentValues {
    /// The sheets and transfers the tune screen hands off.
    @Entry public var tuneScreenActions = TuneScreenActions()
    /// The split view's sidebar row, which a screen sets to show a list in the content column.
    /// Nil on iPhone, where a screen pushes the list onto its own stack instead.
    @Entry public var sidebarSelection: Binding<SidebarItem>?
}
