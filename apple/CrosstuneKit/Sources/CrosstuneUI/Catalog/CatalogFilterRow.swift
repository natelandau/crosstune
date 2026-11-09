import CrosstuneDesign
import SwiftUI

/// The catalog's filters on one row: the status and key pull-downs, then each set sheet filter as
/// a token that removes it. The Filters button lives in the bar on iPhone and iPad and in the
/// search field on the Mac, which also leaves status to its sidebar.
struct CatalogFilterRow: View {
    nonisolated static let archivedShown = "Archived shown"

    nonisolated static func statusLabel(_ selected: String?) -> String {
        "\(TuneFieldLabels.status): \(selected.map(StatusStyle.label) ?? CatalogFilterSheet.any)"
    }

    nonisolated static func keyLabel(_ selected: String?) -> String {
        "\(CatalogFacet.key.label): \(selected.map(CatalogFacet.key.valueLabel) ?? CatalogFilterSheet.any)"
    }

    /// One of the controls that lead the row.
    enum Control: Hashable, Sendable {
        case status
        case key
    }

    /// Whether the Filters button sits in the search field rather than on this row.
    nonisolated static var filtersInSearch: Bool {
        #if os(macOS)
            true
        #else
            false
        #endif
    }

    /// The row's controls in order. Status shows when `showsStatus`, and a facet the catalog does
    /// not offer has no control.
    nonisolated static func controls(_ results: CatalogResults, showsStatus: Bool) -> [Control] {
        var controls: [Control] = showsStatus ? [.status] : []
        if results.facets.contains(.key) { controls.append(.key) }
        return controls
    }

    /// The count the search field's Filters button carries, or nil where the field has none.
    nonisolated static func searchFilterCount(_ filters: CatalogFilters, filtersInSearch: Bool) -> Int? {
        filtersInSearch ? filters.setCount : nil
    }

    /// Whether the Mac's row has anything to show. An empty catalog has nothing to narrow, and a
    /// row left with no control and no token would be a gap; an error always shows.
    nonisolated static func isShownOnMac(_ results: CatalogResults, hasErrors: Bool) -> Bool {
        if hasErrors { return true }
        guard !results.entries.isEmpty else { return false }
        return !controls(results, showsStatus: false).isEmpty
            || !setFilters(results.filters).isEmpty
    }

    /// Whether the iPhone and iPad row shows: an empty catalog has nothing to narrow, unless a
    /// stored filter is set, which the row must still let the musician clear; an error always
    /// shows.
    nonisolated static func isShownOnPhoneAndPad(_ results: CatalogResults, hasErrors: Bool) -> Bool {
        if hasErrors { return true }
        return !results.entries.isEmpty || results.filters.setCount > 0
    }

    /// A set sheet filter as its token reads, and the change that removes it.
    struct SetFilter: Identifiable {
        /// The filter's storage key, or `archived`.
        let id: String
        let label: String
        let remove: @Sendable (inout CatalogFilters) -> Void
    }

    /// Every set sheet filter, in sheet order. A set key shows on its own control.
    nonisolated static func setFilters(_ filters: CatalogFilters) -> [SetFilter] {
        var set = CatalogFacet.all.filter(\.isToken).compactMap { facet in
            filters[facet].map {
                SetFilter(id: facet.storageKey, label: facet.capsuleLabel($0)) { $0[facet] = nil }
            }
        }
        if filters.archived {
            set.append(SetFilter(id: "archived", label: archivedShown) { $0.archived = false })
        }
        if let missing = filters.missing {
            set.append(
                SetFilter(id: "missing", label: "\(CatalogFilterSheet.missing) \(missing.label)") { $0.missing = nil })
        }
        return set
    }

    private let results: CatalogResults
    /// The status pull-down's choices, or nil for a row with no status control.
    private let statusChoices: [StatusScope.Choice]?
    private let errors: [String]
    private let onChange: (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void

    @State private var choosingKey = false
    @Environment(\.colorScheme) private var colorScheme

    init(results: CatalogResults, model: CatalogModel, statusChoices: [StatusScope.Choice]?) {
        self.init(
            results: results, statusChoices: statusChoices,
            errors: [model.filterError, model.actionError].compactMap { $0 },
            onChange: model.updateFilters)
    }

    init(
        results: CatalogResults, statusChoices: [StatusScope.Choice]? = nil, errors: [String],
        onChange: @escaping (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void
    ) {
        self.results = results
        self.statusChoices = statusChoices
        self.errors = errors
        self.onChange = onChange
    }

    var body: some View {
        let tokens = Self.setFilters(results.filters)
        VStack(alignment: .leading, spacing: 6) {
            arrangement(tokens)
            ForEach(errors, id: \.self) { error in
                Text(error)
                    .font(PageStyle.secondary)
                    .foregroundStyle(Palette.danger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .phoneAnimation(value: tokens.map(\.id))
    }

    #if os(macOS)
        // The Mac keeps its three arrangements: tokens trail the controls while the row has room,
        // wrap under them when it does not, and at the largest text sizes the controls wrap too.
        private func arrangement(_ tokens: [SetFilter]) -> some View {
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
        }

        @ViewBuilder private func wrappedTokens(_ tokens: [SetFilter]) -> some View {
            if !tokens.isEmpty {
                FlowLayout(spacing: 6, lineSpacing: 6) { tokenViews(tokens) }
            }
        }
    #else
        // One flow, so chips fill each line to the column edge and only the overflow wraps.
        private func arrangement(_ tokens: [SetFilter]) -> some View {
            FlowLayout(spacing: 6, lineSpacing: 6) {
                controls
                tokenViews(tokens)
            }
        }
    #endif

    private var controls: some View {
        ForEach(Self.controls(results, showsStatus: statusChoices != nil), id: \.self) { control in
            switch control {
            case .status: statusControl
            case .key: keyControl
            }
        }
    }

    private var statusControl: some View {
        let selected = results.filters.status
        return ChipMenu(isSet: selected != nil) {
            ForEach(statusChoices ?? []) { choice in
                // A toggle, so the menu checks the chosen status and VoiceOver hears it, beside a
                // glyph in the color the rows draw it.
                Toggle(
                    isOn: Binding {
                        selected == choice.status
                    } set: { isOn in
                        if isOn, choice.status != selected { onChange { $0.status = choice.status } }
                    }
                ) {
                    Label {
                        Text(choice.count.map { "\(choice.label) \($0)" } ?? choice.label)
                    } icon: {
                        if let status = choice.status {
                            StatusMenuIcon.image(status, scheme: colorScheme)
                        } else {
                            Image(systemName: choice.systemImage)
                        }
                    }
                }
            }
        } label: {
            Text(Self.statusLabel(selected))
        }
    }

    private var keyControl: some View {
        let selected = results.selected(.key)
        return Chip(.menu(isSet: selected != nil)) {
            choosingKey = true
        } label: {
            Text(Self.keyLabel(selected))
        }
        .popover(isPresented: $choosingKey, arrowEdge: PageStyle.popoverArrowEdge) {
            KeyFilterPopover(choices: results.choices(.key), selected: selected) { key in
                choosingKey = false
                onChange { $0[.key] = key }
            }
            .presentationCompactAdaptation(.popover)
        }
        #if DEBUG
            .opensForSample(.keyFilter) { choosingKey = true }
        #endif
    }

    private func tokenViews(_ tokens: [SetFilter]) -> some View {
        ForEach(tokens) { token in
            RemoveFilterCapsule(label: token.label) { onChange(token.remove) }
                .phoneTransition(RemoveFilterCapsule.insertion)
        }
    }
}
