import CrosstuneCommands
import CrosstuneStore
import SwiftUI

extension EnvironmentValues {
    /// The signed-in musician's catalog, which every screen reads. Nil outside the shell.
    @Entry public var store: CrosstuneStore?
    /// The writes a screen makes against ``store``. Nil outside the shell.
    @Entry public var commands: CrosstuneCommands.Commands?
    /// The tune the split view's detail column shows, by id. Nil on iPhone, where a screen
    /// pushes the tune onto its own stack instead.
    @Entry public var detailTune: Binding<String?>?
    /// The tune a tab's screen pushes on iPhone, kept by the shell so a switch to the split view
    /// shows it in the detail column and a switch back pushes it again. Nil in the split view and
    /// on a screen pushed over the tab's own.
    @Entry var stackTune: Binding<String?>?
}
