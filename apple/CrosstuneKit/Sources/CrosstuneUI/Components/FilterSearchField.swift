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
