import SwiftUI

/// A grouped form whose rows are chosen as a list's selection, for a column of rows that each
/// open a page beside it, as the iPad Settings root does. A row takes part with
/// `groupedSelectionRow(_:selection:)`, and the chosen row fills with the accent selection.
package struct GroupedSelectionForm<SelectionValue: Hashable, Content: View>: View {
    @Binding private var selection: SelectionValue?
    private let content: Content

    package init(selection: Binding<SelectionValue?>, @ViewBuilder content: () -> Content) {
        _selection = selection
        self.content = content()
    }

    package var body: some View {
        List(selection: $selection) {
            Group { content }.groupedFormRows()
        }
        #if os(macOS)
            .listStyle(.inset)
        #else
            .listStyle(.insetGrouped)
        #endif
        .groupedFormList()
        .accentSelectionTint()
    }
}

/// A selection row's identity: its value, so no two rows share one, and the appearance, so a row
/// is rebuilt when the appearance changes.
package struct GroupedSelectionRowIdentity<Value: Hashable>: Hashable {
    package let value: Value
    package let scheme: ColorScheme

    package init(value: Value, scheme: ColorScheme) {
        self.value = value
        self.scheme = scheme
    }
}

extension View {
    /// A row of a ``GroupedSelectionForm`` that stands for `value`, filled with the accent
    /// selection under white text while `selection` is `value`. The grouped surface under every
    /// row replaces the system's own selection fill, so the chosen row draws its own.
    package func groupedSelectionRow<Value: Hashable>(_ value: Value, selection: Value?) -> some View {
        modifier(GroupedSelectionRow(value: value, isSelected: value == selection))
    }
}

/// The roles a ``GroupedSelectionForm`` row draws with.
package enum GroupedSelectionRowColors {
    package static func background(isSelected: Bool) -> Palette.Token {
        isSelected ? .accentSelection : .groupedSurface
    }
}

private struct GroupedSelectionRow<Value: Hashable>: ViewModifier {
    let value: Value
    let isSelected: Bool

    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        #if os(macOS)
            content.tag(value)
        #else
            // A list raises the prominence only on a selection it emphasizes, so the chosen row
            // raises it itself, and every text role inside the row, the system's hierarchical
            // levels included, turns white. One branch for both states keeps the row's identity,
            // so its state and tasks survive a change of selection.
            content
                .groupedRowText()
                .environment(\.backgroundProminence, isSelected ? .increased : .standard)
                .tag(value)
                .listRowBackground(Palette.color(GroupedSelectionRowColors.background(isSelected: isSelected)))
                // A row's background keeps the appearance it first drew in, so the row is rebuilt
                // when the appearance changes. Each row keeps an identity of its own: a list lays
                // its rows out by identity, and rows that share one draw as copies of the first.
                .id(GroupedSelectionRowIdentity(value: value, scheme: colorScheme))
        #endif
    }
}

extension View {
    /// A grouped row's text: the text roles at each hierarchical level, white on an emphasized
    /// selection, so a row reads the same in a pushing list and a selection form.
    package func groupedRowText() -> some View {
        foregroundStyle(.textPrimary, .textSecondary, .textTertiary)
    }
}

#Preview("Grouped selection form") {
    @Previewable @State var chosen: String? = "Appearance"
    GroupedSelectionForm(selection: $chosen) {
        Section {
            ForEach(["Tunes", "Appearance", "About"], id: \.self) { page in
                Text(page).groupedSelectionRow(page, selection: chosen)
            }
        }
    }
}
