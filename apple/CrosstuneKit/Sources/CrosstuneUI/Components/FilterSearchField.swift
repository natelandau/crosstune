import SwiftUI

/// A screen's search field, with the filters control at its trailing edge. It stands in for the
/// system search field, which takes no accessory.
struct FilterSearchField: View {
    nonisolated static let clearSearch = "Clear search"

    let prompt: String
    @Binding var query: String
    let isFocused: FocusState<Bool>.Binding
    /// The count of set sheet filters, or nil to leave the filters control out.
    let filterCount: Int?
    var filtersGate: FiltersGate = .enabled
    let onSubmit: () -> Void
    let onFilters: () -> Void

    #if os(iOS)
        @ScaledMetric(relativeTo: .body) private var height: CGFloat = 44
        private let hitTarget: CGFloat = 44
    #else
        // The height of a large control, which the buttons beside it are.
        @ScaledMetric(relativeTo: .body) private var height: CGFloat = 32
        private let hitTarget: CGFloat = 24
    #endif

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(prompt, text: $query)
                .focused(isFocused)
                .submitLabel(.search)
                .accessibilityAddTraits(.isSearchField)
                .onSubmit(onSubmit)
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                #else
                    .textFieldStyle(.plain)
                #endif
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
            }
            if let filterCount {
                FiltersButton(setCount: filterCount, gate: filtersGate, action: onFilters)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, filterCount == nil ? 14 : 4)
        .frame(minHeight: height)
        .modifier(GlassCapsule())
    }
}

/// Whether a screen's filters control can open its sheet, and when it cannot, why, for
/// assistive technology. A nil reason leaves the disabled control silent.
enum FiltersGate: Equatable, Sendable {
    case enabled
    case disabled(reason: String?)
}

/// The control that opens a screen's filter sheet, at the trailing edge of its search field. It
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
    var gate: FiltersGate = .enabled
    let action: () -> Void

    private var reason: String? {
        if case .disabled(let reason) = gate { reason } else { nil }
    }

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
            #if os(iOS)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
            #endif
        }
        .disabled(gate != .enabled)
        .accessibilityLabel(Self.name(setCount: setCount))
        .accessibilityHint(reason ?? "")
        .help(reason ?? Self.name(setCount: setCount))
    }
}

/// A set filter as a filled capsule named for its value, which removes the filter when pressed.
struct RemoveFilterCapsule: View {
    nonisolated static let removeFilter = "Remove filter"

    /// The capsule's spoken name: "Remove filter Old-time".
    nonisolated static func name(_ label: String) -> String {
        "\(removeFilter) \(label)"
    }

    let label: String
    let action: () -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        Button(action: action) {
            HStack(spacing: spacing(6)) {
                Text(label)
                    .lineLimit(1)
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
            }
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding(.horizontal, spacing(12))
            .padding(.vertical, spacing.chipVertical)
            .background(.tint, in: .capsule)
            .tapTarget()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.name(label))
    }
}
