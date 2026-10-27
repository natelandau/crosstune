import SwiftUI

extension ShapeStyle where Self == AnyShapeStyle {
    /// Body text and glyphs in a shared view: `Palette.textPrimary`, turning white on an
    /// emphasized selection's accent fill, as the system's primary does.
    package static var textPrimary: AnyShapeStyle { AnyShapeStyle(PrimaryText()) }

    /// Secondary text and glyphs in a shared view: `Palette.textSecondary`, which holds 4.5:1 on
    /// every background where the system's translucent secondary does not. It turns white on an
    /// emphasized selection's accent fill.
    package static var textSecondary: AnyShapeStyle { AnyShapeStyle(SecondaryText()) }
}

/// `textPrimary`, turning white where an emphasized selection raises the background.
package struct PrimaryText: ShapeStyle {
    package func resolve(in environment: EnvironmentValues) -> Color {
        Palette.color(environment.backgroundProminence == .increased ? .onAccentFill : .textPrimary)
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
/// accent track. The sections stay as written: rebuilding them (`ForEach(sections:)`) drops a
/// row's own list modifiers, such as the open Settings page's `field` background.
package struct GroupedForm<Content: View>: View {
    @ViewBuilder package let content: Content

    package init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    package var body: some View {
        Form {
            Group { content }
                .groupedSurface()
                .environment(\.onGroupedSurface, true)
        }
        .formStyle(.grouped)
        .toggleStyle(.accentSwitch)
        .groupedBackground()
    }
}
