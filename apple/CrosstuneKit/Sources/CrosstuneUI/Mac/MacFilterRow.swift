#if os(macOS)
    import SwiftUI

    /// The Mac catalog's filters on one row: the key and type pull-downs, the Filters button with
    /// its count, then each set sheet filter as a token that removes it. Status is the sidebar's.
    struct MacFilterRow: View {
        nonisolated static func keyLabel(_ selected: String?) -> String {
            "\(CatalogFacet.key.label): \(selected.map(CatalogFacet.key.valueLabel) ?? CatalogFilterSheet.any)"
        }

        nonisolated static func typeLabel(_ selected: String?) -> String {
            "\(CatalogFacet.tuneType.label): \(selected ?? CatalogFilterSheet.any)"
        }

        private let results: CatalogResults
        private let errors: [String]
        private let onChange: (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void
        private let onFilters: () -> Void
        /// The sheet's filters stand down while selecting, as the catalog's own actions do.
        private let isSelecting: Bool

        @State private var choosingKey = false

        /// `onFilters` opens the filter sheet, which the screen presents.
        init(results: CatalogResults, model: CatalogModel, isSelecting: Bool, onFilters: @escaping () -> Void) {
            self.init(
                results: results, errors: [model.filterError, model.actionError].compactMap { $0 },
                onChange: model.updateFilters, isSelecting: isSelecting, onFilters: onFilters)
        }

        init(
            results: CatalogResults, errors: [String],
            onChange: @escaping (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void,
            isSelecting: Bool = false, onFilters: @escaping () -> Void
        ) {
            self.results = results
            self.errors = errors
            self.onChange = onChange
            self.isSelecting = isSelecting
            self.onFilters = onFilters
        }

        var body: some View {
            let tokens = CatalogFilterBar.setFilters(results.filters)
            VStack(alignment: .leading, spacing: 6) {
                // The tokens trail the controls while the column has room, and wrap under them
                // when it does not.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        controls
                        tokenViews(tokens)
                    }
                    .fixedSize()
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) { controls }
                        if !tokens.isEmpty {
                            FlowLayout(spacing: 6, lineSpacing: 6) { tokenViews(tokens) }
                        }
                    }
                }
                ForEach(errors, id: \.self) { error in
                    Text(error)
                        .font(MacStyle.secondary)
                        .foregroundStyle(.red)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        @ViewBuilder private var controls: some View {
            if results.facets.contains(.key) {
                let selected = results.selected(.key)
                Button {
                    choosingKey = true
                } label: {
                    PullDownLabel(text: Self.keyLabel(selected))
                }
                .buttonStyle(FilterControlStyle(isSet: selected != nil))
                .popover(isPresented: $choosingKey, arrowEdge: .bottom) {
                    KeyFilterPopover(choices: results.choices(.key), selected: selected) { key in
                        choosingKey = false
                        onChange { $0[.key] = key }
                    }
                }
            }
            if results.facets.contains(.tuneType) {
                let selected = results.selected(.tuneType)
                Menu {
                    Picker(CatalogFacet.tuneType.label, selection: typeChoice) {
                        Text(CatalogFilterSheet.any).tag(String?.none)
                        ForEach(results.choices(.tuneType), id: \.self) { type in
                            Text(type).tag(Optional(type))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } label: {
                    PullDownLabel(text: Self.typeLabel(selected))
                }
                .menuStyle(.button)
                .menuIndicator(.hidden)
                .buttonStyle(FilterControlStyle(isSet: selected != nil))
                .fixedSize()
            }
            let count = results.filters.sheetCount(railsOnScreen: true)
            FiltersButton(setCount: count, gate: isSelecting ? .disabled(reason: nil) : .enabled, action: onFilters)
                .buttonStyle(FilterControlStyle(isSet: count > 0))
        }

        private func tokenViews(_ tokens: [CatalogFilterBar.SetFilter]) -> some View {
            ForEach(tokens) { token in
                RemoveFilterCapsule(label: token.label) { onChange(token.remove) }
            }
        }

        private var typeChoice: Binding<String?> {
            Binding {
                results.selected(.tuneType)
            } set: { type in
                onChange { $0[.tuneType] = type }
            }
        }
    }

    /// A pull-down's face: its wording, then a small chevron saying it opens a choice.
    private struct PullDownLabel: View {
        let text: String

        var body: some View {
            HStack(spacing: 4) {
                Text(text)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// A filter row control: a quiet capsule at rest, slate once it narrows the list, so a set
    /// filter reads at a glance.
    struct FilterControlStyle: ButtonStyle {
        var isSet = false

        func makeBody(configuration: Configuration) -> some View {
            FilterControlBody(configuration: configuration, isSet: isSet)
        }
    }

    private struct FilterControlBody: View {
        let configuration: ButtonStyle.Configuration
        let isSet: Bool

        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(MacStyle.body)
                .lineLimit(1)
                .foregroundStyle(foreground)
                .padding(.horizontal, 10)
                .frame(height: MacStyle.smallControlHeight)
                .background(fill, in: .capsule)
                .contentShape(.capsule)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }

        private var foreground: AnyShapeStyle {
            if !isEnabled { return AnyShapeStyle(.tertiary) }
            return isSet ? AnyShapeStyle(MacStyle.setLabel(colorScheme)) : AnyShapeStyle(.primary)
        }

        private var fill: AnyShapeStyle {
            isSet ? AnyShapeStyle(MacStyle.setFill(colorScheme)) : neutralFill(colorScheme)
        }
    }
#endif
