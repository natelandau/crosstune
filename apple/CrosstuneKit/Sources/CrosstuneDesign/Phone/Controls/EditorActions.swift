import SwiftUI

extension View {
    /// The actions that end a full-screen editor. On iPhone and iPad: Cancel and Save in the
    /// navigation toolbar. On the Mac: an action bar along the editor's bottom edge, with
    /// `leading` at its start, then Cancel, which Escape presses, and Save, the one Filled
    /// button. Return presses Save through `editorSaveShortcut`, which `save` puts on its own
    /// button, so a dialog that Save presents never takes Return. The toolbar has no place for
    /// `leading`, so iPhone and iPad leave it out.
    package func editorActions<Cancel: View, Save: View, Leading: View>(
        @ViewBuilder cancel: () -> Cancel, @ViewBuilder save: () -> Save,
        @ViewBuilder leading: () -> Leading = { EmptyView() }
    ) -> some View {
        modifier(EditorActions(cancel: cancel(), save: save(), leading: leading()))
    }

    /// The main action in an editor's body. On iPhone and iPad, the full-width Large Filled
    /// button. On the Mac, where Save in the action bar is the one Filled button, a Tinted button
    /// at its natural width.
    package func editorMainAction() -> some View {
        #if os(macOS)
            buttonStyle(.tinted).controlSize(.regular)
        #else
            buttonStyle(.accentProminent).controlSize(.large)
        #endif
    }
}

extension EnvironmentValues {
    /// The key that presses an editor's Save, which the Save view applies to its button alone.
    /// Set on the Mac by ``View/editorActions(cancel:save:leading:)``; nil elsewhere.
    @Entry package var editorSaveShortcut: KeyboardShortcut? = nil
}

private struct EditorActions<Cancel: View, Save: View, Leading: View>: ViewModifier {
    let cancel: Cancel
    let save: Save
    let leading: Leading

    func body(content: Content) -> some View {
        #if os(macOS)
            // The empty pane bar keeps the editor's content at the height every column starts at.
            content
                .paneBar {}
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    MacActionBarBand {
                        leading
                    } trailing: {
                        cancel
                            .buttonStyle(.tinted)
                            .keyboardShortcut(.cancelAction)
                        save
                            .buttonStyle(.filled)
                            .environment(\.editorSaveShortcut, .defaultAction)
                    }
                    .controlSize(.regular)
                }
        #else
            content.toolbar {
                ToolbarItem(placement: .cancellationAction) { cancel }
                ConfirmToolbarItem { save }
            }
        #endif
    }
}
