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
    @Environment(\.listSheets) private var listSheets
    @Environment(\.undoManager) private var undoManager
    /// Set in the split view, whose columns report a compact width even on a wide iPad.
    @Environment(\.detailTune) private var detailTune
    @State private var bulk: BulkActions?
    @State private var editing: [CatalogEntry]?
    @State private var deleting: BulkDeleteQuestion?

    private var visibleIDs: [String] { rows.map(\.tune.id) }
    private var selected: [CatalogEntry] { selection.selected(in: rows) { $0.tune.id } }

    func body(content: Content) -> some View {
        content
            .toolbar {
                if selection.isActive, let bulk { toolbar(bulk) }
            }
            #if os(iOS)
                .environment(\.editMode, .constant(selection.isActive ? .active : .inactive))
                .toolbar(selection.isActive ? .hidden : .automatic, for: .tabBar)
                // A screen wearing the selection toolbar shows no back button.
                .navigationBarBackButtonHidden(selection.isActive)
            #endif
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = bulk?.failure {
                    Text(failure)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                }
            }
            .sensoryFeedback(.selection, trigger: selection.isActive) { was, now in !was && now }
            // The selection's bottom toolbar takes the tab bar's place, dome and all.
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
            .task(id: store.map(ObjectIdentifier.init)) {
                guard let store else { return }
                bulk = BulkActions(store: store)
                bulk?.undoManager = undoManager
            }
            .onChange(of: undoManager) { bulk?.undoManager = undoManager }
    }

    @ToolbarContentBuilder private func toolbar(_ bulk: BulkActions) -> some ToolbarContent {
        let count = selected.count
        #if os(iOS)
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
                moreMenu(bulk, selectsAll: false) { actionLabel(BulkActionText.more, "ellipsis", worded: worded) }
                    .disabled(count == 0)
            }
        #else
            ToolbarItemGroup(placement: .primaryAction) {
                actionButtons(bulk, count: count)
                // Live at any count, since Select all lives in it and the mode opens at zero.
                moreMenu(bulk, selectsAll: true) { Label(BulkActionText.more, systemImage: "ellipsis") }
                doneButton
            }
        #endif
    }

    #if os(iOS)
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
        /// Status, Edit, and Add to list as glyph buttons named in words.
        @ViewBuilder private func actionButtons(_ bulk: BulkActions, count: Int) -> some View {
            statusMenu(bulk) { Label(BulkActionText.status, systemImage: "tag") }
                .disabled(count == 0)
            Button(BulkActionText.edit, systemImage: TuneRowActions.editSystemImage) { edit() }
                .disabled(count == 0)
            Button(BulkActionText.addToList, systemImage: "text.badge.plus") { addToList(bulk) }
                .disabled(count == 0 || listSheets == nil)
        }
    #endif

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

    private func moreMenu(_ bulk: BulkActions, selectsAll: Bool, @ViewBuilder label: () -> some View) -> some View {
        let entries = selected
        let toArchive = entries.count { !$0.isArchived }
        let toUnarchive = entries.count { $0.isArchived }
        let itemIDs = list.map { list in entries.compactMap { list.itemIDs[$0.tune.id] } } ?? []
        return Menu {
            if selectsAll {
                Button(
                    selection.allSelected(visible: visibleIDs)
                        ? TuneSelection.deselectAllItem : TuneSelection.selectAllItem
                ) {
                    toggleAll()
                }
                .disabled(visibleIDs.isEmpty)
                Divider()
            }
            if toArchive > 0 {
                Button(
                    BulkActionText.archive(true, count: toArchive),
                    systemImage: TuneRowActions.archiveSystemImage(archived: false)
                ) {
                    run(bulk) { await bulk.setArchived(true, entries) }
                }
            }
            if toUnarchive > 0 {
                Button(
                    BulkActionText.archive(false, count: toUnarchive),
                    systemImage: TuneRowActions.archiveSystemImage(archived: true)
                ) {
                    run(bulk) { await bulk.setArchived(false, entries) }
                }
            }
            if let list, !itemIDs.isEmpty {
                Button(BulkActionText.remove(itemIDs.count), systemImage: "text.badge.xmark", role: .destructive) {
                    run(bulk) { await bulk.remove(itemIDs: itemIDs, from: list.name) }
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

    private func run(_ bulk: BulkActions, _ action: @escaping @MainActor () async -> Bool) {
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
        Binding {
            deleting != nil
        } set: {
            if !$0 { deleting = nil }
        }
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
