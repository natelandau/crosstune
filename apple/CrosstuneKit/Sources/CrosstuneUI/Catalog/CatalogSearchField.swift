import SwiftUI

/// The catalog's search field, with the filters control at its trailing edge.
/// It stands in for the system search field, which takes no accessory.
struct CatalogSearchField: View {
    nonisolated static let clearSearch = "Clear search"

    @Binding var query: String
    let isFocused: FocusState<Bool>.Binding
    /// The count of set sheet filters, or nil to leave the filters control out.
    let filterCount: Int?
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
            TextField(CatalogScreen.searchPrompt, text: $query)
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
                CatalogFiltersButton(setCount: filterCount, action: onFilters)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, filterCount == nil ? 14 : 4)
        .frame(minHeight: height)
        .modifier(GlassCapsule())
    }
}
