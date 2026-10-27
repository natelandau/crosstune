import CrosstuneAnalytics
import SwiftUI

#if os(macOS)
    /// The Mac's one search field, flat on the field fill, with the filters control at its
    /// trailing edge. It replaces the system search field, which takes no accessory and
    /// draws apart from the app's other fields.
    struct FilterSearchField: View {
        nonisolated static let clearSearch = "Clear search"

        let prompt: String
        @Binding var query: String
        let isFocused: FocusState<Bool>.Binding
        /// The count of set sheet filters, or nil to leave the filters control out.
        let filterCount: Int?
        /// Whether the filters are disabled, such as while a selection lasts or with nothing to
        /// filter.
        var filtersDisabled = false
        let onSubmit: () -> Void
        var onFilters: () -> Void = {}

        private let hitTarget: CGFloat = 24

        /// Escape's first press empties a search that holds text, and only a second one reaches
        /// the sheet or column, so a picker never closes on the musician's typing. Returns
        /// whether it emptied the search.
        @MainActor @discardableResult
        static func clearOnEscape(_ query: Binding<String>) -> Bool {
            guard !query.wrappedValue.isEmpty else { return false }
            query.wrappedValue = ""
            return true
        }

        /// A sheet's Escape when a search shows in it: empty the search first, then `close`.
        @MainActor
        static func escape(clearing query: Binding<String>, otherwise close: () -> Void) {
            if !clearOnEscape(query) { close() }
        }

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
                TextField(prompt, text: $query)
                    .contentMask()
                    .focused(isFocused)
                    .submitLabel(.search)
                    .accessibilityAddTraits(.isSearchField)
                    .onSubmit(onSubmit)
                    .onKeyPress(.escape) { Self.clearOnEscape($query) ? .handled : .ignored }
                    .textFieldStyle(.plain)
                    .focusEffectDisabled()
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Palette.textSecondary)
                            .frame(minWidth: hitTarget, minHeight: hitTarget)
                            .contentShape(.rect)
                    }
                    // A borderless button tints its glyph with the accent, which a glyph at rest
                    // never takes.
                    .buttonStyle(.plain)
                    .accessibilityLabel(Self.clearSearch)
                    .help(Self.clearSearch)
                }
                if let filterCount {
                    FiltersButton(setCount: filterCount, action: onFilters)
                        .buttonStyle(SearchFiltersStyle(isSet: filterCount > 0))
                        .disabled(filtersDisabled)
                }
            }
            .font(MacStyle.body)
            .padding(.leading, 10)
            .padding(.trailing, filterCount == nil ? 10 : 5)
            // The pane bar's height, which the buttons beside it are.
            .frame(height: MacStyle.paneControlHeight)
            .background(container.controlColor, in: .rect(cornerRadius: MacFieldStyle.radius))
            .macControlEdge(container, scheme: scheme, cornerRadius: MacFieldStyle.radius)
            .macFocusRing(isFocused.wrappedValue, cornerRadius: MacFieldStyle.radius)
        }
    }

    /// The search field's filters control: a glyph in secondary text at rest, and once a filter
    /// is set, a set chip carrying the count, so a narrowed list reads from the field.
    struct SearchFiltersStyle: ButtonStyle {
        /// What the set chip's tint lands on. The field under it is too dark for the accent label
        /// to hold 4.5:1 through the tint, so the chip carries the column's page background, as the
        /// set tokens under the field do.
        static let chipBackground = Palette.Token.pageBackground

        let isSet: Bool

        func makeBody(configuration: Configuration) -> some View {
            SearchFiltersBody(configuration: configuration, isSet: isSet)
        }
    }

    private struct SearchFiltersBody: View {
        let configuration: ButtonStyle.Configuration
        let isSet: Bool

        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovered = false

        var body: some View {
            let emphasis: Double = configuration.isPressed || isHovered ? 1 : 0
            Group {
                if isSet {
                    configuration.label
                        .macChip(state: .set, size: .row, emphasis: emphasis)
                        .background(Palette.color(SearchFiltersStyle.chipBackground), in: .capsule)
                } else {
                    configuration.label
                        .foregroundStyle(isHovered ? Palette.textPrimary : Palette.textSecondary)
                        .frame(width: MacChip.Size.row.height + 4, height: MacChip.Size.row.height + 4)
                        .background {
                            RoundedRectangle(cornerRadius: 5).fill(Palette.hoverOverlay)
                                .opacity(emphasis)
                        }
                }
            }
            .frame(minHeight: 22)
            .contentShape(.rect)
            .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
            .onHover { isHovered = $0 }
        }
    }
#endif
