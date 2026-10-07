import CrosstuneUI
import SwiftUI

/// The menu bar's app commands. Each one runs whatever the focused screen or shell publishes,
/// and is disabled while nothing does. Each menu reads only its own commands, so a change to one,
/// such as play turning to pause, rebuilds that menu alone.
struct AppCommands: Commands {
    /// The main window's scene, which New Window opens another of.
    static let mainWindow = "main"
    static let newWindow = "New Window"

    var body: some Commands {
        FileCommands()
        ViewCommands()
        ControlsCommands()
        FindCommands()
    }
}

private struct FileCommands: Commands {
    @FocusedValue(\.newTuneAction) private var newTune
    @FocusedValue(\.newListAction) private var newList
    @FocusedValue(\.recordAction) private var record
    @FocusedValue(\.syncNowAction) private var syncNow

    var body: some Commands {
        // Command-N is New tune, so New Window keeps its place with Option.
        CommandGroup(replacing: .newItem) {
            MenuItem(title: MenuCommand.newTune, action: newTune)
                .keyboardShortcut("n")
            MenuItem(title: MenuCommand.newList, action: newList)
                .keyboardShortcut("n", modifiers: [.command, .shift])
            NewWindowButton()
                .keyboardShortcut("n", modifiers: [.command, .option])
        }
        CommandGroup(after: .newItem) {
            Divider()
            MenuItem(title: RecordControl.title, action: record)
                .keyboardShortcut("r")
            // Command-R is Record, so Sync takes Option.
            MenuItem(title: MenuCommand.syncNow, action: syncNow)
                .keyboardShortcut("r", modifiers: [.command, .option])
        }
    }
}

private struct ViewCommands: Commands {
    @FocusedValue(\.showCatalogAction) private var showCatalog
    @FocusedValue(\.showRecordingsAction) private var showRecordings
    @FocusedValue(\.recordingsSort) private var recordingsSort
    @FocusedValue(\.catalogSort) private var catalogSort

    var body: some Commands {
        CommandGroup(before: .sidebar) {
            MenuItem(title: Destination.catalogTitle, action: showCatalog)
                .keyboardShortcut("1")
            MenuItem(title: Destination.recordingsTitle, action: showRecordings)
                .keyboardShortcut("2")
            Divider()
        }
        CommandGroup(after: .sidebar) {
            Menu(MenuCommand.sortBy) {
                if let catalogSort {
                    SortChoices(choice: catalogSort)
                } else {
                    SortChoices(choice: recordingsSort ?? .constant(.default))
                }
            }
            .disabled(recordingsSort == nil && catalogSort == nil)
        }
    }
}

private struct ControlsCommands: Commands {
    @FocusedValue(\.playPauseAction) private var playPause
    @FocusedValue(\.isPlaying) private var isPlaying
    @FocusedValue(\.skipBackAction) private var skipBack
    @FocusedValue(\.skipForwardAction) private var skipForward
    @FocusedValue(\.nextTuneAction) private var nextTune
    @FocusedValue(\.previousTuneAction) private var previousTune
    @FocusedValue(\.goToRecordingAction) private var goToRecording
    @FocusedValue(\.closePlayerAction) private var closePlayer

    var body: some Commands {
        // Space and Command-Left and Command-Right are heard by the shell, which leaves them to a
        // focused field, so their items carry no shortcut.
        CommandMenu(MenuCommand.controls) {
            MenuItem(
                title: isPlaying == true ? RecordingPlayerText.pause : RecordingPlayerText.play, action: playPause)
            MenuItem(title: MenuCommand.skipBack, action: skipBack)
            MenuItem(title: MenuCommand.skipForward, action: skipForward)
            Divider()
            MenuItem(title: PlaylistControlText.next, action: nextTune)
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            MenuItem(title: PlaylistControlText.previous, action: previousTune)
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            Divider()
            MenuItem(title: MenuCommand.goToRecording, action: goToRecording)
                .keyboardShortcut("l")
            MenuItem(title: PlayerBar.close, action: closePlayer)
                .keyboardShortcut(".")
        }
    }
}

private struct FindCommands: Commands {
    @FocusedValue(\.findAction) private var find

    var body: some Commands {
        // Command-F runs the focused screen's `findAction`: iPadOS has no system Find for a
        // screen's search, and the catalog's own field on the Mac is not a `.searchable` one.
        CommandGroup(after: .textEditing) {
            MenuItem(title: MenuCommand.find, action: find)
                .keyboardShortcut("f")
        }
    }
}

/// A menu item that runs `action`, disabled while there is none.
private struct MenuItem: View {
    let title: String
    let action: MenuAction?

    var body: some View {
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
