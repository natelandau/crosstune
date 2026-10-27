import CrosstuneDesign

#if os(macOS)
    import CrosstuneVocabulary
    import SwiftUI

    /// The row that replaces a column's filter row while selecting: Select all, one Actions
    /// menu of every bulk action, and Done. The column title above it carries the count.
    struct MacSelectionBar: View {
        let count: Int
        /// Whether every visible tune is selected, which turns Select all into Deselect all.
        let allSelected: Bool
        let canSelectAll: Bool
        let onSelectAll: () -> Void
        let actions: [SelectionAction]
        /// Whether Add to list has a picker to open.
        let canAddToList: Bool
        let isPending: Bool
        let onAction: (SelectionAction) -> Void
        let onDone: () -> Void

        var body: some View {
            HStack(spacing: 8) {
                Button(allSelected ? TuneSelection.deselectAllItem : TuneSelection.selectAllItem, action: onSelectAll)
                    .buttonStyle(.macPlain)
                    .disabled(!canSelectAll)
                Spacer(minLength: 8)
                actionsMenu
                Button(TuneSelection.done, action: onDone)
                    .buttonStyle(.macPrimary)
            }
            .frame(height: MacStyle.columnBarHeight)
        }

        private var actionsMenu: some View {
            Menu {
                let statuses = actions.compactMap { action -> String? in
                    if case .status(let status) = action { status } else { nil }
                }
                if !statuses.isEmpty {
                    Menu(BulkActionText.setStatus, systemImage: "tag") {
                        ForEach(statuses, id: \.self) { status in
                            Button(StatusStyle.label(status)) { onAction(.status(status)) }
                        }
                    }
                }
                // The tunes' own changes, then what leaves the column, then the delete apart.
                ForEach(SelectionAction.Group.allCases.filter { $0 != .status }, id: \.self) { group in
                    let items = actions.filter { $0.group == group }
                    if group != .change, !items.isEmpty { Divider() }
                    ForEach(items, id: \.self) { action in
                        Button(
                            action.menuTitle, systemImage: action.systemImage,
                            role: action.isDestructive ? .destructive : nil
                        ) {
                            onAction(action)
                        }
                        .disabled(action == .addToList && !canAddToList)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(TuneSelection.actions)
                    Image(systemName: "chevron.down")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                }
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(.macSecondary)
            .fixedSize()
            .disabled(count == 0 || isPending)
        }
    }

    /// Where a column's list shows the selection bar, which the selection mode supplies.
    struct SelectionBarSlot: View {
        @Environment(\.selectionBar) private var bar

        var body: some View {
            bar
        }
    }
#endif
