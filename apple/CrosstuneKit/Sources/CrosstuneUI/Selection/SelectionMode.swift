import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// A list the selection's Remove from list acts on.
struct SelectionList {
    let id: String
    let name: String
    /// The item that puts each tune in the list, by tune id.
    let itemIDs: [String: String]
}

#if os(macOS)
    /// One bulk action on the selected tunes, as the Mac selection bar's Actions menu offers it.
    /// A count is how many tunes the action would change.
    enum SelectionAction: Hashable {
        case status(String)
        case edit
        case addToList
        case archive(count: Int)
        case unarchive(count: Int)
        case remove(count: Int)
        case delete(count: Int)

        /// Where an action sits in the menu, each group set apart from the one before.
        enum Group: CaseIterable {
            case status, change, file, delete
        }

        /// Every action the selected `entries` take: none with nothing selected, Archive and
        /// Unarchive only for tunes they would change, and Remove only in a list.
        nonisolated static func menu(for entries: [CatalogEntry], list: SelectionList?) -> [SelectionAction] {
            guard !entries.isEmpty else { return [] }
            var actions: [SelectionAction] = Vocabulary.statuses.map { .status($0) } + [.edit, .addToList]
            let toArchive = entries.count { !$0.isArchived }
            let toUnarchive = entries.count { $0.isArchived }
            if toArchive > 0 { actions.append(.archive(count: toArchive)) }
            if toUnarchive > 0 { actions.append(.unarchive(count: toUnarchive)) }
            let inList = list.map { list in entries.count { list.itemIDs[$0.tune.id] != nil } } ?? 0
            if inList > 0 { actions.append(.remove(count: inList)) }
            actions.append(.delete(count: entries.count))
            return actions
        }

        var group: Group {
            switch self {
            case .status: .status
            case .edit, .addToList: .change
            case .archive, .unarchive, .remove: .file
            case .delete: .delete
            }
        }

        /// The menu item's words. An item that opens a sheet ends in an ellipsis.
        @MainActor var menuTitle: String {
            switch self {
            case .status(let status): StatusStyle.label(status)
            case .edit: "\(BulkActionText.edit)…"
            case .addToList: "\(BulkActionText.addToList)…"
            case .archive(let count): BulkActionText.archive(true, count: count)
            case .unarchive(let count): BulkActionText.archive(false, count: count)
            case .remove(let count): BulkActionText.remove(count)
            case .delete(let count): BulkActionText.delete(count)
            }
        }

        var systemImage: String {
            switch self {
            case .status: "tag"
            case .edit: TuneRowActions.editSystemImage
            case .addToList: "text.badge.plus"
            case .archive: TuneRowActions.archiveSystemImage(archived: false)
            case .unarchive: TuneRowActions.archiveSystemImage(archived: true)
            case .remove: "text.badge.xmark"
            case .delete: "trash"
            }
        }

        var isDestructive: Bool {
            switch self {
            case .remove, .delete: true
            default: false
            }
        }
    }

    extension EnvironmentValues {
        /// The selection bar a screen of tune rows shows in place of its filter row while
        /// selecting. Set by the selection mode, which holds the actions it runs.
        @Entry var selectionBar: AnyView?
    }
#endif

extension View {
    /// Gives a screen of tune rows its selection mode: the toolbar that counts and acts on the
    /// selected tunes, the edit sheet, the delete question, and the undo banner. `rows` are the
    /// visible tunes in screen order, each tagged in the screen's list by its tune id.
    func selectionMode(
        _ selection: Binding<TuneSelection>, rows: [CatalogEntry], instruments: Set<String>,
        list: SelectionList? = nil, focusedRow: AccessibilityFocusState<String?>.Binding
    ) -> some View {
        modifier(
            SelectionMode(
                selection: selection, rows: rows, instruments: instruments, list: list, focusedRow: focusedRow))
    }
}

private struct SelectionMode: ViewModifier {
    @Binding var selection: TuneSelection
    let rows: [CatalogEntry]
    let instruments: Set<String>
    let list: SelectionList?
    let focusedRow: AccessibilityFocusState<String?>.Binding

    @Environment(\.listSheets) private var listSheets
    /// Set in the split view, whose columns report a compact width even on a wide iPad.
    @Environment(\.detailTune) private var detailTune
    @State private var bulk: BulkActions?
    @State private var editing: SelectedRows<CatalogEntry>?
    @State private var deleting: BulkDeleteQuestion?

    private var visibleIDs: [String] { rows.map(\.tune.id) }
    private var selected: [CatalogEntry] { selection.selected(in: rows) { $0.tune.id } }

    func body(content: Content) -> some View {
        content
            .selectionFrame(
                $selection, visibleIDs: visibleIDs, title: TuneSelection.title, runner: $bulk, focusedRow: focusedRow,
                actions: actions
            )
            .sheet(item: $editing) { sheet in
                if let bulk {
                    BulkEditSheet(entries: sheet.rows, instruments: instruments, bulk: bulk) {
                        selection.exit()
                    }
                }
            }
            #if os(macOS)
                .confirmsSelectionDelete($deleting, button: DeleteTuneMessage.delete, delete: delete)
            #endif
            #if DEBUG
                .opensForSample(.bulkEdit, when: bulk != nil && rows.count >= 3) {
                    let picked = Array(rows.prefix(3))
                    selection.enter(selecting: Set(picked.map(\.tune.id)))
                    editing = SelectedRows(rows: picked)
                }
                .opensForSample(.listSelecting, when: bulk != nil && list != nil && rows.count >= 3) {
                    selection.enter(selecting: [rows[0].tune.id, rows[2].tune.id])
                }
                .opensForSample(.undoBanner, when: bulk != nil) {
                    bulk?.undoBannerItem = UndoBannerItem(message: BulkActionText.statusSet("known", count: 3)) {}
                }
            #endif
    }

    #if os(iOS)
        @ViewBuilder private func actions(_ bulk: BulkActions) -> some View {
            let count = selection.ids.count
            statusMenu(bulk) { SelectionActionLabel(BulkActionText.status, systemImage: "tag") }
                .disabled(count == 0)
            Button {
                edit()
            } label: {
                SelectionActionLabel(BulkActionText.edit, systemImage: TuneRowActions.editSystemImage)
            }
            .buttonStyle(.selectionAction)
            .disabled(count == 0)
            Button {
                addToList(bulk)
            } label: {
                SelectionActionLabel(BulkActionText.addToList, systemImage: "text.badge.plus")
            }
            .buttonStyle(.selectionAction)
            .disabled(count == 0 || listSheets == nil)
            moreMenu(bulk) { SelectionActionLabel(BulkActionText.more, systemImage: "ellipsis") }
                .disabled(count == 0)
                // On More, which offers Delete, so the question points at it.
                .confirmsSelectionDelete($deleting, button: DeleteTuneMessage.delete, delete: delete)
        }
    #endif

    #if os(macOS)
        private func actions(_ bulk: BulkActions) -> [MacSelectionMenuItem] {
            SelectionAction.menuItems(
                SelectionAction.menu(for: selected, list: list), canAddToList: listSheets != nil
            ) { perform($0, bulk) }
        }

        /// Runs a bulk action through the same calls, questions, and undo as the iPhone's toolbar.
        private func perform(_ action: SelectionAction, _ bulk: BulkActions) {
            let entries = selected
            switch action {
            case .status(let status): run { await bulk.setStatus(status, of: entries) }
            case .edit: edit()
            case .addToList: addToList(bulk)
            case .archive: run { await bulk.setArchived(true, entries) }
            case .unarchive: run { await bulk.setArchived(false, entries) }
            case .remove:
                guard let list else { return }
                let itemIDs = entries.compactMap { list.itemIDs[$0.tune.id] }
                run { await bulk.remove(itemIDs: itemIDs, from: list.name, listID: list.id) }
            case .delete: Task { deleting = await bulk.deleteQuestion(entries) }
            }
        }
    #endif

    #if os(iOS)
        private func statusMenu(_ bulk: BulkActions, @ViewBuilder label: () -> some View) -> some View {
            Menu {
                Section(BulkActionText.setStatus) {
                    ForEach(Vocabulary.statuses, id: \.self) { status in
                        Button(StatusStyle.label(status)) {
                            let entries = selected
                            Task {
                                if await bulk.setStatus(status, of: entries) { selection.exit() }
                            }
                        }
                    }
                }
            } label: {
                label()
            }
            .disabled(bulk.isPending)
        }

        private func moreMenu(_ bulk: BulkActions, @ViewBuilder label: () -> some View) -> some View {
            let entries = selected
            let toArchive = entries.count { !$0.isArchived }
            let toUnarchive = entries.count { $0.isArchived }
            let itemIDs = list.map { list in entries.compactMap { list.itemIDs[$0.tune.id] } } ?? []
            return Menu {
                if toArchive > 0 {
                    Button(
                        BulkActionText.archive(true, count: toArchive),
                        systemImage: TuneRowActions.archiveSystemImage(archived: false)
                    ) {
                        run { await bulk.setArchived(true, entries) }
                    }
                }
                if toUnarchive > 0 {
                    Button(
                        BulkActionText.archive(false, count: toUnarchive),
                        systemImage: TuneRowActions.archiveSystemImage(archived: true)
                    ) {
                        run { await bulk.setArchived(false, entries) }
                    }
                }
                if let list, !itemIDs.isEmpty {
                    Button(BulkActionText.remove(itemIDs.count), systemImage: "text.badge.xmark", role: .destructive) {
                        run { await bulk.remove(itemIDs: itemIDs, from: list.name, listID: list.id) }
                    }
                }
                if !entries.isEmpty {
                    Divider()
                    Button(BulkActionText.delete(entries.count), systemImage: "trash", role: .destructive) {
                        Task { deleting = await bulk.deleteQuestion(entries) }
                    }
                }
            } label: {
                label()
            }
            .disabled(bulk.isPending)
        }
    #endif

    private func run(_ action: @escaping @MainActor () async -> Bool) {
        Task {
            if await action() { selection.exit() }
        }
    }

    private func edit() {
        editing = SelectedRows(rows: selected)
    }

    private func addToList(_ bulk: BulkActions) {
        let entries = selected
        let exit = { selection.exit() }
        listSheets?.pick(
            ListPickerRequest(userTuneIDs: entries.map(\.userTune.id), excludeListID: list?.id) { addition in
                bulk.added(addition)
                exit()
            })
    }

    /// Deletes the tunes `question` named, then lets the detail column go of a tune that is gone.
    private func delete(_ question: BulkDeleteQuestion) async {
        guard await bulk?.delete(question) == true else { return }
        selection.exit()
        if let detailTune, let tuneID = detailTune.value, question.tuneIDs.contains(tuneID) {
            detailTune.value = nil
        }
    }
}
