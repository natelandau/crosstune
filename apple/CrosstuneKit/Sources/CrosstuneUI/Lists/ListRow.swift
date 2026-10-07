import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import SwiftUI

/// The one list row, wherever lists are listed: the name, then how many tunes it holds and when
/// it was last edited.
public struct ListRow: View {
    private let summary: ListSummary

    @Environment(\.spacing) private var spacing

    public init(_ summary: ListSummary) {
        self.summary = summary
    }

    /// "12 tunes · Edited today", the row's second line.
    nonisolated static func detail(count: Int, edited: Timestamp, now: Date = .now) -> String {
        "\(CatalogSearch.tunes(count)) · \(EditedText.label(edited, now: now))"
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: spacing.rowLineGap) {
            Text(summary.name)
                .contentMask()
                .font(.headline)
                .rowLineLimit()
            Text(Self.detail(count: summary.count, edited: summary.lastEditedAt))
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .rowLineLimit()
        }
        .accessibilityElement(children: .combine)
    }
}

/// The verbs a list row offers, on every screen that offers them.
public enum ListRowActions {
    public static let edit = TuneRowActions.edit
    public static let delete = DeleteListMessage.delete
    public static let deleteSystemImage = "trash"
}

extension View {
    /// Gives a list row its actions: Edit, which renames it, and Delete, as trailing swipe
    /// actions and as context menu items, Delete after a separator.
    func listRowActions(onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) -> some View {
        self
            // A long swipe only reveals the actions; no swipe acts on its own.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ListRowSwipeButtons(onEdit: onEdit, onDelete: onDelete)
            }
            .contextMenu {
                ListRowMenuItems(onEdit: onEdit, onDelete: onDelete)
            }
    }

    /// Asks before deleting `list`, naming what stays, then deletes it. A failed delete shows in
    /// an alert, since the row that asked has no line of its own to show it on.
    func confirmsListDelete(_ list: Binding<ListSummary?>) -> some View {
        modifier(ConfirmsListDelete(list: list))
    }
}

#if os(iOS)
    extension TabContent {
        /// Gives a sidebar list row the same actions as ``SwiftUI/View/listRowActions(onEdit:onDelete:)``.
        func listRowActions(onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) -> some TabContent<TabValue> {
            self
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    ListRowSwipeButtons(onEdit: onEdit, onDelete: onDelete)
                }
                .contextMenu {
                    ListRowMenuItems(onEdit: onEdit, onDelete: onDelete)
                }
        }
    }
#endif

private struct ListRowSwipeButtons: View {
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        // The first action sits at the trailing edge, so Edit reads first from the left.
        Button(ListRowActions.delete, systemImage: ListRowActions.deleteSystemImage, role: .destructive) {
            onDelete()
        }
        Button(ListRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
            .tint(.gray)
    }
}

private struct ListRowMenuItems: View {
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button(ListRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
        Divider()
        Button(ListRowActions.delete, systemImage: ListRowActions.deleteSystemImage, role: .destructive) {
            onDelete()
        }
    }
}

private struct ConfirmsListDelete: ViewModifier {
    @Binding var list: ListSummary?

    @Environment(\.commands) private var commands
    @State private var failure: String?

    func body(content: Content) -> some View {
        content
            .coversShell(list != nil)
            .confirmationDialog(
                list.map { DeleteListMessage.title($0.name) } ?? "",
                isPresented: $list.isPresent(),
                titleVisibility: .visible, presenting: list
            ) { list in
                Button(DeleteListMessage.delete, role: .destructive) {
                    Task { await delete(list.id) }
                }
            } message: { _ in
                Text(DeleteListMessage.message)
            }
            .coversShell(failure != nil)
            .alert(
                CatalogModel.actionFailed,
                isPresented: $failure.isPresent()
            ) {
            } message: {
                Text(failure ?? "")
            }
    }

    private func delete(_ listID: String) async {
        guard let commands else { return }
        do {
            try await commands.deleteList(listID)
        } catch {
            failure = failureMessage(error)
        }
    }
}
