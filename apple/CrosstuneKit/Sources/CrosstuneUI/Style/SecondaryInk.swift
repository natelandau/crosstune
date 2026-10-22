import SwiftUI

extension ShapeStyle where Self == AnyShapeStyle {
    /// Secondary text and glyphs in a shared view. On the Mac it is `inkSecondary`, which holds
    /// 4.5:1 on every Mac fill where the system's translucent secondary does not, and white on a
    /// key window's selection; on iPhone and iPad it is the system's hierarchical secondary.
    static var inkSecondary: AnyShapeStyle {
        #if os(macOS)
            AnyShapeStyle(MacSecondaryInk())
        #else
            AnyShapeStyle(.secondary)
        #endif
    }

    /// The quietest glyphs and prompts in a shared view: `inkSecondary` on the Mac, since a
    /// lighter ink falls under the Mac's contrast floor, and the system's tertiary elsewhere.
    static var inkTertiary: AnyShapeStyle {
        #if os(macOS)
            AnyShapeStyle(MacSecondaryInk())
        #else
            AnyShapeStyle(.tertiary)
        #endif
    }
}

#if os(macOS)
    /// `inkSecondary`, turning white where a key window's selection raises the background, as the
    /// system's secondary does, and full ink on a selection that is not emphasized, whose gray
    /// fill is too light for secondary ink to hold 4.5:1.
    struct MacSecondaryInk: ShapeStyle {
        func resolve(in environment: EnvironmentValues) -> Color {
            MacPalette.color(
                Self.token(
                    emphasized: environment.backgroundProminence == .increased,
                    rowSelected: environment.macRowSelected))
        }

        /// Secondary ink at rest, white on an emphasized selection's accent fill, and ink on an
        /// inactive window's or an unfocused list's gray selection.
        nonisolated static func token(emphasized: Bool, rowSelected: Bool) -> MacPalette.Token {
            if emphasized { return .onAccentFill }
            return rowSelected ? .ink : .inkSecondary
        }
    }

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
