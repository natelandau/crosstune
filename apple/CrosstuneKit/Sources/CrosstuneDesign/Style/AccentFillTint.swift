import SwiftUI

extension View {
    /// Tints a list that takes a selection on iPhone and iPad, where the system fills a focused
    /// selection and the edit-mode checkmarks with the tint. The Mac draws its own.
    package func accentSelectionTint() -> some View {
        #if os(macOS)
            self
        #else
            modifier(AccentSelection())
        #endif
    }

    /// An on switch's track in the one color every platform shares, scoped to the switch so
    /// nothing else in the view takes it.
    package func accentTrackTint() -> some View {
        tint(Palette.accentTrack)
    }
}

/// A sheet's confirm button in its toolbar. Every confirm item is one of these, never a bare
/// `ToolbarItem(placement: .confirmationAction)`.
///
/// On iPhone and iPad it draws the accent glass prominent style in semibold. The Mac keeps its
/// own toolbar button.
package struct ConfirmToolbarItem<Content: View>: ToolbarContent {
    @ViewBuilder package let content: Content

    package init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    package var body: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            #if os(macOS)
                content
            #else
                content.fontWeight(.semibold).buttonStyle(.accentGlassProminent)
            #endif
        }
    }
}

/// The system switch on the accent track. A grouped form draws every toggle with it.
package struct AccentSwitchStyle: ToggleStyle {
    package func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration)
            .toggleStyle(.switch)
            .accentTrackTint()
    }
}

extension ToggleStyle where Self == AccentSwitchStyle {
    package static var accentSwitch: Self { AccentSwitchStyle() }
}

extension View {
    /// A setting's switch: the accent switch on iPhone and iPad, and on the Mac the small switch
    /// at the end of its label's row.
    package func settingSwitch() -> some View {
        #if os(macOS)
            toggleStyle(.macFormSwitch)
        #else
            toggleStyle(.accentSwitch)
        #endif
    }
}

#if !os(macOS)
    private struct AccentSelection: ViewModifier {
        @FocusState private var isFocused: Bool

        func body(content: Content) -> some View {
            content
                .tint(Palette.accentSelection)
                .focused($isFocused)
                .environment(\.listSelectionEmphasized, isFocused)
        }
    }

    extension View {
        /// Marks a selected row prominent while its list has the keyboard focus, when the list
        /// fills every selected row with the tint, so the row's secondary text and glyphs read on
        /// the fill.
        package func selectedRowProminence(isSelected: Bool) -> some View {
            modifier(SelectedRowProminence(isSelected: isSelected))
        }
    }

    private struct SelectedRowProminence: ViewModifier {
        let isSelected: Bool

        @Environment(\.listSelectionEmphasized) private var emphasized

        func body(content: Content) -> some View {
            content.transformEnvironment(\.backgroundProminence) { prominence in
                if isSelected && emphasized { prominence = .increased }
            }
        }
    }
#endif

extension EnvironmentValues {
    /// Whether the list around this row has the keyboard focus, which is when it fills its
    /// selection with the tint.
    @Entry package var listSelectionEmphasized = false
}
