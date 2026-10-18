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
        #expect(CatalogFilterRow.controls(full, showsStatus: false) == [.key, .filters])
        let keyless = results(full, facets: full.facets.filter { $0 != .key })
        #expect(CatalogFilterRow.controls(keyless, showsStatus: false) == [.filters])
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: false) == [.filters])
    }

    @Test func statusLeadsTheRowWhereItShows() {
        #expect(CatalogFilterRow.controls(full, showsStatus: true) == [.status, .key, .filters])
        #expect(CatalogFilterRow.controls(results(full, facets: []), showsStatus: true) == [.status, .filters])
    }

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

    /// `base` offering only `facets`.
    private func results(_ base: CatalogResults, facets: [CatalogFacet]) -> CatalogResults {
        CatalogResults(
            entries: base.entries, instruments: base.instruments, filters: base.filters,
            facetValues: base.facetValues, facets: facets, visible: base.visible, outcome: base.outcome,
            total: base.total, archivedCount: base.archivedCount, missingChoices: base.missingChoices)
    }
}
