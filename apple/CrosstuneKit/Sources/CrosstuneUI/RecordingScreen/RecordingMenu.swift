/// An action in the recording screen's ⋯ menu, which holds every screen-level action.
enum RecordingMenuItem: Hashable {
    /// Opens the trim editor; `blocker` says why it cannot open now, and the item stays in the
    /// menu, disabled, showing it.
    case trim(blocker: String?)
    case rename
    case addToTune
    case removeFromTune
    case delete

    /// The menu in order: Trim, Rename, then filing under or out of a tune, then Delete.
    static func items(inTune: Bool, trimBlocker: String?) -> [RecordingMenuItem] {
        [.trim(blocker: trimBlocker), .rename, inTune ? .removeFromTune : .addToTune, .delete]
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
        case .delete: RecordingRowActions.delete
        }
    }

    var systemImage: String {
        switch self {
        case .trim: "scissors"
        case .rename: "pencil"
        case .addToTune: "folder.badge.plus"
        case .removeFromTune: "folder.badge.minus"
        case .delete: "trash"
        }
    }
}
