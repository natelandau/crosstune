import SwiftUI

/// The catalog's filters on one row: the key and type pull-downs, the Filters button with its
/// count, then each set sheet filter as a token that removes it. Status is the Mac sidebar's and
/// the iPhone title menu's.
struct CatalogFilterRow: View {
    nonisolated static let archivedShown = "Archived shown"
    nonisolated static let unheardShown = "Unheard"

    nonisolated static func keyLabel(_ selected: String?) -> String {
        "\(CatalogFacet.key.label): \(selected.map(CatalogFacet.key.valueLabel) ?? CatalogFilterSheet.any)"
    }

    nonisolated static func typeLabel(_ selected: String?) -> String {
        "\(CatalogFacet.tuneType.label): \(selected ?? CatalogFilterSheet.any)"
    }

    /// One of the controls that lead the row.
    enum Control: Hashable, Sendable {
        case key
        case tuneType
        case filters
    }

    /// The row's controls in order. A facet the catalog does not offer has no control, and
    /// Filters always shows.
    nonisolated static func controls(_ results: CatalogResults) -> [Control] {
        var controls: [Control] = []
        if results.facets.contains(.key) { controls.append(.key) }
        if results.facets.contains(.tuneType) { controls.append(.tuneType) }
        return controls + [.filters]
    }

    /// A set sheet filter as its token reads, and the change that removes it.
    struct SetFilter: Identifiable {
        /// The filter's storage key, or `archived`.
        let id: String
        let label: String
        let remove: @Sendable (inout CatalogFilters) -> Void
    }

    /// Every set sheet filter, in sheet order. A set key or type shows on its own control.
    nonisolated static func setFilters(_ filters: CatalogFilters) -> [SetFilter] {
        var set = CatalogFacet.all.filter(\.isInSheet).compactMap { facet in
            filters[facet].map {
                SetFilter(id: facet.storageKey, label: facet.capsuleLabel($0)) { $0[facet] = nil }
            }
        }
        if filters.archived {
            set.append(SetFilter(id: "archived", label: archivedShown) { $0.archived = false })
        }
        if filters.unheard {
            set.append(SetFilter(id: "unheard", label: unheardShown) { $0.unheard = false })
        }
        if let missing = filters.missing {
            set.append(
                SetFilter(id: "missing", label: "\(CatalogFilterSheet.missing) \(missing.label)") { $0.missing = nil })
        }
        return set
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
        let tokens = Self.setFilters(results.filters)
        VStack(alignment: .leading, spacing: 6) {
            // The tokens trail the controls while the row has room, and wrap under them when it
            // does not. At the largest text sizes the controls wrap too, rather than clipping.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    controls
                    tokenViews(tokens)
                }
                .fixedSize()
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) { controls }
                    wrappedTokens(tokens)
                }
                VStack(alignment: .leading, spacing: 6) {
                    FlowLayout(spacing: 6, lineSpacing: 6) { controls }
                    wrappedTokens(tokens)
                }
            }
            ForEach(errors, id: \.self) { error in
                Text(error)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .phoneAnimation(value: tokens.map(\.id))
    }

    private var controls: some View {
        ForEach(Self.controls(results), id: \.self) { control in
            switch control {
            case .key: keyControl
            case .tuneType: typeControl
            case .filters: filtersControl
            }
        }
    }

    private var keyControl: some View {
        let selected = results.selected(.key)
        return Button {
            choosingKey = true
        } label: {
            PullDownLabel(text: Self.keyLabel(selected))
        }
        .buttonStyle(FilterControlStyle(isSet: selected != nil))
        .popover(isPresented: $choosingKey, arrowEdge: PageStyle.popoverArrowEdge) {
            KeyFilterPopover(choices: results.choices(.key), selected: selected) { key in
                choosingKey = false
                onChange { $0[.key] = key }
            }
            .presentationCompactAdaptation(.popover)
        }
    }

    private var typeControl: some View {
        let selected = results.selected(.tuneType)
        return Menu {
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

    private var filtersControl: some View {
        let count = results.filters.sheetCount
        return FiltersButton(
            setCount: count, gate: isSelecting ? .disabled(reason: nil) : .enabled,
            action: onFilters
        )
        .buttonStyle(FilterControlStyle(isSet: count > 0))
    }

    @ViewBuilder private func wrappedTokens(_ tokens: [SetFilter]) -> some View {
        if !tokens.isEmpty {
            FlowLayout(spacing: 6, lineSpacing: 6) { tokenViews(tokens) }
        }
    }

    private func tokenViews(_ tokens: [SetFilter]) -> some View {
        ForEach(tokens) { token in
            RemoveFilterCapsule(label: token.label) { onChange(token.remove) }
                .phoneTransition(RemoveFilterCapsule.insertion)
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
                .font(PageStyle.pullDownChevron)
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

    /// How far the hit area reaches past the drawn capsule to make a touch target.
    private static let hitOutset = max(0, (PageStyle.minTarget - PageStyle.filterControlHeight) / 2)

    var body: some View {
        let capsule = configuration.label
            .font(PageStyle.body)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            // Grows past its height only when the text size does, so a large label never clips.
            .padding(.vertical, 3)
            .frame(minHeight: PageStyle.filterControlHeight)
            .background(fill, in: .capsule)
            .phoneAnimation(value: isSet)
            .contentShape(.capsule)
            .opacity(configuration.isPressed ? 0.6 : 1)
        if Self.hitOutset > 0 {
            capsule
                .padding(Self.hitOutset)
                .contentShape(.rect)
                .padding(-Self.hitOutset)
        } else {
            capsule
        }
    }

    private var foreground: AnyShapeStyle {
        if !isEnabled { return AnyShapeStyle(.tertiary) }
        return isSet ? AnyShapeStyle(BrandStyle.setLabel(colorScheme)) : AnyShapeStyle(.primary)
    }

    private var fill: AnyShapeStyle {
        isSet ? AnyShapeStyle(BrandStyle.setFill(colorScheme)) : neutralFill(colorScheme)
    }
}
