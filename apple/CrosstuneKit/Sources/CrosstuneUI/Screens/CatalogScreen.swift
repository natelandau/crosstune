import CrosstuneSync
import SwiftUI

/// Every tune in the catalog: searched, filtered, and opened from here, and where a new tune
/// starts. Reads its ``CatalogModel`` from the environment.
public struct CatalogScreen: View {
    public static let searchPrompt = "Search tunes"
    public static let addTune = "Add tune"
    public static let noTunesTitle = "No tunes yet"
    public static let noTunesHint = "Add the first tune you know."
    public static let nothingMatches = "Nothing matches"

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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var pushed: String?
    @State private var form: TuneFormTarget?
    @State private var showsFilters = false
    @State private var isShown = false
    @State private var selection = TuneSelection()
    @AccessibilityFocusState private var focusedRow: String?
    @FocusState private var searchFocused: Bool
    @Namespace private var zoom

    var body: some View {
        let results = model.results
        list(results)
            .listStyle(.plain)
            .modifier(SystemSearch(query: $model.query, isFocused: $searchFocused, onSubmit: submitSearch))
            .toolbar {
                if !selection.isActive {
                    ToolbarItem(placement: .primaryAction) {
                        Button(CatalogScreen.addTune, systemImage: "plus") { form = model.newTune() }
                    }
                    if let results {
                        ToolbarItem(placement: .primaryAction) { filtersButton(results) }
                    }
                    if results?.visible.isEmpty == false {
                        ToolbarItem(placement: .secondaryAction) {
                            Button(TuneRowActions.select) { selection.enter() }
                        }
                    }
                }
            }
            .navigationTitle(
                selection.isActive ? TuneSelection.title(selection.ids.count) : Destination.catalog.title
            )
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
            // The menu's New tune opens the tune it makes, as Add tune does.
            .newTuneContext(onSaved: open)
            // A tab the musician is not looking at stays alive, so it must not answer the menu.
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

    private func announceCount() {
        // Asked even while hidden, so a tab coming back reads out only what changes after.
        guard let label = model.countToAnnounce(), isShown else { return }
        AccessibilityNotification.Announcement(label).post()
    }

    private func filtersButton(_ results: CatalogResults) -> some View {
        CatalogFiltersButton(
            setCount: results.filters.sheetCount(railsOnScreen: CatalogFilterBar.railsOnScreen(dynamicTypeSize))
        ) { showsFilters = true }
    }

    private func list(_ results: CatalogResults?) -> some View {
        List(
            selection: TuneSelection.listBinding(
                $selection, visible: results?.visible.map(\.tune.id) ?? [], detailTune: detailTune)
        ) {
            if let results {
                // The first row of the list rather than a bar pinned under the navigation bar,
                // which would take the rails' own scroll views for the screen's content.
                CatalogFilterBar(
                    results: results, errors: [model.filterError, model.actionError].compactMap { $0 },
                    onChange: model.updateFilters
                )
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden, edges: .top)
                .listRowBackground(Color.clear)
                .selectionDisabled()
            }
            if let results, results.visible.isEmpty {
                emptyState(results)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
            }
            if let results, !results.visible.isEmpty {
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
                Text(results.countLabel)
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
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
        .catalogRowActions(
            entry, instruments: instruments, isSelecting: selection.isActive,
            onEdit: { form = .edit(tuneID: entry.tune.id, userTuneID: entry.userTune.id) },
            onArchive: { Task { await model.setArchived(entry, archived: !entry.isArchived) } },
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
                    .buttonStyle(.borderedProminent)
            } else if noTunes {
                Button(CatalogScreen.addTune) { form = model.newTune() }
                    .buttonStyle(.borderedProminent)
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

/// The system search field: always shown in the navigation bar drawer on iPhone and iPad, so it
/// is there at rest, and in the toolbar on the Mac, where it answers the system Find.
private struct SystemSearch: ViewModifier {
    @Binding var query: String
    let isFocused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    func body(content: Content) -> some View {
        content
            .searchable(text: $query, placement: Self.placement, prompt: CatalogScreen.searchPrompt)
            .searchFocused(isFocused)
            .onSubmit(of: .search, onSubmit)
    }

    private static var placement: SearchFieldPlacement {
        #if os(iOS)
            .navigationBarDrawer(displayMode: .always)
        #else
            .toolbar
        #endif
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
    let zoom: Namespace.ID

    @Environment(\.stackTune) private var stackTune

    func body(content: Content) -> some View {
        if isPushing {
            content.navigationDestination(item: $tuneID) { tuneID in
                TuneScreen(tuneID: tuneID)
                    // A list opened from the tune pushes its own tunes, which the shell does not keep.
                    .environment(\.stackTune, nil)
                    #if os(iOS)
                        .navigationTransition(.zoom(sourceID: tuneID, in: zoom))
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
}
