import SwiftUI

extension View {
    /// Tints a list that takes a selection on iPhone and iPad, where the system fills a focused
    /// selection and the edit-mode checkmarks with the tint. The Mac draws its own.
    package func accentSelectionTint() -> some View {
        #if os(macOS)
            self
        #else
            tint(Palette.accentSelection)
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
    /// The accent switch on iPhone and iPad. The Mac keeps the toggle style around it, a checkbox
    /// outside a form.
    package func phoneAccentSwitch() -> some View {
        #if os(macOS)
            self
        #else
            toggleStyle(.accentSwitch)
        #endif
    }
}
