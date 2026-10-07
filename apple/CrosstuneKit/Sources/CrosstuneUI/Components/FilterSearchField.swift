import CrosstuneAnalytics
import SwiftUI

#if os(macOS)
    /// A screen's search field, with the filters control at its trailing edge. It stands in for
    /// the system search field, which takes no accessory.
    struct FilterSearchField: View {
        nonisolated static let clearSearch = "Clear search"

        let prompt: String
        @Binding var query: String
        let isFocused: FocusState<Bool>.Binding
        /// The count of set sheet filters, or nil to leave the filters control out.
        let filterCount: Int?
        let onSubmit: () -> Void
        let onFilters: () -> Void

        // The pane bar's height, which the buttons beside it are.
        @ScaledMetric(relativeTo: .body) private var height: CGFloat = MacStyle.paneControlHeight
        private let hitTarget: CGFloat = 24

        var body: some View {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(prompt, text: $query)
                    .contentMask()
                    .focused(isFocused)
                    .submitLabel(.search)
                    .accessibilityAddTraits(.isSearchField)
                    .onSubmit(onSubmit)
                    .textFieldStyle(.plain)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .frame(minWidth: hitTarget, minHeight: hitTarget)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Self.clearSearch)
                    .help(Self.clearSearch)
                }
                if let filterCount {
                    FiltersButton(setCount: filterCount, action: onFilters)
                        .buttonStyle(.borderless)
                }
            }
            .font(MacStyle.body)
            .padding(.leading, 10)
            .padding(.trailing, filterCount == nil ? 10 : 4)
            .frame(height: height)
            .macGlass(in: .capsule)
        }
    }
#endif

/// The control that opens a screen's filter sheet. It
/// shows and says the count of set sheet filters, since filters persist and a stale one must
/// announce itself.
struct FiltersButton: View {
    nonisolated static let filters = "Filters"
    static let systemImage = "line.3.horizontal.decrease"

    /// The spoken name, with the count once one is set: "Filters, 2 set".
    nonisolated static func name(setCount: Int) -> String {
        setCount > 0 ? "\(filters), \(setCount) set" : filters
    }

    let setCount: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: Self.systemImage)
                    .symbolVariant(setCount > 0 ? .circle.fill : .circle)
                if setCount > 0 {
                    Text(setCount, format: .number)
                        .monospacedDigit()
                        .contentTransition(
                            PhoneMotion.resolve(reduceMotion: reduceMotion).countTransition(value: Double(setCount)))
                }
            }
        }
        .phoneAnimation(value: setCount)
        .accessibilityLabel(Self.name(setCount: setCount))
        .help(Self.name(setCount: setCount))
    }
}

/// A set filter as a filled capsule named for its value, which removes the filter when pressed.
struct RemoveFilterCapsule: View {
    nonisolated static let removeFilter = "Remove filter"

    /// The capsule's spoken name: "Remove filter Old-time".
    nonisolated static func name(_ label: String) -> String {
        "\(removeFilter) \(label)"
    }

    /// How a token arrives: sliding in from the row's leading edge, fading as it does.
    static let insertion = AnyTransition.move(edge: .leading).combined(with: .opacity)

    let label: String
    let action: () -> Void

    @Environment(\.spacing) private var spacing
    @Environment(\.colorScheme) private var colorScheme
    #if os(iOS)
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #endif

    var body: some View {
        Button(action: action) {
            #if os(macOS)
                // A token in the filter row, worn as a set filter control is.
                HStack(spacing: 4) {
                    Text(label)
                        .contentMask()
                        .lineLimit(1)
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
                .font(MacStyle.body)
                .foregroundStyle(MacStyle.setLabel(colorScheme))
                .padding(.horizontal, 10)
                .frame(height: MacStyle.smallControlHeight)
                .background(MacStyle.setFill(colorScheme), in: .capsule)
                .contentShape(.capsule)
            #else
                HStack(spacing: spacing(6)) {
                    // A long label wraps at the accessibility sizes rather than truncating.
                    Text(label)
                        .contentMask()
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                }
                .font(.subheadline)
                .foregroundStyle(BrandStyle.setLabel(colorScheme))
                .padding(.horizontal, spacing(12))
                .padding(.vertical, spacing.chipVertical)
                .background(BrandStyle.setFill(colorScheme), in: .capsule)
                .tapTarget()
            #endif
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.name(label))
    }
}
