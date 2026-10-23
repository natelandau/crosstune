import SwiftUI

extension View {
    /// Tints a list that takes a selection on iPhone and iPad, where the system fills a focused
    /// selection and the edit-mode checkmarks with the tint. The Mac draws its own.
    func listSelectionTint() -> some View {
        #if os(macOS)
            self
        #else
            tint(Palette.listSelection)
        #endif
    }

    /// An on switch in the one color every platform shares, scoped to the switch so nothing
    /// else in the view takes it.
    func switchOnTint() -> some View {
        tint(Palette.switchOn)
    }
}

/// A sheet's confirm button in its toolbar, on the accent fill. Every confirm item is one of
/// these, never a bare `ToolbarItem(placement: .confirmationAction)`. On iPhone and iPad it
/// draws the accent prominent style, which sets the label white on the fill rather than leaving
/// it to the system. The Mac keeps its own toolbar button.
struct ConfirmToolbarItem<Content: View>: ToolbarContent {
    @ViewBuilder let content: Content

    var body: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            #if os(macOS)
                content
            #else
                content.buttonStyle(.accentGlassProminent)
            #endif
        }
    }
}

/// The system switch in the shared on color. A grouped form draws every toggle with it.
struct HarborSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration)
            .toggleStyle(.switch)
            .switchOnTint()
    }
}

extension ToggleStyle where Self == HarborSwitchStyle {
    static var harborSwitch: Self { HarborSwitchStyle() }
}
