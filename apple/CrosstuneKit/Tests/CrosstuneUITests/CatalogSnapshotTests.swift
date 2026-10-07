import CrosstuneStore
import SwiftUI
import Testing

@testable import CrosstuneUI

/// The catalog laid out from stand-ins, since an image renderer draws no list: a search field
/// standing in for the system's, the real filter row, list header, tune rows, hidden match note,
/// and add row, stacked as the list shows them.
struct CatalogStandIn: View {
    var filters = CatalogFilters(
        status: "learning", facets: [.key: "A", .genre: "Old-time", .tuning("violin"): "Cross A (AEAE)"])
    var query = ""
    /// The Mac leaves status to its sidebar, so its filter row has no status control.
    var showsStatus = true

    @FocusState private var searchFocused: Bool

    /// The sample catalog's results under `filters` and `query`, as the model works them out.
    static func results(filters: CatalogFilters, query: String) -> CatalogResults {
        let entries = SampleCatalog.entries.map { CatalogEntry(tune: $0.tune, userTune: $0.userTune) }
        let visible = CatalogSearch.filter(entries, by: filters, query: query)
        let outcome = SearchOutcome(entries: entries, visible: visible, query: query, archivedShown: filters.archived)
        let values = CatalogSearch.facetValues(entries)
        let total = CatalogSearch.hidingArchived(entries, shown: filters.archived).count
        return CatalogResults(
            entries: entries, instruments: SampleCatalog.instruments, filters: filters, facetValues: values,
            facets: CatalogSearch.visibleFacets(values, instruments: SampleCatalog.instruments), visible: visible,
            outcome: outcome, total: total, archivedCount: entries.count(where: \.isArchived),
            missingChoices: CatalogSearch.missingChoices(entries))
    }

    var body: some View {
        let results = Self.results(filters: filters, query: query)
        let visible = results.visible
        let outcome = results.outcome
        VStack(alignment: .leading, spacing: 8) {
            FilterSearchField(
                prompt: CatalogScreen.searchPrompt,
                query: .constant(query), isFocused: $searchFocused,
                filterCount: nil, onSubmit: {}, onFilters: {})
            CatalogFilterRow(
                results: results, statusChoices: showsStatus ? StatusScope.choices(nil) : nil, errors: [],
                onChange: { _ in }, onFilters: {})
            ListHeader(count: results.countLabel, choice: .constant(CatalogSortChoice.default))
            ForEach(visible) { entry in
                TuneRow(
                    tune: entry.tune, userTune: entry.userTune, instruments: SampleCatalog.instruments, stacked: true)
                Divider()
            }
            if let hidden = outcome.hidden {
                HiddenMatchNote(match: hidden) { _ in }
            }
            if let offer = outcome.offerLabel {
                SearchOfferRow(label: offer) {}
            }
        }
    }
}

#if os(macOS)
    /// The Mac catalog column from stand-ins: the pane bar, the column title, the filter row,
    /// the list header, and the rows. `selected` nil is out of selection.
    struct MacCatalogColumnStandIn: View {
        var filters = CatalogFilters(
            facets: [
                .key: "A", .genre: "Old-time", .tuning("violin"): "Cross A (AEAE)", .composer: "Traditional",
            ])
        var selected: Set<String>?
        var width: CGFloat = 340
        var stacked = false

        @FocusState private var searchFocused: Bool

        private var search: some View {
            FilterSearchField(
                prompt: CatalogScreen.searchPrompt, query: .constant(""), isFocused: $searchFocused,
                filterCount: nil, onSubmit: {}, onFilters: {})
        }

        @ViewBuilder private var controls: some View {
            Group {
                if let selected {
                    Group {
                        Button(BulkActionText.status, systemImage: "tag") {}.labelStyle(.iconOnly)
                        Button(BulkActionText.edit, systemImage: TuneRowActions.editSystemImage) {}
                            .labelStyle(.iconOnly)
                        Button(BulkActionText.addToList, systemImage: "text.badge.plus") {}
                            .labelStyle(.iconOnly)
                        Button(BulkActionText.more, systemImage: "ellipsis") {}.labelStyle(.iconOnly)
                        Button(TuneSelection.done) {}.fontWeight(.semibold)
                    }
                    .disabled(selected.isEmpty)
                } else {
                    Button(CatalogScreen.addTune, systemImage: "plus") {}.labelStyle(.iconOnly)
                    Button(TuneRowActions.select, systemImage: "checkmark.circle") {}.labelStyle(.iconOnly)
                }
            }
            .paneControls()
            .fixedSize()
        }

        var body: some View {
            let results = CatalogStandIn.results(filters: filters, query: "")
            VStack(alignment: .leading, spacing: 0) {
                // The pane bar's two layouts: the search beside the controls, or above them once
                // the controls leave it too little room.
                Group {
                    if stacked {
                        VStack(spacing: 8) {
                            search
                            HStack(spacing: 8) {
                                Spacer(minLength: 0)
                                controls
                            }
                        }
                    } else {
                        HStack(spacing: 8) {
                            search
                            controls
                        }
                    }
                }
                .padding(.bottom, 8)
                ColumnTitle(Destination.catalog.title)
                    .padding(.top, 4)
                CatalogFilterRow(results: results, errors: [], onChange: { _ in }, onFilters: {})
                    .padding(.vertical, 6)
                ListHeader(
                    count: results.countLabel, choice: selected == nil ? .constant(CatalogSortChoice.default) : nil)
                ForEach(results.visible) { entry in
                    MacTuneRow(
                        text: TuneRowText(
                            tune: entry.tune, userTune: entry.userTune, instruments: SampleCatalog.instruments),
                        position: nil
                    )
                    .padding(.horizontal, 8)
                    .background {
                        if selected?.contains(entry.tune.id) == true {
                            RoundedRectangle(cornerRadius: 6).fill(MacStyle.accent.opacity(0.18))
                        }
                    }
                    .padding(.horizontal, -8)
                }
            }
            .frame(width: width, alignment: .topLeading)
        }
    }
#endif

@MainActor
@Suite struct CatalogSnapshotTests {
    @Test func filtered() {
        snapshot("catalog-filtered") { CatalogStandIn() }
    }

    /// The filter row with a key and two sheet filters set, at the default text size and at an
    /// accessibility size, where the controls wrap rather than clip.
    @Test func filterRow() {
        let filters = CatalogFilters(facets: [.key: "D", .genre: "Old-time"], unheard: true)
        let results = CatalogStandIn.results(filters: filters, query: "")
        for size in [DynamicTypeSize.large, .accessibility3] {
            snapshot("catalog-filter-row", size: size) {
                CatalogFilterRow(
                    results: results, statusChoices: StatusScope.choices(nil), errors: [], onChange: { _ in },
                    onFilters: {})
            }
        }
    }

    @Test func searchingForAHiddenTitle() {
        snapshot("catalog-search") {
            CatalogStandIn(filters: CatalogFilters(status: "known"), query: "cluck old hen")
        }
    }

    #if os(macOS)
        /// One-line rows in a narrow content column: the catalog's, then a list's with positions,
        /// then a long title that has to give way to its tuning and key.
        @Test func macRows() {
            snapshot("mac-rows", width: 332) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(SampleCatalog.entries, id: \.tune.id) { entry in
                        MacTuneRow(text: text(entry.tune, entry.userTune), position: nil)
                    }
                    Divider().padding(.vertical, 8)
                    ForEach(Array(SampleCatalog.entries.prefix(4).enumerated()), id: \.element.tune.id) {
                        index, entry in
                        MacTuneRow(text: text(entry.tune, entry.userTune), position: index + 1)
                    }
                    MacTuneRow(text: text(Self.reviewFocus.tune, Self.reviewFocus.userTune), position: 12)
                    Divider().padding(.vertical, 8)
                    MacTuneRow(text: text(Self.reviewFocus.tune, Self.reviewFocus.userTune), position: nil)
                }
                .frame(width: 300)
            }
        }

        /// A 60-character title with a tuning and a key, the row most likely to crowd.
        private static let reviewFocus: SampleCatalog.Entry = {
            let base = SampleCatalog.entries[1]
            var tune = base.tune
            tune.title = "An Old Man and the Old Woman Who Lived Down by the River Dee"
            return SampleCatalog.Entry(tune: tune, userTune: base.userTune)
        }()

        private func text(_ tune: Tune, _ userTune: UserTune) -> TuneRowText {
            TuneRowText(tune: tune, userTune: userTune, instruments: SampleCatalog.instruments)
        }

        /// The catalog column at rest and with sheet filters set, whose tokens wrap under the
        /// controls once they no longer fit beside them.
        @Test func macCatalogColumn() {
            snapshot("mac-catalog-column", width: 760) {
                HStack(alignment: .top, spacing: 24) {
                    MacCatalogColumnStandIn(filters: CatalogFilters())
                    MacCatalogColumnStandIn()
                }
            }
        }

        /// The key pull-down's popover, a key chosen, the catalog holding a keyless tune.
        @Test func macKeyPopover() {
            let results = CatalogStandIn.results(filters: CatalogFilters(facets: [.key: "D"]), query: "")
            snapshot("mac-key-popover", width: 320) {
                KeyFilterPopover(choices: results.choices(.key), selected: results.selected(.key)) { _ in }
            }
        }

        /// Selecting, the bulk actions in place of the catalog's own beside the search, which
        /// stays: in a wide column on one line, in the narrowest column above the actions.
        @Test func macCatalogSelecting() {
            let ids = Set(SampleCatalog.entries.dropFirst().prefix(2).map(\.tune.id))
            snapshot("mac-catalog-selecting", width: 820) {
                HStack(alignment: .top, spacing: 24) {
                    MacCatalogColumnStandIn(filters: CatalogFilters(), selected: ids, width: 440)
                    MacCatalogColumnStandIn(filters: CatalogFilters(), selected: ids, width: 268, stacked: true)
                }
            }
        }
    #endif

    @Test func preview() {
        let entry = SampleCatalog.entries[1]
        snapshot("catalog-preview", width: 352) {
            TunePreview(
                entry: CatalogEntry(tune: entry.tune, userTune: entry.userTune), instruments: SampleCatalog.instruments)
        }
    }
}
