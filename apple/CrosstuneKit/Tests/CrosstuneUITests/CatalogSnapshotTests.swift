import CrosstuneStore
import SwiftUI
import Testing

@testable import CrosstuneUI

/// The catalog laid out from stand-ins, since an image renderer draws no list: the real filter
/// bar, tune rows, hidden match note, add row, and count, stacked as the list shows them.
struct CatalogStandIn: View {
    var filters = CatalogFilters(
        status: "learning", facets: [.key: "A", .genre: "Old-time", .tuning("violin"): "Cross A (AEAE)"])
    var query = ""

    var body: some View {
        let entries = SampleCatalog.entries.map { CatalogEntry(tune: $0.tune, userTune: $0.userTune) }
        let visible = CatalogSearch.filter(entries, by: filters, query: query)
        let outcome = SearchOutcome(entries: entries, visible: visible, query: query, archivedShown: filters.archived)
        let values = CatalogSearch.facetValues(entries)
        let total = CatalogSearch.hidingArchived(entries, shown: filters.archived).count
        let results = CatalogResults(
            entries: entries, instruments: SampleCatalog.instruments, filters: filters, facetValues: values,
            facets: CatalogSearch.visibleFacets(values, instruments: SampleCatalog.instruments), visible: visible,
            outcome: outcome, total: total, archivedCount: entries.count(where: \.isArchived))
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer()
                CatalogFiltersButton(setCount: filters.sheetCount) {}
            }
            CatalogFilterBar(results: results, errors: [], onChange: { _ in })
                .padding(.horizontal, -16)
            ForEach(visible) { entry in
                TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: SampleCatalog.instruments)
                Divider()
            }
            if let hidden = outcome.hidden {
                HiddenMatchNote(match: hidden) { _ in }
            }
            if let offer = outcome.offerLabel {
                SearchOfferRow(label: offer) {}
            }
            Text(results.countLabel)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
    }
}

@MainActor
@Suite struct CatalogSnapshotTests {
    @Test func filtered() {
        snapshot("catalog-filtered") { CatalogStandIn() }
    }

    @Test func searchingForAHiddenTitle() {
        snapshot("catalog-search") {
            CatalogStandIn(filters: CatalogFilters(status: "known"), query: "cluck old hen")
        }
    }

    @Test func preview() {
        let entry = SampleCatalog.entries[1]
        snapshot("catalog-preview", width: 352) {
            TunePreview(
                entry: CatalogEntry(tune: entry.tune, userTune: entry.userTune), instruments: SampleCatalog.instruments)
        }
    }
}
