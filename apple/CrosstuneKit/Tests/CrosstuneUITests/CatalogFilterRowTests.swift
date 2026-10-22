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
        #expect(CatalogFilterRow.controls(full, showsStatus: false, filtersInSearch: false) == [.key, .filters])
        let keyless = results(full, facets: full.facets.filter { $0 != .key })
        #expect(CatalogFilterRow.controls(keyless, showsStatus: false, filtersInSearch: false) == [.filters])
        #expect(
            CatalogFilterRow.controls(results(full, facets: []), showsStatus: false, filtersInSearch: false)
                == [.filters])
    }

    @Test func statusLeadsTheRowWhereItShows() {
        #expect(
            CatalogFilterRow.controls(full, showsStatus: true, filtersInSearch: false) == [.status, .key, .filters])
        #expect(
            CatalogFilterRow.controls(results(full, facets: []), showsStatus: true, filtersInSearch: false)
                == [.status, .filters])
    }

    #if os(macOS)
        /// The Mac's filters live in the search field, so its row holds the key control and the
        /// set filters' tokens only.
        @Test func macFilterRowHasNoFiltersButton() {
            #expect(CatalogFilterRow.filtersInSearch)
            #expect(
                CatalogFilterRow.controls(full, showsStatus: false, filtersInSearch: CatalogFilterRow.filtersInSearch)
                    == [.key])
            let keyless = results(full, facets: full.facets.filter { $0 != .key })
            #expect(CatalogFilterRow.controls(keyless, showsStatus: false, filtersInSearch: true).isEmpty)
        }

        @Test func macSearchFieldCarriesTheFilterCount() {
            let filters = CatalogFilters(facets: [.key: "D", .genre: "Old-time", .tuneType: "Reel"])
            #expect(CatalogFilterRow.searchFilterCount(filters, filtersInSearch: true) == 2)
            #expect(CatalogFilterRow.searchFilterCount(CatalogFilters(), filtersInSearch: true) == 0)
            #expect(CatalogFilterRow.searchFilterCount(filters, filtersInSearch: false) == nil)
        }

        @Test func filterRowHiddenWhenCatalogIsEmpty() {
            #expect(CatalogFilterRow.isShown(full, hasErrors: false))
            let empty = emptied(full)
            #expect(!CatalogFilterRow.isShown(empty, hasErrors: false))
            // An error still needs a place to read.
            #expect(CatalogFilterRow.isShown(empty, hasErrors: true))
            // A catalog with no key to filter by and nothing set has nothing to show either.
            #expect(!CatalogFilterRow.isShown(results(full, facets: []), hasErrors: false))
        }

        @Test func emptyCatalogIsNoTunesWithNoSearch() {
            #expect(!CatalogScreen.isEmptyCatalog(full, query: ""))
            #expect(CatalogScreen.isEmptyCatalog(emptied(full), query: ""))
            #expect(CatalogScreen.isEmptyCatalog(emptied(full), query: "  "))
            #expect(!CatalogScreen.isEmptyCatalog(emptied(full), query: "Soldier"))
            #expect(!CatalogScreen.isEmptyCatalog(nil, query: ""))
        }

        /// The search field's filters button stands down with nothing to filter, as it does while
        /// selecting, and stays up while the catalog loads so it never flickers.
        @Test func filtersStandDownForAnEmptyCatalogOrASelection() {
            #expect(!CatalogScreen.filtersStandDown(full, isSelecting: false))
            #expect(CatalogScreen.filtersStandDown(full, isSelecting: true))
            #expect(CatalogScreen.filtersStandDown(emptied(full), isSelecting: false))
            #expect(!CatalogScreen.filtersStandDown(nil, isSelecting: false))
        }
    #endif

    @Test func sheetCountNeverCountsStatusOrKey() {
        let filters = CatalogFilters(status: "learning", facets: [.key: "D"])
        #expect(filters.sheetCount == 0)
        #expect(CatalogFilterRow.setFilters(filters).isEmpty)
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

    /// `base` offering only `facets`.
    private func results(_ base: CatalogResults, facets: [CatalogFacet]) -> CatalogResults {
        CatalogResults(
            entries: base.entries, instruments: base.instruments, filters: base.filters,
            facetValues: base.facetValues, facets: facets, visible: base.visible, outcome: base.outcome,
            total: base.total, archivedCount: base.archivedCount, missingChoices: base.missingChoices)
    }
}
