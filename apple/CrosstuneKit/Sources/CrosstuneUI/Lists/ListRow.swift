import CrosstuneCommands
import CrosstuneStore
import SwiftUI

/// The one list row, wherever lists are listed: the name, then how many tunes it holds and when
/// it was last edited.
public struct ListRow: View {
    private let summary: ListSummary

    public init(_ summary: ListSummary) {
        self.summary = summary
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(summary.name)
                .font(.headline)
                .rowLineLimit()
            Text(summary.details())
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .rowLineLimit()
        }
        .padding(.vertical, 4)
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
                // The first action sits at the trailing edge, so Edit reads first from the left.
                Button(ListRowActions.delete, systemImage: ListRowActions.deleteSystemImage, role: .destructive) {
                    onDelete()
                }
                Button(ListRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
                    .tint(.gray)
            }
            .contextMenu {
                Button(ListRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
                Divider()
                Button(ListRowActions.delete, systemImage: ListRowActions.deleteSystemImage, role: .destructive) {
                    onDelete()
                }
            }
    }

    /// Asks before deleting `list`, naming what stays, then deletes it. A failed delete shows in
    /// an alert, since the row that asked has no line of its own to show it on.
    func confirmsListDelete(_ list: Binding<ListSummary?>) -> some View {
        modifier(ConfirmsListDelete(list: list))
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
                isPresented: Binding {
                    list != nil
                } set: {
                    if !$0 { list = nil }
                },
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
                isPresented: Binding {
                    failure != nil
                } set: {
                    if !$0 { failure = nil }
                }
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
            failure = ListModel.message(error)
        }
    }
}
