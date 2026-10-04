import SwiftUI

/// The filters on the catalog screen, under the search field: the status rail, a rail each for
/// key and type while the catalog holds them, then a removable capsule for each filter the sheet
/// set.
struct CatalogFilterBar: View {
    nonisolated static let archivedShown = "Archived shown"
    nonisolated static let unheardShown = "Unheard"
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
        if filters.unheard {
            set.append(SetFilter(id: "unheard", label: unheardShown) { $0.unheard = false })
        }
        if let missing = filters.missing {
            set.append(
                SetFilter(id: "missing", label: "\(CatalogFilterSheet.missing) \(missing.label)") { $0.missing = nil })
        }
        return set
    }

    let results: CatalogResults
    let errors: [String]
    let onChange: (@escaping @Sendable (inout CatalogFilters) -> Void) -> Void

    /// The space before a rail's first chip, matching the list's own margin.
    private static let inset: CGFloat = 16

    /// The bar's controls stay at the default text size, since larger chips push their labels off
    /// the screen and make the rails hard to use.
    private static let textSize = DynamicTypeSize.large
    private static let spacing = Spacing(textSize)

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var filters: CatalogFilters { results.filters }

    /// Whether the key and type rails show here. At the accessibility text sizes they move into
    /// the filter sheet, since the rails would push the tunes off the first screen.
    static func railsOnScreen(_ size: DynamicTypeSize) -> Bool {
        !size.isAccessibilitySize
    }

    var body: some View {
        let spacing = Self.spacing
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            controls
                .dynamicTypeSize(Self.textSize)
            ForEach(errors, id: \.self) { error in
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, Self.inset)
            }
        }
        // The list cell takes no touches past its bounds, so the chips' tap targets need room.
        .padding(.top, max(spacing.filterBarPadding, tapOutset(visibleHeight: defaultChipHeight)))
        .padding(.bottom, max(spacing.filterBarBottom, tapOutset(visibleHeight: defaultChipHeight)))
    }

    @ViewBuilder private var controls: some View {
        let railsOnScreen = Self.railsOnScreen(dynamicTypeSize)
        let spacing = Self.spacing
        // 12 between lines keeps neighboring chips' 44 point targets apart.
        VStack(alignment: .leading, spacing: spacing(12)) {
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
                    if key == CatalogFilters.noKey {
                        ChoiceCapsuleLabel(text: "?", chosen: chosen)
                    } else {
                        KeyPill(key, chosen: chosen)
                    }
                }
            }
            if railsOnScreen, results.facets.contains(.tuneType) {
                facetRail(.tuneType, all: Self.allTypes) { type, chosen in
                    ChoiceCapsuleLabel(text: type, chosen: chosen)
                }
            }
            let set = Self.setFilters(filters, railsOnScreen: railsOnScreen)
            if !set.isEmpty {
                FlowLayout(spacing: spacing.railGap, lineSpacing: spacing(12)) {
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
        _ facet: CatalogFacet, all: String, @ViewBuilder chip: @escaping (String, Bool) -> some View
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
                .accessibilityLabel(facet.valueLabel(value))
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
    @Environment(\.spacing) private var spacing

    var body: some View {
        Text(text)
            .font(.subheadline)
            .lineLimit(1)
            .foregroundStyle(chosen ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, spacing(14))
            .padding(.vertical, spacing.chipVertical)
            .background(chosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
            .tapTarget()
    }
}
