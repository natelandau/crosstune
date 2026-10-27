import CrosstuneAnalytics
import SwiftUI

/// Every filter the catalog has: status, every facet, and the archived setting. Each choice
/// applies at once; Reset clears them all; Done closes it.
struct CatalogFilterSheet: View {
    static let title = "Filters"
    static let reset = "Reset"
    static let done = "Done"
    nonisolated static let any = "Any"
    static let showArchived = "Show archived"
    static let onlyUnheard = "Only unheard"
    nonisolated static let missing = "Missing"
    static let status = "Status"

    /// "3 archived tunes", under the Show archived switch.
    nonisolated static func archivedFooter(_ count: Int) -> String {
        "\(count) archived \(count == 1 ? "tune" : "tunes")"
    }

    /// The Mac footer's count: the catalog's own count wording.
    nonisolated static func footerCount(visible: Int, total: Int) -> String {
        CatalogSearch.countLabel(visible: visible, total: total)
    }

    let model: CatalogModel
    let statusChoices: [StatusScope.Choice]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        #if os(macOS)
            Group {
                if let results = model.results {
                    macSheet(results)
                } else {
                    Color.clear.macSheetFrame(Self.macSize)
                }
            }
            .partHeightSheet()
        #else
            NavigationStack {
                if let results = model.results {
                    form(results)
                }
            }
            .partHeightSheet()
        #endif
    }

    private func close() {
        dismiss()
    }

    #if os(macOS)
        static let macSize = MacSheetSize.fitted(max: 680)

        /// Every choice applies at once, so Escape closes it as Done does.
        private func macSheet(_ results: CatalogResults) -> some View {
            MacSheet(
                title: Self.title, size: Self.macSize, cancel: nil, primary: .init(Self.done, action: close),
                escape: close
            ) {
                HStack(spacing: 12) {
                    Text(Self.footerCount(visible: results.visible.count, total: results.total))
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.textSecondary)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Button(Self.reset) {
                        model.updateFilters { $0 = $0.cleared }
                    }
                    .buttonStyle(.macPlain)
                    .disabled(results.filters.setCount == 0)
                }
            } content: {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    MacFormSection {
                        statusPicker(results)
                        ForEach(results.sheetFacets, id: \.self) { facet in
                            facetPopUp(facet, results)
                        }
                    }
                    MacFormSection {
                        unheardToggle(results)
                        missingPopUp(results)
                    }
                    MacFormSection {
                        macArchivedToggle(results)
                    }
                }
            }
        }
    #endif

    private func form(_ results: CatalogResults) -> some View {
        GroupedForm {
            Section {
                statusPicker(results)
            } header: {
                Text(results.countLabel)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
            Section {
                ForEach(results.sheetFacets, id: \.self) { facet in
                    facetPopUp(facet, results)
                }
            }
            Section {
                unheardToggle(results)
                missingPopUp(results)
            }
            Section {
                archivedToggle(results)
            } footer: {
                Text(Self.archivedFooter(results.archivedCount))
                    .monospacedDigit()
            }
        }
        .navigationTitle(Self.title)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: Self.resetPlacement) {
                Button(Self.reset) {
                    model.updateFilters { $0 = $0.cleared }
                }
                .disabled(results.filters.setCount == 0)
            }
            ConfirmToolbarItem {
                Button(Self.done) { dismiss() }
            }
        }
    }

    /// The status choices, with a set status none of them holds kept, so a stale filter never
    /// reads as Any.
    nonisolated static func statusOptions(_ choices: [StatusScope.Choice], set: String?) -> [StatusScope.Choice] {
        guard let set, !choices.contains(where: { $0.status == set }) else { return choices }
        return choices + [StatusScope.Choice(status: set, label: set, count: nil)]
    }

    @ViewBuilder private func statusPicker(_ results: CatalogResults) -> some View {
        let status = Binding {
            results.filters.status
        } set: { status in
            model.updateFilters { $0.status = status }
        }
        let options = Self.statusOptions(statusChoices, set: results.filters.status)
        #if os(macOS)
            MacPopUp(
                Self.status, selection: status, options: options.map(\.status),
                label: { value in options.first { $0.status == value }?.label ?? value ?? "" },
                isSet: results.filters.status != nil)
        #else
            Picker(Self.status, selection: status) {
                ForEach(options) { choice in
                    Text(choice.label).tag(choice.status)
                }
            }
        #endif
    }

    @ViewBuilder private func facetPopUp(_ facet: CatalogFacet, _ results: CatalogResults) -> some View {
        #if os(macOS)
            MacPopUp(
                facet.label, selection: selection(facet, results),
                options: [nil] + results.choices(facet).map(Optional.some),
                label: { $0.map(facet.valueLabel) ?? Self.any },
                isSet: results.selected(facet) != nil
            )
            .contentMask()
        #else
            Picker(facet.label, selection: selection(facet, results)) {
                Text(Self.any).tag(String?.none)
                ForEach(results.choices(facet), id: \.self) { value in
                    Text(facet.valueLabel(value)).contentMask().tag(String?.some(value))
                }
            }
        #endif
    }

    private func unheardToggle(_ results: CatalogResults) -> some View {
        Toggle(
            Self.onlyUnheard,
            isOn: Binding {
                results.filters.unheard
            } set: { unheard in
                model.updateFilters { $0.unheard = unheard }
            })
    }

    @ViewBuilder private func missingPopUp(_ results: CatalogResults) -> some View {
        let missing = Binding {
            results.filters.missing
        } set: { missing in
            model.updateFilters { $0.missing = missing }
        }
        #if os(macOS)
            MacPopUp(
                Self.missing, selection: missing, options: [nil] + results.missingOptions.map(Optional.some),
                label: { $0?.label ?? Self.any }, isSet: results.filters.missing != nil)
        #else
            Picker(Self.missing, selection: missing) {
                Text(Self.any).tag(MissingAttribute?.none)
                ForEach(results.missingOptions, id: \.self) { attribute in
                    Text(attribute.label).tag(MissingAttribute?.some(attribute))
                }
            }
        #endif
    }

    #if os(macOS)
        /// Show archived, with the archived count as the row's help.
        private func macArchivedToggle(_ results: CatalogResults) -> some View {
            Toggle(isOn: archivedBinding(results)) {
                Text(Self.showArchived)
                Text(Self.archivedFooter(results.archivedCount))
                    .monospacedDigit()
            }
        }
    #endif

    private func archivedBinding(_ results: CatalogResults) -> Binding<Bool> {
        Binding {
            results.filters.archived
        } set: { archived in
            model.updateFilters { $0.archived = archived }
        }
    }

    private func archivedToggle(_ results: CatalogResults) -> some View {
        Toggle(Self.showArchived, isOn: archivedBinding(results))
    }

    private func selection(_ facet: CatalogFacet, _ results: CatalogResults) -> Binding<String?> {
        Binding {
            results.selected(facet)
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
