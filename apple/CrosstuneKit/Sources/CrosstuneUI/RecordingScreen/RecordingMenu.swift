import CrosstuneStore
import Foundation

/// An action in the recording screen's ⋯ menu, which holds every screen-level action.
enum RecordingMenuItem: Hashable {
    /// Opens the trim editor; `blocker` says why it cannot open now, and the item stays in the
    /// menu, disabled, showing it.
    case trim(blocker: String?)
    case edit
    case addToTune
    case removeFromTune
    /// Opens an imported recording's page on the site it came from.
    case openOrigin(site: String, page: URL)
    case delete

    /// The menu in order: Trim, Edit, filing under or out of a tune, Open on when the
    /// recording has a page to open, then Delete.
    static func items(
        inTune: Bool, trimBlocker: String?, openOrigin: RecordingMenuItem? = nil
    ) -> [RecordingMenuItem] {
        [.trim(blocker: trimBlocker), .edit, inTune ? .removeFromTune : .addToTune]
            + (openOrigin.map { [$0] } ?? []) + [.delete]
    }

    /// The Open on item for `recording`, or nil for one made here or one with no web page.
    static func openOrigin(for recording: Recording) -> RecordingMenuItem? {
        MediaRow.SourceLine(recording: recording).map { .openOrigin(site: $0.title, page: $0.url) }
    }

    /// Why the item cannot be used now, shown under its label; nil when it can.
    var blocker: String? {
        if case .trim(let blocker) = self { blocker } else { nil }
    }

    var label: String {
        switch self {
        case .trim: RecordingScreenText.trim
        case .edit: RecordingRowActions.edit
        case .addToTune: RecordingRowActions.addToTune
        case .removeFromTune: RecordingRowActions.removeFromTune
        case .openOrigin(let site, _): RecordingRowActions.openOn(site)
        case .delete: RecordingRowActions.delete
        }
    }

    var systemImage: String {
        switch self {
        case .trim: "scissors"
        case .edit: "pencil"
        case .addToTune: "folder.badge.plus"
        case .removeFromTune: "folder.badge.minus"
        case .openOrigin: "arrow.up.right.square"
        case .delete: "trash"
        }
    }
}
