import CrosstuneStore
import Foundation

/// An action in the recording screen's ⋯ menu, which holds every screen-level action.
enum RecordingMenuItem: Hashable {
    /// Opens the trim editor; `disabledReason` says why it cannot open now, and the item stays in the
    /// menu, disabled, showing it.
    case trim(disabledReason: String?)
    /// Opens the Split screen, disabled with the reason it cannot open now, as Trim is.
    case split(disabledReason: String?)
    case edit
    case addToTune
    case removeFromTune
    /// Opens an imported recording's page on the site it came from.
    case openOrigin(site: String, page: URL)
    /// Deletes the recording; disabled with `disabledReason` while it cannot go.
    case delete(disabledReason: String?)

    /// The menu in order: Trim, Split, Edit, filing under or out of a tune, Open on when the
    /// recording has a page to open, then Delete. `trims` false leaves Trim and Split out, as on
    /// a free plan.
    static func items(
        inTune: Bool, trimDisabledReason: String?, splitDisabledReason: String? = nil,
        deleteDisabledReason: String? = nil, openOrigin: RecordingMenuItem? = nil, trims: Bool = true
    ) -> [RecordingMenuItem] {
        let tools: [RecordingMenuItem] =
            trims ? [.trim(disabledReason: trimDisabledReason), .split(disabledReason: splitDisabledReason)] : []
        return tools + [.edit, inTune ? .removeFromTune : .addToTune] + (openOrigin.map { [$0] } ?? [])
            + [.delete(disabledReason: deleteDisabledReason)]
    }

    /// The Open on item for `recording`, or nil for one made here or one with no web page.
    static func openOrigin(for recording: Recording) -> RecordingMenuItem? {
        MediaRow.SourceLine(recording: recording).map { .openOrigin(site: $0.title, page: $0.url) }
    }

    var isDelete: Bool {
        if case .delete = self { true } else { false }
    }

    /// Why the item cannot be used now, shown under its label; nil when it can.
    var disabledReason: String? {
        switch self {
        case .trim(let disabledReason), .split(let disabledReason), .delete(let disabledReason): disabledReason
        case .edit, .addToTune, .removeFromTune, .openOrigin: nil
        }
    }

    var label: String {
        switch self {
        case .trim: RecordingScreenText.trim
        case .split: RecordingScreenText.split
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
        case .split: "rectangle.split.3x1"
        case .edit: "pencil"
        case .addToTune: "folder.badge.plus"
        case .removeFromTune: "folder.badge.minus"
        case .openOrigin: "arrow.up.right.square"
        case .delete: "trash"
        }
    }
}
