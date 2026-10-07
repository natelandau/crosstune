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
        let full = CatalogStandIn.results(filters: CatalogFilters(), query: "")
        #expect(CatalogFilterRow.controls(full, showsStatus: false) == [.key, .filters])
        let keyless = results(full, facets: full.facets.filter { $0 != .key })
        #expect(CatalogFilterRow.controls(keyless, showsStatus: false) == [.filters])
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: false) == [.filters])
    }

    @Test func statusLeadsTheRowWhereItShows() {
        let full = CatalogStandIn.results(filters: CatalogFilters(), query: "")
        #expect(CatalogFilterRow.controls(full, showsStatus: true) == [.status, .key, .filters])
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: true) == [.status, .filters])
    }

    @Test func sheetCountNeverCountsStatusOrKey() {
        let filters = CatalogFilters(status: "learning", facets: [.key: "D"])
        #expect(filters.sheetCount == 0)
        #expect(CatalogFilterRow.setFilters(filters).isEmpty)
    }

    /// `base` offering only `facets`.
    private func results(_ base: CatalogResults, facets: [CatalogFacet]) -> CatalogResults {
        CatalogResults(
            entries: base.entries, instruments: base.instruments, filters: base.filters,
            facetValues: base.facetValues, facets: facets, visible: base.visible, outcome: base.outcome,
            total: base.total, archivedCount: base.archivedCount, missingChoices: base.missingChoices)
    }
}
