import CrosstuneDesign
import SwiftUI

/// A row's action: its word, glyph, and swipe fill. Every row's swipe actions and the matching
/// menu items draw from these, so a change to one reaches every row that offers it.
struct RowAction {
    let title: String
    let systemImage: String
    let swipeFill: Palette.Token
    /// Shows in red in a menu.
    var isDestructive = false
    /// Asks before it acts, so its swipe action takes no destructive role: with one, SwiftUI
    /// removes the row at once.
    var asksFirst = false

    static let edit = RowAction(
        title: TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, swipeFill: .neutralFill)
    static let delete = RowAction(
        title: RowActionText.delete, systemImage: "trash", swipeFill: .dangerFillStrong, isDestructive: true,
        asksFirst: true)
    static let removeFromList = RowAction(
        title: RowActionText.remove, systemImage: "text.badge.xmark", swipeFill: .dangerFillStrong, isDestructive: true)
    static let scans = RowAction(
        title: TuneRowActions.scans, systemImage: TuneRowActions.scansSystemImage, swipeFill: .neutralFill)

    static func archive(archived: Bool) -> RowAction {
        RowAction(
            title: TuneRowActions.archiveLabel(archived: archived),
            systemImage: TuneRowActions.archiveSystemImage(archived: archived), swipeFill: .warningFillStrong)
    }

    /// Every row action, for tests over all of them.
    static let all: [RowAction] = [
        .edit, .delete, .removeFromList, .scans, .archive(archived: false), .archive(archived: true),
    ]

    var swipeRole: ButtonRole? { isDestructive && !asksFirst ? .destructive : nil }
    var menuRole: ButtonRole? { isDestructive ? .destructive : nil }
}

/// Words more than one row action shares.
public enum RowActionText {
    public static let delete = "Delete"
    public static let remove = "Remove"
}

/// A row action as a trailing swipe action: its glyph on its fill, with its word under it
/// where the row is tall enough for the system to show it. Every swipe action is one of these.
/// With `disabledReason`, it shows disabled.
struct SwipeActionButton: View {
    let action: RowAction
    var disabledReason: String?
    let perform: @MainActor () -> Void

    init(_ action: RowAction, disabledReason: String? = nil, perform: @escaping @MainActor () -> Void) {
        self.action = action
        self.disabledReason = disabledReason
        self.perform = perform
    }

    var body: some View {
        Button(action.title, systemImage: action.systemImage, role: action.swipeRole, action: perform)
            .tint(Palette.color(action.swipeFill))
            .disabled(disabledReason != nil)
            // VoiceOver reads the reason, which a swipe action has no room to show.
            .accessibilityHint(disabledReason ?? "", isEnabled: disabledReason != nil)
    }
}

/// A row action as a context menu item. With `disabledReason`, it shows disabled with the
/// reason under its word.
struct RowMenuButton: View {
    let action: RowAction
    var disabledReason: String?
    let perform: @MainActor () -> Void

    init(_ action: RowAction, disabledReason: String? = nil, perform: @escaping @MainActor () -> Void) {
        self.action = action
        self.disabledReason = disabledReason
        self.perform = perform
    }

    var body: some View {
        Button(role: action.menuRole, action: perform) {
            Label {
                Text(action.title)
                if let disabledReason { Text(disabledReason) }
            } icon: {
                Image(systemName: action.systemImage)
            }
        }
        .disabled(disabledReason != nil)
        // The destructive role reddens the word alone; the tint reddens the glyph with it.
        .tint(action.isDestructive ? Palette.dangerFillStrong : nil)
    }
}
