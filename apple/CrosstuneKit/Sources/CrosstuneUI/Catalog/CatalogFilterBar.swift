import SwiftUI

/// The filters on the catalog screen, under the search field: the status rail, a rail each for
/// key and type while the catalog holds them, then a removable capsule for each filter the sheet
/// set.
struct CatalogFilterBar: View {
    nonisolated static let archivedShown = "Archived shown"
    nonisolated static let removeFilter = "Remove filter"
    nonisolated static let allKeys = "All keys"
    nonisolated static let allTypes = "All types"
    /// The id of a rail's leading All chip.
    nonisolated static let allID = "all"

    /// A set sheet filter as its capsule reads, and the change that removes it.
    struct SetFilter: Identifiable {
        /// The filter's storage key, or `archived`.
        let id: String
        let label: String
        let remove: @Sendable (inout CatalogFilters) -> Void
    }

    /// Every set sheet filter, in sheet order. With `railsOnScreen` false the key and type are
    /// set in the sheet too, so they show here.
    nonisolated static func setFilters(_ filters: CatalogFilters, railsOnScreen: Bool = true) -> [SetFilter] {
        var set = CatalogFacet.all.filter { $0.isInSheet(railsOnScreen: railsOnScreen) }.compactMap { facet in
            filters[facet].map {
                SetFilter(id: facet.storageKey, label: facet.capsuleLabel($0)) { $0[facet] = nil }
            }
        }
        if filters.archived {
            set.append(SetFilter(id: "archived", label: archivedShown) { $0.archived = false })
        }
        return set
    }

    let results: CatalogResults
    let errors: [String]
    let onChange: (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void

    /// The space before a rail's first chip, matching the list's own margin.
    private static let inset: CGFloat = 16

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var filters: CatalogFilters { results.filters }

    /// Whether the key and type rails show here. At the accessibility text sizes they move into
    /// the filter sheet, since the bar stays put while the tunes scroll under it.
    static func railsOnScreen(_ size: DynamicTypeSize) -> Bool {
        !size.isAccessibilitySize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            controls
                // Past this size the pinned bar would leave almost no room for the tunes. The
                // chips scroll or wrap, so no word is lost.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            ForEach(errors, id: \.self) { error in
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, Self.inset)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var controls: some View {
        let railsOnScreen = Self.railsOnScreen(dynamicTypeSize)
        VStack(alignment: .leading, spacing: 4) {
            StatusRail(
                filter: Binding {
                    filters.status
                } set: { status in
                    onChange { $0.status = status }
                },
                inset: Self.inset
            )
            if railsOnScreen, results.facets.contains(.key) {
                facetRail(.key, all: Self.allKeys) { key, chosen in
                    KeyPill(key, chosen: chosen)
                }
            }
            if railsOnScreen, results.facets.contains(.tuneType) {
                facetRail(.tuneType, all: Self.allTypes) { type, chosen in
                    ChoiceCapsuleLabel(text: type, chosen: chosen)
                }
            }
            let set = Self.setFilters(filters, railsOnScreen: railsOnScreen)
            if !set.isEmpty {
                FlowLayout(spacing: 8, lineSpacing: 0) {
                    ForEach(set) { filter in
                        RemoveFilterCapsule(label: filter.label) { onChange(filter.remove) }
                    }
                }
                .padding(.horizontal, Self.inset)
            }
        }
    }

    /// A facet's rail: All, then each value, the chosen one filled. Pressing the chosen value
    /// clears the filter, as an optional field does.
    private func facetRail(
        _ facet: CatalogFacet, all: String, chip: @escaping (String, Bool) -> some View
    ) -> some View {
        let set = filters[facet]
        return Rail(chosen: set ?? Self.allID, inset: Self.inset) {
            ChoiceCapsule(chosen: set == nil) {
                onChange { $0[facet] = nil }
            } label: {
                Text(all)
            }
            .id(Self.allID)
            ForEach(results.choices(facet), id: \.self) { value in
                let chosen = set == value
                Button {
                    onChange { $0[facet] = chosen ? nil : value }
                } label: {
                    chip(value, chosen)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(chosen ? .isSelected : [])
                .id(value)
            }
        }
        .sensoryFeedback(.selection, trigger: set)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(facet.label)
    }
}

/// A capsule's look without its button, for a chip whose press a rail handles.
private struct ChoiceCapsuleLabel: View {
    let text: String
    let chosen: Bool

    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 32

    var body: some View {
        Text(text)
            .font(.subheadline)
            .lineLimit(1)
            .foregroundStyle(chosen ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .background(chosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
    }
}

/// The toolbar control that opens the filter sheet. It shows and says the count of set sheet
/// filters, since filters persist and a stale one must announce itself.
struct CatalogFiltersButton: View {
    nonisolated static let filters = "Filters"
    static let systemImage = "line.3.horizontal.decrease"

    /// The spoken name, with the count once one is set: "Filters, 2 set".
    nonisolated static func name(setCount: Int) -> String {
        setCount > 0 ? "\(filters), \(setCount) set" : filters
    }

    let setCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: Self.systemImage)
                    .symbolVariant(setCount > 0 ? .circle.fill : .circle)
                if setCount > 0 {
                    Text(setCount, format: .number)
                        .monospacedDigit()
                }
            }
        }
        .accessibilityLabel(Self.name(setCount: setCount))
        .help(Self.name(setCount: setCount))
    }
}

/// A set filter as a filled capsule named for its value, which removes the filter when pressed.
private struct RemoveFilterCapsule: View {
    let label: String
    let action: () -> Void

    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 32

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label)
                    .lineLimit(1)
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
            }
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(minHeight: height)
            .background(.tint, in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(CatalogFilterBar.removeFilter) \(label)")
    }
}
