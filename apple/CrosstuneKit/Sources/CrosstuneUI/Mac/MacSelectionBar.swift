import CrosstuneDesign

#if os(macOS)
    import CrosstuneVocabulary
    import SwiftUI

    /// One item of the Mac selection bar's Actions menu: an action, or a submenu of them.
    struct MacSelectionMenuItem: Identifiable {
        /// The app's own words for the item, never the musician's.
        let label: String
        var systemImage: String?
        var isDestructive = false
        var isDisabled = false
        /// Why the item cannot be used now, shown under its word. The item is disabled with it.
        var disabledReason: String?
        /// Sets the item apart from the one before.
        var startsGroup = false
        /// A submenu's items; empty for an item that acts.
        var submenu: [MacSelectionMenuItem] = []
        var action: () -> Void = {}

        var id: String { label }
    }

    /// The row that replaces a column's filter row while selecting: Select all, one Actions
    /// menu of every bulk action, and Done. The column title above it carries the count. The
    /// screen supplies the menu's items.
    struct MacSelectionBar: View {
        let count: Int
        /// Whether every visible row is selected, which turns Select all into Deselect all.
        let allSelected: Bool
        let canSelectAll: Bool
        let onSelectAll: () -> Void
        let items: [MacSelectionMenuItem]
        let isPending: Bool
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
            MacPullDown(TuneSelection.actions, value: TuneSelection.actions, size: .regular) {
                ForEach(items) { item in
                    if item.startsGroup { Divider() }
                    if item.submenu.isEmpty {
                        button(item)
                    } else {
                        Menu(item.label, systemImage: item.systemImage ?? "") {
                            ForEach(item.submenu) { button($0) }
                        }
                    }
                }
            }
            // The menu's word names it, so the pull-down draws no label beside it.
            .labeledContentStyle(MacControlOnlyStyle())
            .fixedSize()
            .disabled(count == 0 || isPending)
        }

        private func button(_ item: MacSelectionMenuItem) -> some View {
            Button(role: item.isDestructive ? .destructive : nil, action: item.action) {
                if let systemImage = item.systemImage {
                    Label {
                        itemText(item)
                    } icon: {
                        Image(systemName: systemImage)
                    }
                } else {
                    itemText(item)
                }
            }
            .disabled(item.isDisabled || item.disabledReason != nil)
        }

        /// The item's word, and under it why it cannot be used now.
        @ViewBuilder private func itemText(_ item: MacSelectionMenuItem) -> some View {
            Text(item.label)
            if let reason = item.disabledReason { Text(reason) }
        }
    }

    extension MacSelectionBar {
        /// The bar for a selection of tunes, whose menu lists `actions`.
        init(
            count: Int, allSelected: Bool, canSelectAll: Bool, onSelectAll: @escaping () -> Void,
            actions: [SelectionAction], canAddToList: Bool, isPending: Bool,
            onAction: @escaping (SelectionAction) -> Void, onDone: @escaping () -> Void
        ) {
            self.init(
                count: count, allSelected: allSelected, canSelectAll: canSelectAll, onSelectAll: onSelectAll,
                items: SelectionAction.menuItems(actions, canAddToList: canAddToList, onAction: onAction),
                isPending: isPending, onDone: onDone)
        }
    }

    extension SelectionAction {
        /// The Actions menu for a selection of tunes: Set status as a submenu, then the tunes' own
        /// changes, then what leaves the column, then the delete apart.
        @MainActor static func menuItems(
            _ actions: [SelectionAction], canAddToList: Bool, onAction: @escaping (SelectionAction) -> Void
        ) -> [MacSelectionMenuItem] {
            var items: [MacSelectionMenuItem] = []
            let statuses = actions.compactMap { action -> String? in
                if case .status(let status) = action { status } else { nil }
            }
            if !statuses.isEmpty {
                items.append(
                    MacSelectionMenuItem(
                        label: BulkActionText.setStatus, systemImage: "tag",
                        submenu: statuses.map { status in
                            MacSelectionMenuItem(label: StatusStyle.label(status)) { onAction(.status(status)) }
                        }))
            }
            for group in SelectionAction.Group.allCases where group != .status {
                for (index, action) in actions.filter({ $0.group == group }).enumerated() {
                    items.append(
                        MacSelectionMenuItem(
                            label: action.menuTitle, systemImage: action.systemImage,
                            isDestructive: action.isDestructive,
                            isDisabled: action == .addToList && !canAddToList,
                            startsGroup: index == 0 && group != .change
                        ) { onAction(action) })
                }
            }
            return items
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
