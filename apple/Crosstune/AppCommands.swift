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
    @FocusedValue(\.playPauseAction) private var playPause
    @FocusedValue(\.isPlaying) private var isPlaying
    @FocusedValue(\.skipBackAction) private var skipBack
    @FocusedValue(\.skipForwardAction) private var skipForward
    @FocusedValue(\.nextTuneAction) private var nextTune
    @FocusedValue(\.previousTuneAction) private var previousTune
    @FocusedValue(\.goToRecordingAction) private var goToRecording
    @FocusedValue(\.closePlayerAction) private var closePlayer
    @FocusedValue(\.showCatalogAction) private var showCatalog
    @FocusedValue(\.showRecordingsAction) private var showRecordings
    @FocusedValue(\.recordingsSort) private var recordingsSort
    @FocusedValue(\.catalogSort) private var catalogSort

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
        CommandGroup(before: .sidebar) {
            item(Destination.catalogTitle, showCatalog)
                .keyboardShortcut("1")
            item(Destination.recordingsTitle, showRecordings)
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
        // Space and Command-Left and Command-Right are heard by the shell, which leaves them to a
        // focused field, so their items carry no shortcut.
        CommandMenu(MenuCommand.controls) {
            item(isPlaying == true ? RecordingPlayerText.pause : RecordingPlayerText.play, playPause)
            item(MenuCommand.skipBack, skipBack)
            item(MenuCommand.skipForward, skipForward)
            Divider()
            item(PlaylistControlText.next, nextTune)
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            item(PlaylistControlText.previous, previousTune)
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            Divider()
            item(MenuCommand.goToRecording, goToRecording)
                .keyboardShortcut("l")
            item(PlayerBar.close, closePlayer)
                .keyboardShortcut(".")
        }
        // Command-F runs the focused screen's `findAction`: iPadOS has no system Find for a
        // screen's search, and the catalog's own field on the Mac is not a `.searchable` one.
        CommandGroup(after: .textEditing) {
            item(MenuCommand.find, find)
                .keyboardShortcut("f")
        }
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
