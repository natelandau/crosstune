import CrosstuneUI
import SwiftUI

/// The menu bar's app commands. Each one runs whatever the focused screen or shell publishes,
/// and is disabled while nothing does.
struct AppCommands: Commands {
    /// The main window's scene, which New Window opens another of.
    static let mainWindow = "main"
    static let newWindow = "New Window"

    @FocusedValue(\.newTuneAction) private var newTune
    @FocusedValue(\.newListAction) private var newList
    @FocusedValue(\.recordAction) private var record
    @FocusedValue(\.syncNowAction) private var syncNow
    @FocusedValue(\.findAction) private var find

    var body: some Commands {
        // Command-N is New tune, so New Window keeps its place with Option.
        CommandGroup(replacing: .newItem) {
            item(MenuCommand.newTune, newTune)
                .keyboardShortcut("n")
            item(MenuCommand.newList, newList)
                .keyboardShortcut("n", modifiers: [.command, .shift])
            NewWindowButton()
                .keyboardShortcut("n", modifiers: [.command, .option])
        }
        CommandGroup(after: .newItem) {
            Divider()
            item(RecordControl.title, record)
                .keyboardShortcut("r")
            // Command-R is Record, so Sync takes Option.
            item(MenuCommand.syncNow, syncNow)
                .keyboardShortcut("r", modifiers: [.command, .option])
        }
        #if os(iOS)
            // iPadOS has no system Find for a screen's search, so Command-F runs the focused
            // screen's `findAction`. On the Mac the system Edit > Find items stay, and each
            // screen's toolbar `.searchable` field answers them, with `.searchFocused(_:)` where
            // a screen moves focus itself.
            CommandGroup(after: .textEditing) {
                item(MenuCommand.find, find)
                    .keyboardShortcut("f")
            }
        #endif
    }

    private func item(_ title: String, _ action: MenuAction?) -> some View {
        Button(title) { action?() }
            .disabled(action == nil)
    }
}

private struct NewWindowButton: View {
    @Environment(\.openWindow) private var openWindow
    @Environment(\.supportsMultipleWindows) private var supportsMultipleWindows

    var body: some View {
        if supportsMultipleWindows {
            Button(AppCommands.newWindow) { openWindow(id: AppCommands.mainWindow) }
        }
    }
}
