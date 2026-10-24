import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// Every tune in the catalog: searched, filtered, and opened from here, and where a new tune
/// starts. Reads its ``CatalogModel`` from the environment.
public struct CatalogScreen: View {
    public static let searchPrompt = "Search tunes"
    public static let addTune = "Add tune"
    public static let noTunesTitle = "No tunes yet"
    public static let noTunesHint = "Add the first tune you know, or import a list you already keep."
    nonisolated public static let nothingMatches = "Nothing matches"

    /// The empty state's title when no tune carries the typed title.
    nonisolated public static func noTuneCalled(_ title: String) -> String {
        "No tune called \"\(title)\""
    }

    /// The Mac's import action, which opens a sheet, so it ends in an ellipsis.
    nonisolated static let importTunesMac = "\(ImportCopy.title)…"

    /// True for a catalog holding no tune at all, with no search typed: the first-run state that
    /// shows its onboarding rather than a filter row and a list.
    nonisolated static func isEmptyCatalog(_ results: CatalogResults?, query: String) -> Bool {
        guard let results else { return false }
        return results.entries.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    #if os(macOS)
        /// Whether the search field's filters button stands down: while selecting, as the column's
        /// own actions do, and in a catalog with no tune to filter. Up while the catalog loads.
        nonisolated static func filtersStandDown(_ results: CatalogResults?, isSelecting: Bool) -> Bool {
            isSelecting || results?.entries.isEmpty == true
        }
    #endif

    /// Whether the phone bar carries Filters: never while selecting, whose controls take the
    /// row, and in an empty catalog only while a stored filter is set, so it can still be cleared.
    nonisolated static func showsBarFilters(entries: [CatalogEntry], filters: CatalogFilters, isSelecting: Bool)
        -> Bool
    {
        !isSelecting && (!entries.isEmpty || filters.setCount > 0)
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

#if os(macOS)
    extension CatalogScreen {
        /// What fills the block under the catalog's title on the Mac.
        enum MacHeadBlock: Equatable {
            case selectionBar
            case filterRow
            /// Nothing to show, with the block's height kept.
            case reserved
        }

        /// The block under the title: the selection bar while selecting, else the filter row,
        /// else empty room of the same height, so entering selection never moves the rows. An
        /// empty catalog has no rows to keep still and shows nothing there.
        nonisolated static func macHeadBlock(isSelecting: Bool, showsFilterRow: Bool, hasTunes: Bool) -> MacHeadBlock? {
            if isSelecting { return .selectionBar }
            if showsFilterRow { return .filterRow }
            return hasTunes ? .reserved : nil
        }

        /// The selection bar's height: the filter row's, as last laid out, where one shows, so a
        /// row wrapped to two lines gives the bar its room and entering selection never moves
        /// the rows.
        nonisolated static func macSelectionBarHeight(showsFilterRow: Bool, filterRowHeight: CGFloat?) -> CGFloat {
            guard showsFilterRow, let filterRowHeight else { return MacStyle.columnBarHeight }
            return max(MacStyle.columnBarHeight, filterRowHeight)
        }
    }
#endif

private struct CatalogContent: View {
    @Bindable var model: CatalogModel

    @Environment(\.detailTune) private var detailTune
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.openSheets) private var openSheets
    @Environment(\.spacing) private var spacing
    @Environment(ScanTunes.self) private var scanTunes: ScanTunes?
    @Environment(\.premium) private var premium
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @Environment(AddedTuneOffer.self) private var addedTune: AddedTuneOffer?
    @AppStorage(CatalogSortChoice.storageKey) private var sort = CatalogSortChoice.default
    @State private var pushed: String?
    @State private var showsFilters = false
    @State private var showsImport = false
    @State private var isShown = false
    @State private var selection = TuneSelection()
    #if os(macOS)
        /// This screen's own Select tunes, never taken for another window's.
        @State private var selectActionID = UUID()
        /// The filter row's height as last laid out, which the selection bar keeps in its place.
        @State private var filterRowHeight: CGFloat?
    #endif
    @AccessibilityFocusState private var focusedRow: String?
    @FocusState private var searchFocused: Bool
    @Namespace private var zoom
    @Environment(\.catalogCounts) private var counts

    /// The sort as the musician changes it, which is what reports.
    private var chosenSort: Binding<CatalogSortChoice> {
        Binding {
            sort
        } set: { choice in
            guard choice != sort else { return }
            sort = choice
            model.reportSort(choice)
        }
    }

    var body: some View {
        let results = model.results
        list(results)
            .screenView(.catalog)
            .keepsScrollAnchor(rows: results?.visible.map(\.id) ?? [])
            #if os(macOS)
                .macColumnList()
            #else
                .listStyle(.plain)
                .paperGround()
                .listSelectionTint()
            #endif
            #if os(macOS)
                // The search and the catalog's own actions share one pane bar, which stays as it
                // is while selecting so nothing in it moves; the selection's actions are in the
                // list's selection bar.
                .paneBar(slot: CatalogScreen.paneSlot) {
                    searchField
                } _: {
                    Group {
                        addButton.labelStyle(.iconOnly).help(CatalogScreen.addTune)
                        moreMenu.help(TuneScreen.moreActions)
                    }
                    .disabled(selection.isActive)
                }
                .columnTitled(macTitle)
                .overlay {
                    if CatalogScreen.isEmptyCatalog(results, query: model.query) {
                        MacEmptyCatalog(onAdd: newTune, onImport: { showsImport = true })
                    }
                }
            #else
                .searchable(
                    text: $model.query, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: CatalogScreen.searchPrompt
                )
                .searchFocused($searchFocused)
                .onSubmit(of: .search, submitSearch)
                .textInputAutocapitalization(.never)
                .navigationTitle(title)
                .toolbar {
                    if !selection.isActive {
                        ToolbarItem(placement: .primaryAction) { addButton }
                    }
                    if let results,
                        CatalogScreen.showsBarFilters(
                            entries: results.entries, filters: results.filters, isSelecting: selection.isActive)
                    {
                        ToolbarItem(placement: .primaryAction) {
                            FiltersButton(setCount: results.filters.setCount, iconOnly: true) { showsFilters = true }
                        }
                    }
                    if !selection.isActive, results?.visible.isEmpty == false {
                        ToolbarItem(placement: .primaryAction) { moreMenu }
                    }
                    AccountToolbarItem()
                }
            #endif
            .selectionMode(
                $selection, rows: results?.visible ?? [], instruments: results?.instruments ?? [],
                focusedRow: $focusedRow
            )
            .modifier(RefreshesBySync(engine: engine))
            .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: zoom))
            .sheet(isPresented: $showsFilters) {
                CatalogFilterSheet(model: model, statusChoices: StatusScope.choices(counts?.value ?? nil))
            }
            #if DEBUG
                .opensForSample(.catalogFilters) { showsFilters = true }
                .opensForSample(.catalogSetFilters) {
                    model.updateFilters {
                        $0[.key] = "D"
                        $0[.genre] = "Old-time"
                        $0.archived = true
                    }
                }
            #endif
            .sheet(isPresented: $showsImport) {
                ImportSheet(entry: .emptyCatalog)
            }
            .onAppear { isShown = true }
            .onDisappear { isShown = false }
            // Opening a tune, by a row, Return, or the list's selection, ends the search behind it.
            .onChange(of: pushed ?? detailTune?.value) { _, opened in
                if opened != nil { model.searchResultOpened() }
            }
            // Another window's choice reaches this one through the shared defaults.
            .onChange(of: sort, initial: true) { model.sort = sort }
            // History reaches the device only on request, and only Last played needs it.
            .task(id: sort.sort == .played) {
                if sort.sort == .played { await engine?.pullEvents() }
            }
            // A tab the musician is not looking at stays alive, so it must not answer the menu.
            .focusedSceneValue(
                \.catalogSort,
                MenuGates.sort(
                    isShown: isShown, sheetsOpen: openSheets?.isCovered == true, selecting: selection.isActive)
                    ? chosenSort : nil
            )
            #if os(macOS)
                .focusedSceneValue(
                    \.selectTunesAction,
                    MenuGates.select(
                        isShown: isShown, sheetsOpen: openSheets?.isCovered == true, selecting: selection.isActive,
                        hasRows: results?.visible.isEmpty == false)
                        ? MenuAction(id: selectActionID) { selection.enter() } : nil
                )
            #endif
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

    /// Whether the empty catalog's onboarding stands in for the list's own empty state, as it
    /// does on the Mac.
    private static func onboards(_ results: CatalogResults, query: String) -> Bool {
        #if os(macOS)
            CatalogScreen.isEmptyCatalog(results, query: query)
        #else
            false
        #endif
    }

    /// Whether the selection bar stands in for the filter row, as it does on the Mac.
    private static func selectionBarShows(_ selection: TuneSelection) -> Bool {
        #if os(macOS)
            selection.isActive
        #else
            false
        #endif
    }

    private func showsFilterRow(_ results: CatalogResults) -> Bool {
        let hasErrors = model.filterError != nil || model.actionError != nil
        #if os(macOS)
            return CatalogFilterRow.isShownOnMac(results, hasErrors: hasErrors)
        #else
            return CatalogFilterRow.isShownOnPhoneAndPad(results, hasErrors: hasErrors)
        #endif
    }

    #if os(iOS)
        private var title: String {
            selection.isActive ? TuneSelection.title(selection.ids.count) : Destination.catalog.title
        }
    #else
        /// The column title, which counts the selection in its place.
        private var macTitle: String {
            selection.isActive ? TuneSelection.selectedTitle(selection.ids.count) : Destination.catalog.title
        }
    #endif

    /// The filter row's status choices. The Mac's sidebar sets status, so its row has none.
    private var statusChoices: [StatusScope.Choice]? {
        #if os(iOS)
            StatusScope.choices(counts?.value ?? nil)
        #else
            nil
        #endif
    }

    #if os(macOS)
        private var searchField: some View {
            FilterSearchField(
                prompt: CatalogScreen.searchPrompt,
                query: $model.query, isFocused: $searchFocused,
                filterCount: CatalogFilterRow.searchFilterCount(
                    model.results?.filters ?? CatalogFilters(), filtersInSearch: CatalogFilterRow.filtersInSearch),
                filtersDisabled: CatalogScreen.filtersStandDown(model.results, isSelecting: selection.isActive),
                onSubmit: submitSearch
            ) { showsFilters = true }
        }
    #endif

    private var addButton: some View {
        Button(CatalogScreen.addTune, systemImage: "plus", action: newTune)
    }

    private var selectButton: some View {
        Button(TuneRowActions.select, systemImage: "checkmark.circle") { selection.enter() }
    }

    /// The screen's More menu, an explicit menu like every other screen's, so its items keep
    /// their order and roles.
    private var moreMenu: some View {
        Menu {
            selectButton
                .disabled(model.results?.visible.isEmpty != false)
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                .labelStyle(.iconOnly)
        }
    }

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
                ColumnTitle(macTitle)
                    .columnTitleBaseline(.insetList)
                    .listRowInsets(MacStyle.columnRowInsets())
                    .plainListRow()
                switch CatalogScreen.macHeadBlock(
                    isSelecting: selection.isActive, showsFilterRow: results.map(showsFilterRow) ?? false,
                    hasTunes: results?.entries.isEmpty == false)
                {
                case .selectionBar:
                    SelectionBarSlot()
                        .frame(
                            minHeight: CatalogScreen.macSelectionBarHeight(
                                showsFilterRow: results.map(showsFilterRow) ?? false, filterRowHeight: filterRowHeight),
                            alignment: .top
                        )
                        .listRowInsets(MacStyle.columnBarInsets)
                        .plainListRow()
                case .reserved:
                    Color.clear
                        .frame(height: MacStyle.columnBarHeight)
                        .listRowInsets(MacStyle.columnBarInsets)
                        .plainListRow()
                        .accessibilityHidden(true)
                case .filterRow, nil:
                    EmptyView()
                }
            #endif
            if let results, showsFilterRow(results), !Self.selectionBarShows(selection) {
                CatalogFilterRow(results: results, model: model, statusChoices: statusChoices)
                    #if os(macOS)
                        .frame(minHeight: MacStyle.columnBarHeight)
                        .onGeometryChange(for: CGFloat.self, of: \.size.height) { filterRowHeight = $0 }
                        .listRowInsets(MacStyle.columnBarInsets)
                    #else
                        .listRowInsets(
                            EdgeInsets(top: spacing.stackGap, leading: 16, bottom: spacing.stackGap, trailing: 16))
                    #endif
                    .plainListRow()
            }
            if let results, results.visible.isEmpty, !Self.onboards(results, query: model.query) {
                emptyState(results)
                    .frame(maxWidth: .infinity)
                    .padding(.top, spacing(48))
                    .plainListRow()
            }
            if let results, !results.visible.isEmpty {
                ListHeader(count: results.countLabel, choice: selection.isActive ? nil : chosenSort)
                    #if os(macOS)
                        .listRowInsets(MacStyle.columnRowInsets())
                    #else
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    #endif
                    .plainListRow()
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
                    #if os(macOS)
                        .selectionCheckbox(
                            selection.isActive, title: entry.tune.title,
                            isOn: TuneSelection.checkbox($selection, row: entry.tune.id) {
                                model.results?.visible.map(\.tune.id) ?? []
                            })
                    #endif
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
            onEdit: { open(entry.tune.id) },
            onArchive: { Task { await model.setArchived(entry, archived: !entry.isArchived) } },
            onScans: TuneRowActions.scansAction(
                tuneID: entry.tune.id, tunesWithScans: scanTunes, premium: premium, origin: .row,
                actions: tuneScreenActions),
            onSelect: { selection.enter(with: entry.tune.id) }
        )
        .unselectedRowGround(
            isSelected: TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune)
        )
        .statusRingOnFill(TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune))
        .accessibilityFocused($focusedRow, equals: entry.tune.id)
        #if os(macOS)
            .macRowSelected(TuneSelection.rowIsSelected(entry.tune.id, selection: selection, detailTune: detailTune))
        #endif
        .tag(entry.tune.id)
    }

    private func emptyState(_ results: CatalogResults) -> some View {
        let noTunes = results.entries.isEmpty && model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var title = noTunes ? CatalogScreen.noTunesTitle : CatalogScreen.nothingMatches
        if case .create(let typed, false, _) = results.outcome { title = CatalogScreen.noTuneCalled(typed) }
        return ContentUnavailableView {
            Label(title, systemImage: Destination.catalog.systemImage)
                .contentMask()
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
                    .contentMask()
                    .buttonStyle(.accentProminent)
            } else if noTunes {
                Button(CatalogScreen.addTune, action: newTune)
                    .buttonStyle(.accentProminent)
                Button(ImportCopy.title) { showsImport = true }
            }
        }
    }

    private func open(_ tuneID: String) {
        if let detailTune {
            detailTune.value = tuneID
        } else {
            pushed = tuneID
        }
    }

    /// Opens the new-tune draft where this screen opens tunes.
    private func newTune() {
        model.newTune()
        open(NewTuneDraft.id(source: .catalog))
    }

    /// Creates the tune by the typed title and opens its page, with Undo in the Added banner.
    private func createFromSearch(_ title: String) {
        guard let addedTune else { return }
        model.searchOfferTaken()
        Task {
            if let tuneID = await addedTune.addAfterAnyRunning(title: title, source: .searchOffer) { open(tuneID) }
        }
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
                    .environment(\.pushedTune, keptTuneID)
                    #if os(iOS)
                        .modifier(ZoomsFromSource(sourceID: tuneID, zoom: zoom))
                    #endif
            }
            .onChange(of: tuneID) {
                if let stackTune, stackTune.value != tuneID { stackTune.value = tuneID }
            }
            .onChange(of: stackTune?.value) { _, kept in
                if stackTune != nil, kept != tuneID { tuneID = kept }
            }
            // After the screen is on show: a push made while the screen itself is being pushed is
            // dropped.
            .task {
                if let kept = stackTune?.value, kept != tuneID { tuneID = kept }
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
            if let stackTune, stackTune.value != new { stackTune.value = new }
        }
    }
}

#if os(macOS)
    extension CatalogScreen {
        /// The pane bar's trailing slot: Add tune and the More menu. Its width never changes, so
        /// the search field beside it keeps one width.
        static let paneSlot = PaneBarLayout.slotWidth(icons: 2)
    }

    /// The first run's one empty state: what the catalog is for, and the two ways to fill it.
    private struct MacEmptyCatalog: View {
        let onAdd: () -> Void
        let onImport: () -> Void

        var body: some View {
            VStack(spacing: 0) {
                Image(systemName: Destination.catalog.systemImage)
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(Palette.inkSecondary)
                    .padding(.bottom, 12)
                    .accessibilityHidden(true)
                Text(CatalogScreen.noTunesTitle)
                    .font(MacStyle.sectionHeading)
                    .foregroundStyle(Palette.ink)
                    .padding(.bottom, 4)
                Text(CatalogScreen.noTunesHint)
                    .font(MacStyle.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .frame(maxWidth: 260)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 16)
                HStack(spacing: 8) {
                    Button(CatalogScreen.addTune, action: onAdd)
                        .buttonStyle(.macPrimary)
                    Button(CatalogScreen.importTunesMac, action: onImport)
                        .buttonStyle(.macPlain)
                }
            }
            .multilineTextAlignment(.center)
            .padding(24)
        }
    }
#endif
