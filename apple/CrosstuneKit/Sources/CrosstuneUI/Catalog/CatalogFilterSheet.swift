import SwiftUI

/// Every facet the catalog filters on, plus the archived setting. Each choice applies at once;
/// Reset clears the sheet's filters and leaves status alone; Done closes it.
struct CatalogFilterSheet: View {
    static let title = "Filters"
    static let reset = "Reset"
    static let done = "Done"
    static let any = "Any"
    static let showArchived = "Show archived"

    /// "3 archived tunes", under the Show archived switch.
    nonisolated static func archivedFooter(_ count: Int) -> String {
        "\(count) archived \(count == 1 ? "tune" : "tunes")"
    }

    let model: CatalogModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var railsOnScreen: Bool { CatalogFilterBar.railsOnScreen(dynamicTypeSize) }

    var body: some View {
        NavigationStack {
            if let results = model.results {
                form(results)
            }
        }
        .partHeightSheet()
    }

    private func form(_ results: CatalogResults) -> some View {
        Form {
            Section {
                ForEach(results.sheetFacets(railsOnScreen: railsOnScreen), id: \.self) { facet in
                    Picker(facet.label, selection: selection(facet, results.filters)) {
                        Text(Self.any).tag(String?.none)
                        ForEach(results.choices(facet), id: \.self) { value in
                            Text(value).tag(String?.some(value))
                        }
                    }
                }
            } header: {
                Text(results.countLabel)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
            Section {
                Toggle(
                    Self.showArchived,
                    isOn: Binding {
                        results.filters.archived
                    } set: { archived in
                        model.updateFilters { $0.archived = archived }
                    })
            } footer: {
                Text(Self.archivedFooter(results.archivedCount))
                    .monospacedDigit()
            }
        }
        .formStyle(.grouped)
        .navigationTitle(Self.title)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: Self.resetPlacement) {
                Button(Self.reset) {
                    let railsOnScreen = railsOnScreen
                    model.updateFilters { $0 = $0.sheetReset(railsOnScreen: railsOnScreen) }
                }
                .disabled(results.filters.sheetCount(railsOnScreen: railsOnScreen) == 0)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(Self.done) { dismiss() }
            }
        }
    }

    private func selection(_ facet: CatalogFacet, _ filters: CatalogFilters) -> Binding<String?> {
        Binding {
            filters[facet]
        } set: { value in
            model.updateFilters { $0[facet] = value }
        }
    }

    /// Reset leads the bar. On the Mac it stays off Escape, which a cancellation action takes.
    private static var resetPlacement: ToolbarItemPlacement {
        #if os(iOS)
            .topBarLeading
        #else
            .destructiveAction
        #endif
    }
}
