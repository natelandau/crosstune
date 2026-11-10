import SwiftUI

extension ShapeStyle where Self == AnyShapeStyle {
    /// Body text and glyphs in a shared view: `Palette.textPrimary`, turning white on an
    /// emphasized selection's accent fill, as the system's primary does.
    package static var textPrimary: AnyShapeStyle { AnyShapeStyle(SelectionAwareColor(Palette.textPrimary)) }

    /// Secondary text and glyphs in a shared view: `Palette.textSecondary`, which holds 4.5:1 on
    /// every background where the system's translucent secondary does not. It turns white on an
    /// emphasized selection's accent fill.
    package static var textSecondary: AnyShapeStyle { AnyShapeStyle(SecondaryText()) }

    /// Tertiary text and glyphs in a shared view: `Palette.textTertiary`, turning white on an
    /// emphasized selection's accent fill.
    package static var textTertiary: AnyShapeStyle { AnyShapeStyle(SelectionAwareColor(Palette.textTertiary)) }
}

extension ShapeStyle where Self == SelectionAwareColor {
    /// `color` at rest, white on an emphasized selection's accent fill, for a fixed color such as
    /// a status tone that would not read on the fill.
    package static func selectionAware(_ color: Color) -> SelectionAwareColor { SelectionAwareColor(color) }
}

/// A fixed color that turns white where an emphasized selection raises the background.
package struct SelectionAwareColor: ShapeStyle {
    package let color: Color

    package init(_ color: Color) {
        self.color = color
    }

    package func resolve(in environment: EnvironmentValues) -> Color {
        environment.backgroundProminence == .increased ? Palette.onAccentFill : color
    }
}

/// `textSecondary`, turning white where an emphasized selection raises the background, as the
/// system's secondary does. On the Mac it takes the primary text color on a selection that is
/// not emphasized, whose gray fill is too light for secondary text to hold 4.5:1.
package struct SecondaryText: ShapeStyle {
    package func resolve(in environment: EnvironmentValues) -> Color {
        Palette.color(Self.token(in: environment))
    }

    package static func token(in environment: EnvironmentValues) -> Palette.Token {
        #if os(macOS)
            let rowSelected = environment.macRowSelected
        #else
            let rowSelected = false
        #endif
        return token(emphasized: environment.backgroundProminence == .increased, rowSelected: rowSelected)
    }

    /// Secondary text at rest, white on an emphasized selection's accent fill, and the primary
    /// text color on an inactive window's or an unfocused list's gray selection.
    package nonisolated static func token(emphasized: Bool, rowSelected: Bool) -> Palette.Token {
        if emphasized { return .onAccentFill }
        return rowSelected ? .textPrimary : .textSecondary
    }
}

#if os(macOS)
    extension EnvironmentValues {
        /// Whether the list row this view sits in is selected. A selection that is not emphasized
        /// leaves `backgroundProminence` standard, so a row says so itself.
        @Entry package var macRowSelected = false
    }

    extension View {
        /// Marks a list row as selected, so its secondary text holds contrast on a gray selection
        /// the list does not report.
        package func macRowSelected(_ isSelected: Bool) -> some View {
            environment(\.macRowSelected, isSelected)
        }
    }
#endif

extension View {
    /// A list or scroll view on the page background rather than the system's white or black.
    /// The Mac draws its own backgrounds, so it keeps this view as is.
    package func pageBackground() -> some View {
        #if os(macOS)
            self
        #else
            scrollContentBackground(.hidden).background { Palette.pageBackground.ignoresSafeArea() }
        #endif
    }

    /// A grouped form's page. ``GroupedForm`` sets the cards, so a form is built with it.
    fileprivate func groupedBackground() -> some View {
        #if os(macOS)
            self
        #else
            scrollContentBackground(.hidden).background { Palette.groupedBackground.ignoresSafeArea() }
        #endif
    }

    /// Rows, or the sections that hold them, on the grouped surface rather than the system's.
    package func groupedSurface() -> some View {
        #if os(macOS)
            self
        #else
            listRowBackground(Palette.groupedSurface)
        #endif
    }
}

/// A grouped `Form`: the page takes ``Palette/groupedBackground`` and every row, in any section,
/// takes ``Palette/groupedSurface`` unless it sets its own background. Its switches take the
/// accent track, and its buttons the accent, since the app's tint is primary text; on the Mac
/// its buttons are Small Tinted buttons. The sections stay as written: rebuilding them
/// (`ForEach(sections:)`) drops a row's own list modifiers, such as the open Settings page's
/// `field` background.
package struct GroupedForm<Content: View>: View {
    @ViewBuilder package let content: Content

    package init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    package var body: some View {
        Form {
            Group { content }.groupedFormRows()
        }
        .formStyle(.grouped)
        .groupedFormList()
    }
}

extension View {
    /// A grouped form's rows: the grouped surface under each, and the context its controls read.
    /// Every grouped form, ``GroupedForm`` and ``GroupedSelectionForm``, applies it to its content.
    package func groupedFormRows() -> some View {
        #if os(macOS)
            // A Mac form's action is a button in its row, never the row, so its spinner and check
            // replace its label as on any button.
            environment(\.onGroupedSurface, true)
        #else
            groupedSurface()
                .environment(\.onGroupedSurface, true)
                .environment(\.asyncButtonIsRow, true)
        #endif
    }

    /// A grouped form's list: accent switches and buttons on the grouped background, and on the
    /// Mac its actions as Small Tinted buttons. Every grouped form applies it to its `Form` or
    /// `List`.
    package func groupedFormList() -> some View {
        toggleStyle(.accentSwitch)
            #if os(macOS)
                .buttonStyle(MacFormActionStyle())
            #else
                .buttonStyle(.accentWords)
            #endif
            .groupedBackground()
    }
}

#if os(macOS)
    /// An action in a Mac form row: a Small Tinted button, the destructive one for a destructive
    /// role. A button that sets its own style keeps it.
    private struct MacFormActionStyle: PrimitiveButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            Button(configuration)
                .buttonStyle(.tinted)
                .controlSize(.small)
        }
    }
#endif

/// The system's own button in the accent. A button that sets its own style keeps it. On the
/// Mac it draws the Mac's Text button.
package struct AccentWordsButtonStyle: PrimitiveButtonStyle {
    package func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            Button(configuration).buttonStyle(.macPlain)
        #else
            accentWords(configuration)
        #endif
    }

    private func accentWords(_ configuration: Configuration) -> some View {
        // `.automatic` stops this style from applying to the button it makes.
        Button(configuration)
            .buttonStyle(.automatic)
            .tint(Palette.accent)
    }
}

extension PrimitiveButtonStyle where Self == AccentWordsButtonStyle {
    package static var accentWords: Self { AccentWordsButtonStyle() }
}
