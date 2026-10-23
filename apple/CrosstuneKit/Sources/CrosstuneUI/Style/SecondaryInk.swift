import SwiftUI

extension ShapeStyle where Self == AnyShapeStyle {
    /// Secondary text and glyphs in a shared view: `Palette.inkSecondary`, which holds 4.5:1 on
    /// every ground where the system's translucent secondary does not. It turns white on an
    /// emphasized selection's accent fill.
    static var inkSecondary: AnyShapeStyle { AnyShapeStyle(SecondaryInk()) }

    /// The quietest glyphs and prompts in a shared view. A lighter ink falls under the contrast
    /// floor, so it is `inkSecondary`.
    static var inkTertiary: AnyShapeStyle { inkSecondary }
}

/// `inkSecondary`, turning white where an emphasized selection raises the background, as the
/// system's secondary does. On the Mac it takes full ink on a selection that is not emphasized,
/// whose gray fill is too light for secondary ink to hold 4.5:1.
struct SecondaryInk: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        Palette.color(Self.token(in: environment))
    }

    static func token(in environment: EnvironmentValues) -> Palette.Token {
        #if os(macOS)
            let rowSelected = environment.macRowSelected
        #else
            let rowSelected = false
        #endif
        return token(emphasized: environment.backgroundProminence == .increased, rowSelected: rowSelected)
    }

    /// Secondary ink at rest, white on an emphasized selection's accent fill, and ink on an
    /// inactive window's or an unfocused list's gray selection.
    nonisolated static func token(emphasized: Bool, rowSelected: Bool) -> Palette.Token {
        if emphasized { return .onAccentFill }
        return rowSelected ? .ink : .inkSecondary
    }
}

#if os(macOS)
    extension EnvironmentValues {
        /// Whether the list row this view sits in is selected. A selection that is not emphasized
        /// leaves `backgroundProminence` standard, so a row says so itself.
        @Entry var macRowSelected = false
    }

    extension View {
        /// Marks a list row as selected, so its secondary ink holds contrast on a gray selection
        /// the list does not report.
        func macRowSelected(_ isSelected: Bool) -> some View {
            environment(\.macRowSelected, isSelected)
        }
    }
#endif
