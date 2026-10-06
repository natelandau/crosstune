import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// Every tune in the catalog: searched, filtered, and opened from here, and where a new tune
/// starts. Reads its ``CatalogModel`` from the environment.
public struct CatalogScreen: View {
    public static let searchPrompt = "Search tunes"
    public static let addTune = "Add tune"
    public static let noTunesTitle = "No tunes yet"
    public static let noTunesHint = "Add the first tune you know."
    nonisolated public static let nothingMatches = "Nothing matches"

    /// The empty state's title when no tune carries the typed title.
    nonisolated public static func noTuneCalled(_ title: String) -> String {
        "No tune called \"\(title)\""
    }

    @Environment(CatalogModel.self) private var model: CatalogModel?

    public init() {}

    public var body: some View {
        if let model {
            CatalogContent(model: model)
        } else {
            // Loading is silence.
            Color.clear
                .navigationTitle(Destination.catalog.title)
        }
    }
}

private struct CatalogContent: View {
    @Bindable var model: CatalogModel

    @Environment(\.detailTune) private var detailTune
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.openSheets) private var openSheets
    @Environment(\.spacing) private var spacing
    @Environment(ScanTunes.self) private var scanTunes: ScanTunes?
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @AppStorage(CatalogSortChoice.storageKey) private var sort = CatalogSortChoice.default
    @State private var pushed: String?
    @State private var form: TuneFormTarget?
    @State private var showsFilters = false
    @State private var isShown = false
    @State private var selection = TuneSelection()
    @AccessibilityFocusState private var focusedRow: String?
    @FocusState private var searchFocused: Bool
    @Namespace private var zoom
    #if os(iOS)
        @Environment(\.store) private var store
        @State private var counts: LiveQuery<CatalogCounts?>?
    #endif

    var body: some View {
        let results = model.results
        list(results)
            .keepsScrollAnchor(rows: results?.visible.map(\.id) ?? [])
            #if os(macOS)
                .macColumnList()
            #else
                .listStyle(.plain)
            #endif
            #if os(macOS)
                // The search and the catalog's own actions share one pane bar. A selection's
                // actions take the actions' place while it lasts; the search stays.
                .paneBar {
                    searchField
                } _: {
                    if !selection.isActive {
                        addButton.labelStyle(.iconOnly).help(CatalogScreen.addTune)
                        if results?.visible.isEmpty == false {
                            selectButton.labelStyle(.iconOnly).help(TuneRowActions.select)
                        }
                    }
                }
                .columnTitled(title, alwaysShown: selection.isActive)
            #else
                .searchable(
                    text: $model.query, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: CatalogScreen.searchPrompt
                )
                .searchFocused($searchFocused)
                .onSubmit(of: .search, submitSearch)
                .textInputAutocapitalization(.never)
                .navigationTitle(title)
                // The title menu shows only on an inline title; the large styles draw no chevron.
                .toolbarTitleDisplayMode(.inline)
                .task(id: store?.userID) {
                    counts = store.map { store in
                        LiveQuery(store, initial: nil) { try CatalogCounts.fetch($0) }
                    }
                }
                .toolbar {
                    // Left out while selecting, since an empty title menu still draws its chevron.
                    if !selection.isActive {
                        ToolbarTitleMenu { StatusTitleMenu(model: model, counts: counts?.value ?? nil) }
                        ToolbarItem(placement: .primaryAction) { addButton }
                        if results?.visible.isEmpty == false {
                            ToolbarItem(placement: .primaryAction) { moreMenu }
                        }
                    }
                }
            #endif
            .selectionMode(
                $selection, rows: results?.visible ?? [], instruments: results?.instruments ?? [],
                focusedRow: $focusedRow
            )
            .modifier(RefreshesBySync(engine: engine))
            .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: zoom))
            .sheet(isPresented: $showsFilters) {
                CatalogFilterSheet(model: model)
            }
            .sheet(item: $form) { target in
                TuneFormSheet(target: target) { tuneID in
                    if case .new = target { open(tuneID) }
                }
            }
            .onAppear { isShown = true }
            .onDisappear { isShown = false }
            // Another window's choice reaches this one through the shared defaults.
            .onChange(of: sort, initial: true) { model.sort = sort }
            // History reaches the device only on request, and only Last played needs it.
            .task(id: sort.sort == .played) {
                if sort.sort == .played { await engine?.pullEvents() }
            }
            // The menu's New tune opens the tune it makes, as Add tune does.
            .newTuneContext(onSaved: open)
            // A tab the musician is not looking at stays alive, so it must not answer the menu.
            .focusedSceneValue(
                \.catalogSort,
                MenuGates.sort(
                    isShown: isShown, sheetsOpen: openSheets?.isCovered == true, selecting: selection.isActive)
                    ? $sort : nil
            )
            .focusedSceneValue(
                \.findAction,
                MenuGates.find(isShown: isShown, sheetsOpen: openSheets?.isCovered == true)
                    ? MenuAction { searchFocused = true } : nil
            )
            // The count is read out when the filters or the stored tunes change its wording, never
            // on each keystroke of a search, which it would talk over, and never on first load.
            .onChange(of: results?.filters, initial: true) { announceCount() }
            .onChange(of: model.catalogRevision) { announceCount() }
    }

    private var title: String {
        if selection.isActive { return TuneSelection.title(selection.ids.count) }
        #if os(iOS)
            return StatusScope.title(model.status)
        #else
            return Destination.catalog.title
        #endif
    }

    #if os(macOS)
        private var searchField: some View {
            FilterSearchField(
                prompt: CatalogScreen.searchPrompt,
                query: $model.query, isFocused: $searchFocused,
                filterCount: nil,
                onSubmit: submitSearch
            ) { showsFilters = true }
        }
    #endif

    private var addButton: some View {
        Button(CatalogScreen.addTune, systemImage: "plus") { form = model.newTune() }
    }

    private var selectButton: some View {
        Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter() }
    }

    #if os(iOS)
        /// The screen's More menu, an explicit menu like every other screen's, so its items keep
        /// their order and roles.
        private var moreMenu: some View {
            Menu {
                selectButton
            } label: {
                Label(TuneScreen.moreActions, systemImage: "ellipsis")
                    .labelStyle(.iconOnly)
            }
        }
    #endif

    private func announceCount() {
        // Asked even while hidden, so a tab coming back reads out only what changes after.
        guard let label = model.countToAnnounce(), isShown else { return }
        AccessibilityNotification.Announcement(label).post()
    }

    private func list(_ results: CatalogResults?) -> some View {
        List(
            selection: TuneSelection.listBinding(
                $selection, visible: results?.visible.map(\.tune.id) ?? [], detailTune: detailTune)
        ) {
            #if os(macOS)
                ColumnTitle(Destination.catalog.title)
                    .listRowInsets(MacStyle.columnRowInsets(top: MacStyle.columnTitleTop))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
            #endif
            if let results {
                CatalogFilterRow(results: results, model: model, isSelecting: selection.isActive) {
                    showsFilters = true
                }
                #if os(macOS)
                    .listRowInsets(MacStyle.columnRowInsets(top: 6, bottom: 6))
                #else
                    .listRowInsets(
                        EdgeInsets(top: spacing.stackGap, leading: 16, bottom: spacing.stackGap, trailing: 16))
                #endif
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .selectionDisabled()
            }
            if let results, results.visible.isEmpty {
                emptyState(results)
                    .frame(maxWidth: .infinity)
                    .padding(.top, spacing(48))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
            }
            if let results, !results.visible.isEmpty {
                ListHeader(count: results.countLabel, choice: selection.isActive ? nil : $sort)
                    #if os(macOS)
                        .listRowInsets(MacStyle.columnRowInsets())
                    #else
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    #endif
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
                ForEach(results.visible) { entry in
                    row(entry, instruments: results.instruments)
                }
                if let hidden = results.outcome.hidden {
                    HiddenMatchNote(match: hidden, onOpen: open)
                        .listRowSeparator(.hidden)
                        .selectionDisabled()
                }
                if let offer = results.outcome.offerLabel, let title = results.outcome.title {
                    SearchOfferRow(label: offer) { createFromSearch(title) }
                        .selectionDisabled()
                }
            }
        }
    }

    @ViewBuilder private func row(_ entry: CatalogEntry, instruments: Set<String>) -> some View {
        let tuneRow = TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        Group {
            if detailTune != nil || selection.isActive {
                // The list's selection drives the detail column, or is the selection.
                tuneRow
            } else {
                Button {
                    open(entry.tune.id)
                } label: {
                    tuneRow
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .matchedTransitionSource(id: entry.tune.id, in: zoom)
            }
        }
        // Inside the row insets, which a wrapper around them would hide from the list.
        .scrollAnchorRow(entry.id)
        .tuneRowInsets()
        .catalogRowActions(
            entry, instruments: instruments, isSelecting: selection.isActive,
            onEdit: { form = .edit(tuneID: entry.tune.id, userTuneID: entry.userTune.id) },
            onArchive: { Task { await model.setArchived(entry, archived: !entry.isArchived) } },
            onScans: TuneRowActions.scansAction(
                tuneID: entry.tune.id, tunesWithScans: scanTunes, origin: .row, actions: tuneScreenActions),
            onSelect: { selection.enter(with: entry.tune.id) }
        )
        .accessibilityFocused($focusedRow, equals: entry.tune.id)
        .tag(entry.tune.id)
    }

    private func emptyState(_ results: CatalogResults) -> some View {
        let noTunes = results.entries.isEmpty && model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var title = noTunes ? CatalogScreen.noTunesTitle : CatalogScreen.nothingMatches
        if case .create(let typed, false, _) = results.outcome { title = CatalogScreen.noTuneCalled(typed) }
        return ContentUnavailableView {
            Label(title, systemImage: Destination.catalog.systemImage)
        } description: {
            if noTunes {
                Text(CatalogScreen.noTunesHint)
            } else if !results.entries.isEmpty {
                Text(results.countLabel).monospacedDigit()
            }
        } actions: {
            if let hidden = results.outcome.hidden {
                HiddenMatchNote(match: hidden, onOpen: open)
            }
            if let offer = results.outcome.offerLabel, let typed = results.outcome.title {
                Button(offer) { createFromSearch(typed) }
                    .buttonStyle(.slateProminent)
            } else if noTunes {
                Button(CatalogScreen.addTune) { form = model.newTune() }
                    .buttonStyle(.slateProminent)
            }
        }
    }

    private func open(_ tuneID: String) {
        if let detailTune {
            detailTune.wrappedValue = tuneID
        } else {
            pushed = tuneID
        }
    }

    private func createFromSearch(_ title: String) {
        form = model.newTune(title: title)
    }

    private func submitSearch() {
        guard let results = model.results else { return }
        switch SearchSubmit(query: model.query, visible: results.visible, outcome: results.outcome) {
        case .open(let tuneID): open(tuneID)
        case .create(let title): createFromSearch(title)
        case .dismiss: searchFocused = false
        }
    }
}

/// Pull to refresh runs a sync, on touch only: a Mac has the Sync now command.
struct RefreshesBySync: ViewModifier {
    let engine: SyncEngine?

    func body(content: Content) -> some View {
        #if os(iOS)
            if let engine {
                content.refreshable { await engine.sync() }
            } else {
                content
            }
        #else
            content
        #endif
    }
}

/// Pushes the opened tune onto the screen's stack, zooming out of its row, where there is no
/// detail column to show it in.
struct PushesTune: ViewModifier {
    @Binding var tuneID: String?
    let isPushing: Bool
    /// Where the tune's row marks its zoom source, or nil for the standard push when the tune
    /// opens from somewhere with no single source to zoom out of.
    let zoom: Namespace.ID?

    @Environment(\.stackTune) private var stackTune

    func body(content: Content) -> some View {
        if isPushing {
            content.navigationDestination(item: keptTuneID) { tuneID in
                TuneScreen(tuneID: tuneID)
                    // A list opened from the tune pushes its own tunes, which the shell does not keep.
                    .environment(\.stackTune, nil)
                    #if os(iOS)
                        .modifier(ZoomsFromSource(sourceID: tuneID, zoom: zoom))
                    #endif
            }
            .onChange(of: tuneID) {
                if let stackTune, stackTune.wrappedValue != tuneID { stackTune.wrappedValue = tuneID }
            }
            .onChange(of: stackTune?.wrappedValue) { _, kept in
                if stackTune != nil, kept != tuneID { tuneID = kept }
            }
            // After the screen is on show: a push made while the screen itself is being pushed is
            // dropped.
            .task {
                if let kept = stackTune?.wrappedValue, kept != tuneID { tuneID = kept }
            }
        } else {
            content
        }
    }

    #if os(iOS)
        private struct ZoomsFromSource: ViewModifier {
            let sourceID: String
            let zoom: Namespace.ID?

            func body(content: Content) -> some View {
                if let zoom {
                    content.navigationTransition(.zoom(sourceID: sourceID, in: zoom))
                } else {
                    content
                }
            }
        }
    #endif

    /// The pushed tune, which the stack's own pop also clears from the shell at once: the
    /// screen's `task` runs as the pop reveals it, before `onChange` would, and would push the
    /// popped tune back.
    private var keptTuneID: Binding<String?> {
        Binding {
            tuneID
        } set: { new in
            tuneID = new
            if let stackTune, stackTune.wrappedValue != new { stackTune.wrappedValue = new }
        }
    }
}
