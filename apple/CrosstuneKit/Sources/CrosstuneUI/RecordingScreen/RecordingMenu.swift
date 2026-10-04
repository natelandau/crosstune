import CrosstuneStore
import Foundation

/// An action in the recording screen's ⋯ menu, which holds every screen-level action.
enum RecordingMenuItem: Hashable {
    /// Opens the trim editor; `blocker` says why it cannot open now, and the item stays in the
    /// menu, disabled, showing it.
    case trim(blocker: String?)
    case rename
    case addToTune
    case removeFromTune
    /// Opens an imported recording's page on the site it came from.
    case openOrigin(site: String, page: URL)
    case delete

    /// The menu in order: Trim, Rename, filing under or out of a tune, Open on when the
    /// recording has a page to open, then Delete.
    static func items(
        inTune: Bool, trimBlocker: String?, openOrigin: RecordingMenuItem? = nil
    ) -> [RecordingMenuItem] {
        [.trim(blocker: trimBlocker), .rename, inTune ? .removeFromTune : .addToTune]
            + (openOrigin.map { [$0] } ?? []) + [.delete]
    }

    /// The Open on item for `recording`, or nil for one made here or one with no web page.
    static func openOrigin(for recording: Recording) -> RecordingMenuItem? {
        guard let site = RecordingText.originLabel(recording.origin),
            let page = RecordingRowActions.originPage(recording)
        else { return nil }
        return .openOrigin(site: site, page: page)
    }

    /// Why the item cannot be used now, shown under its label; nil when it can.
    var blocker: String? {
        if case .trim(let blocker) = self { blocker } else { nil }
    }

    var label: String {
        switch self {
        case .trim: RecordingScreenText.trim
        case .rename: RecordingRowActions.rename
        case .addToTune: RecordingRowActions.addToTune
        case .removeFromTune: RecordingRowActions.removeFromTune
        case .openOrigin(let site, _): RecordingRowActions.openOn(site)
        case .delete: RecordingRowActions.delete
        }
    }

    var systemImage: String {
        switch self {
        case .trim: "scissors"
        case .rename: "pencil"
        case .addToTune: "folder.badge.plus"
        case .removeFromTune: "folder.badge.minus"
        case .openOrigin: "arrow.up.right.square"
        case .delete: "trash"
        }
    }
}
