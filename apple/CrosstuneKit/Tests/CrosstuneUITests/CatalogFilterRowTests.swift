import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct CatalogFilterRowTests {
    @Test func statusLabelNamesTheChosenStatusOrAny() {
        #expect(CatalogFilterRow.statusLabel(nil) == "Status: Any")
        #expect(CatalogFilterRow.statusLabel("want_to_learn") == "Status: Unknown")
    }

    @Test func keyLabelNamesTheChosenKeyOrAny() {
        #expect(CatalogFilterRow.keyLabel(nil) == "Key: Any")
        #expect(CatalogFilterRow.keyLabel("D") == "Key: D")
    }

    @Test func keyLabelSpellsOutNoKey() {
        #expect(CatalogFilterRow.keyLabel(CatalogFilters.noKey) == "Key: \(KeyChooser.unknownKey)")
    }

    @Test func pickingTheChosenKeyAgainClearsIt() {
        #expect(KeyFilterPopover.choice(picking: "D", selected: nil) == "D")
        #expect(KeyFilterPopover.choice(picking: "G", selected: "D") == "G")
        #expect(KeyFilterPopover.choice(picking: "D", selected: "D") == nil)
    }

    @Test func rowOmitsAControlForAFacetTheCatalogLacks() {
        #expect(CatalogFilterRow.controls(full, showsStatus: false) == [.key])
        let keyless = results(full, facets: full.facets.filter { $0 != .key })
        #expect(CatalogFilterRow.controls(keyless, showsStatus: false).isEmpty)
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: false).isEmpty)
    }

    @Test func statusLeadsTheRowWhereItShows() {
        #expect(CatalogFilterRow.controls(full, showsStatus: true) == [.status, .key])
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: true) == [.status])
    }

    /// The bar carries Filters on iPhone and iPad, so the row's controls never include it and the
    /// search field holds no count.
    @Test func filtersStayOutOfTheRowOnIOS() {
        #if os(iOS)
            #expect(!CatalogFilterRow.filtersInSearch)
        #endif
    }

    @Test func barFiltersShowOnlyWithSomethingToFilterOrSet() {
        let empty = emptied(full)
        let set = withFilters(empty, CatalogFilters(status: "learning"))
        #expect(CatalogScreen.showsBarFilters(entries: set.entries, filters: set.filters, isSelecting: false))
        #expect(!CatalogScreen.showsBarFilters(entries: set.entries, filters: set.filters, isSelecting: true))
        #expect(!CatalogScreen.showsBarFilters(entries: empty.entries, filters: empty.filters, isSelecting: false))
        #expect(CatalogScreen.showsBarFilters(entries: full.entries, filters: full.filters, isSelecting: false))
        #expect(!CatalogScreen.showsBarFilters(entries: full.entries, filters: full.filters, isSelecting: true))
    }

    @Test func emptyCatalogHidesTheFilterRow() {
        #expect(CatalogFilterRow.isShownOnPhoneAndPad(full, hasErrors: false))
        let empty = emptied(full)
        #expect(!CatalogFilterRow.isShownOnPhoneAndPad(empty, hasErrors: false))
        // An error still needs a place to read.
        #expect(CatalogFilterRow.isShownOnPhoneAndPad(empty, hasErrors: true))
        // A stored filter stays reachable so it can be cleared.
        for filters in [
            CatalogFilters(status: "learning"), CatalogFilters(facets: [.key: "D"]),
            CatalogFilters(facets: [.genre: "Old-time"]), CatalogFilters(archived: true),
            CatalogFilters(unheard: true), CatalogFilters(missing: .key),
        ] {
            #expect(CatalogFilterRow.isShownOnPhoneAndPad(withFilters(empty, filters), hasErrors: false))
        }
    }

    #if os(macOS)
        /// The Mac's filters live in the search field, so its row holds the key control and the
        /// set filters' tokens only.
        @Test func macFilterRowHasNoFiltersButton() {
            #expect(CatalogFilterRow.filtersInSearch)
            #expect(
                CatalogFilterRow.controls(full, showsStatus: false) == [.key])
            let keyless = results(full, facets: full.facets.filter { $0 != .key })
            #expect(CatalogFilterRow.controls(keyless, showsStatus: false).isEmpty)
        }

        @Test func macSearchFieldCarriesTheFilterCount() {
            let filters = CatalogFilters(facets: [.key: "D", .genre: "Old-time", .tuneType: "Reel"])
            #expect(CatalogFilterRow.searchFilterCount(filters, filtersInSearch: true) == 3)
            #expect(CatalogFilterRow.searchFilterCount(CatalogFilters(), filtersInSearch: true) == 0)
            #expect(CatalogFilterRow.searchFilterCount(filters, filtersInSearch: false) == nil)
        }

        @Test func filterRowHiddenWhenCatalogIsEmpty() {
            #expect(CatalogFilterRow.isShownOnMac(full, hasErrors: false))
            let empty = emptied(full)
            #expect(!CatalogFilterRow.isShownOnMac(empty, hasErrors: false))
            // An error still needs a place to read.
            #expect(CatalogFilterRow.isShownOnMac(empty, hasErrors: true))
            // A catalog with no key to filter by and nothing set has nothing to show either.
            #expect(!CatalogFilterRow.isShownOnMac(results(full, facets: []), hasErrors: false))
        }

        @Test func emptyCatalogIsNoTunesWithNoSearch() {
            #expect(!CatalogScreen.isEmptyCatalog(full, query: ""))
            #expect(CatalogScreen.isEmptyCatalog(emptied(full), query: ""))
            #expect(CatalogScreen.isEmptyCatalog(emptied(full), query: "  "))
            #expect(!CatalogScreen.isEmptyCatalog(emptied(full), query: "Soldier"))
            #expect(!CatalogScreen.isEmptyCatalog(nil, query: ""))
        }

        /// The search field's filters button is disabled with nothing to filter, as it does while
        /// selecting, and stays up while the catalog loads so it never flickers.
        @Test func filtersAreDisabledForAnEmptyCatalogOrASelection() {
            #expect(!CatalogScreen.filtersAreDisabled(full, isSelecting: false))
            #expect(CatalogScreen.filtersAreDisabled(full, isSelecting: true))
            #expect(CatalogScreen.filtersAreDisabled(emptied(full), isSelecting: false))
            #expect(!CatalogScreen.filtersAreDisabled(nil, isSelecting: false))
        }
    #endif

    @Test func setCountCountsStatusAndKey() {
        #expect(CatalogFilters(status: "known", facets: [.key: "D"]).setCount == 2)
        #expect(CatalogFilters(status: "learning").setCount == 1)
        #expect(CatalogFilterRow.setFilters(CatalogFilters(status: "learning", facets: [.key: "D"])).isEmpty)
    }

    @Test func sheetListsEveryShownFacetInAllOrderKeyFirst() {
        #expect(full.sheetFacets.first == .key)
        #expect(full.sheetFacets == CatalogFacet.all.filter(full.facets.contains))
        let values: [CatalogFacet: [String]] = [.genre: ["Irish"], .key: ["D"], .tuneType: ["Reel"]]
        #expect(
            CatalogSearch.visibleFacets(values, instruments: []) == [.key, .tuneType, .genre])
    }

    @Test func statusPickerKeepsAStaleStatus() {
        let choices = StatusScope.choices(nil)
        #expect(CatalogFilterSheet.statusOptions(choices, set: nil) == choices)
        #expect(CatalogFilterSheet.statusOptions(choices, set: "known") == choices)
        let stale = CatalogFilterSheet.statusOptions(choices, set: "retired")
        #expect(stale.count == choices.count + 1 && stale.last?.status == "retired")
    }

    /// The sample catalog's results with no filter, as the model works them out.
    private var full: CatalogResults {
        let entries = SampleCatalog.entries.map { CatalogEntry(tune: $0.tune, userTune: $0.userTune) }
        let filters = CatalogFilters()
        let visible = CatalogSearch.filter(entries, by: filters, query: "")
        let values = CatalogSearch.facetValues(entries)
        let archivedCount = entries.count(where: \.isArchived)
        return CatalogResults(
            entries: entries, instruments: SampleCatalog.instruments, filters: filters, facetValues: values,
            facets: CatalogSearch.visibleFacets(values, instruments: SampleCatalog.instruments), visible: visible,
            outcome: SearchOutcome(entries: entries, visible: visible, query: "", archivedShown: false),
            total: entries.count - archivedCount, archivedCount: archivedCount,
            missingChoices: CatalogSearch.missingChoices(entries))
    }

    /// `base` with no tunes at all.
    private func emptied(_ base: CatalogResults) -> CatalogResults {
        CatalogResults(
            entries: [], instruments: base.instruments, filters: base.filters, facetValues: base.facetValues,
            facets: [], visible: [],
            outcome: SearchOutcome(
                entries: [CatalogEntry](), visible: [CatalogEntry](), query: "", archivedShown: false),
            total: 0, archivedCount: 0, missingChoices: base.missingChoices)
    }

    private func withFilters(_ base: CatalogResults, _ filters: CatalogFilters) -> CatalogResults {
        CatalogResults(
            entries: base.entries, instruments: base.instruments, filters: filters,
            facetValues: base.facetValues, facets: base.facets, visible: base.visible, outcome: base.outcome,
            total: base.total, archivedCount: base.archivedCount, missingChoices: base.missingChoices)
    }

    /// `base` offering only `facets`.
    private func results(_ base: CatalogResults, facets: [CatalogFacet]) -> CatalogResults {
        CatalogResults(
            entries: base.entries, instruments: base.instruments, filters: base.filters,
            facetValues: base.facetValues, facets: facets, visible: base.visible, outcome: base.outcome,
            total: base.total, archivedCount: base.archivedCount, missingChoices: base.missingChoices)
    }
}
