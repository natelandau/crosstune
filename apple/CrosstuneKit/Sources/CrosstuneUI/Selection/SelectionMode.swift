import CrosstuneAnalytics
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

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.listSheets) private var listSheets
    @Environment(\.undoManager) private var undoManager
    /// Set in the split view, whose columns report a compact width even on a wide iPad.
    @Environment(\.detailTune) private var detailTune
    @Environment(\.spacing) private var spacing
    @State private var bulk: BulkActions?
    @State private var editing: [CatalogEntry]?
    @State private var deleting: BulkDeleteQuestion?

    private var visibleIDs: [String] { rows.map(\.tune.id) }
    private var selected: [CatalogEntry] { selection.selected(in: rows) { $0.tune.id } }

    func body(content: Content) -> some View {
        content
            #if os(iOS)
                .toolbar {
                    if selection.isActive, let bulk { toolbar(bulk) }
                }
            #else
                // The screen's list shows the bar in place of its filter row.
                .environment(\.selectionBar, selection.isActive ? bulk.map { AnyView(selectionBar($0)) } : nil)
                .background {
                    // Escape ends the mode even with the bar and its Done scrolled out of the list.
                    if selection.isActive {
                        Button(TuneSelection.done) { selection.exit() }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                    }
                }
            #endif
            #if os(iOS)
                .environment(\.editMode, .constant(selection.isActive ? .active : .inactive))
                .toolbarVisibility(selection.isActive ? .hidden : .automatic, for: .tabBar)
                // A screen wearing the selection toolbar shows no back button.
                .navigationBarBackButtonHidden(selection.isActive)
            #endif
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = bulk?.failure {
                    Text(failure)
                        .font(.platform(.footnote))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, spacing.stackGap)
                }
            }
            // The selection's bottom toolbar takes the tab bar's place, record slot and all.
            .claimsSelection(selection.isActive)
            .onChange(of: selection.isActive) { _, active in
                modeChanged(active)
            }
            .onChange(of: visibleIDs) { _, visible in
                selection.prune(visible: visible)
            }
            // Leaving the screen ends the mode.
            .onDisappear {
                selection.exit()
            }
            .sheet(item: editingSheet) { sheet in
                if let bulk {
                    BulkEditSheet(entries: sheet.entries, instruments: instruments, bulk: bulk) {
                        selection.exit()
                    }
                }
            }
            .coversShell(deleting != nil)
            .confirmationDialog(
                deleting?.title ?? "", isPresented: isDeleting, titleVisibility: .visible, presenting: deleting
            ) { question in
                Button(DeleteTuneMessage.delete, role: .destructive) {
                    Task {
                        if await bulk?.delete(question) == true { selection.exit() }
                    }
                }
            } message: { question in
                Text(question.message)
            }
            .undoBanner(offer)
            #if DEBUG
                .opensForSample(.bulkEdit, when: bulk != nil && rows.count >= 3) {
                    let picked = Array(rows.prefix(3))
                    selection.enter(selecting: Set(picked.map(\.tune.id)))
                    editing = picked
                }
                .opensForSample(.listSelecting, when: bulk != nil && list != nil && rows.count >= 3) {
                    selection.enter(selecting: [rows[0].tune.id, rows[2].tune.id])
                }
                .opensForSample(.undoBanner, when: bulk != nil) {
                    bulk?.offer = UndoOffer(message: BulkActionText.statusSet("known", count: 3)) {}
                }
            #endif
            .task(id: store.map(ObjectIdentifier.init)) {
                guard let store else { return }
                bulk = BulkActions(store: store, analytics: analytics)
                bulk?.undoManager = undoManager
            }
            .onChange(of: undoManager) { bulk?.undoManager = undoManager }
    }

    #if os(iOS)
        @ToolbarContentBuilder private func toolbar(_ bulk: BulkActions) -> some ToolbarContent {
            let count = selected.count
            ToolbarItem(placement: .topBarLeading) {
                let allSelected = selection.allSelected(visible: visibleIDs)
                Button(allSelected ? TuneSelection.deselectAll : TuneSelection.selectAll) {
                    toggleAll()
                }
                // Command-A selects all and never clears, so it leaves with Deselect All.
                .keyboardShortcut(allSelected ? nil : KeyboardShortcut("a"))
            }
            ToolbarItem(placement: .topBarTrailing) { doneButton }
            // A split view's column is too narrow for four worded actions, so there they show
            // as glyphs, still named in words.
            let worded = detailTune == nil
            ToolbarItem(placement: .bottomBar) {
                statusMenu(bulk) { actionLabel(BulkActionText.status, "tag", worded: worded) }
                    .disabled(count == 0)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button {
                    edit()
                } label: {
                    actionLabel(BulkActionText.edit, TuneRowActions.editSystemImage, worded: worded)
                }
                .disabled(count == 0)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button {
                    addToList(bulk)
                } label: {
                    actionLabel(BulkActionText.addToList, "text.badge.plus", worded: worded)
                }
                .disabled(count == 0 || listSheets == nil)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                moreMenu(bulk) { actionLabel(BulkActionText.more, "ellipsis", worded: worded) }
                    .disabled(count == 0)
            }
        }

        /// A bottom bar action's label: its word, or its glyph named by the word.
        @ViewBuilder private func actionLabel(_ title: String, _ systemImage: String, worded: Bool) -> some View {
            if worded {
                Text(title)
            } else {
                Label(title, systemImage: systemImage)
                    .labelStyle(.iconOnly)
            }
        }
    #endif

    #if os(macOS)
        private func selectionBar(_ bulk: BulkActions) -> some View {
            MacSelectionBar(
                count: selected.count, allSelected: selection.allSelected(visible: visibleIDs),
                canSelectAll: !visibleIDs.isEmpty, onSelectAll: toggleAll,
                actions: SelectionAction.menu(for: selected, list: list), canAddToList: listSheets != nil,
                isPending: bulk.isPending, onAction: { perform($0, bulk) }, onDone: { selection.exit() })
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
        private var doneButton: some View {
            Button(TuneSelection.done) { selection.exit() }
                .fontWeight(.semibold)
                // Escape leaves the mode.
                .keyboardShortcut(.cancelAction)
        }

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
        editing = selected
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

    private func modeChanged(_ active: Bool) {
        if active {
            focusedRow.wrappedValue = selection.origin ?? visibleIDs.first
            // A row entry is heard through the focus move and the row's selected trait; one from
            // the toolbar has no row to speak for it.
            if selection.origin == nil { announceCount() }
        } else {
            // VoiceOver returns to the row the mode was entered from, when it still shows.
            if let origin = selection.origin, visibleIDs.contains(origin) { focusedRow.wrappedValue = origin }
        }
    }

    /// Select all and Deselect all change rows the musician is not on, so the count is said.
    private func toggleAll() {
        selection.toggleAll(visible: visibleIDs)
        announceCount()
    }

    private func announceCount() {
        AccessibilityNotification.Announcement(TuneSelection.title(selection.ids.count)).post()
    }

    private var editingSheet: Binding<EditingSheet?> {
        Binding {
            editing.map(EditingSheet.init)
        } set: {
            if $0 == nil { editing = nil }
        }
    }

    private var isDeleting: Binding<Bool> {
        $deleting.isPresent()
    }

    private var offer: Binding<UndoOffer?> {
        Binding {
            bulk?.offer
        } set: {
            bulk?.offer = $0
        }
    }
}

/// The tunes an open edit sheet works over, fixed as it opens.
private struct EditingSheet: Identifiable {
    let entries: [CatalogEntry]
    var id: [String] { entries.map(\.id) }
}
