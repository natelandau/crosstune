import CrosstuneAudio
import SwiftUI

/// Something a menu command does, published by the screen or shell that can do it. A command
/// whose action no focused view publishes is disabled.
public struct MenuAction {
    private let perform: @MainActor () -> Void

    public init(_ perform: @escaping @MainActor () -> Void) {
        self.perform = perform
    }

    @MainActor public func callAsFunction() {
        perform()
    }
}

/// The names of the app's menu commands.
public enum MenuCommand {
    public static let newTune = "New tune…"
    public static let newList = SidebarItem.newList
    public static let syncNow = "Sync now"
    public static let find = "Find"
    /// The menu of player commands, named as in Music.
    public static let controls = "Controls"
    public static let goToRecording = "Go to recording"
    public static let skipBack = RecordingPlayerText.skipBack(AudioPlayer.skipInterval)
    public static let skipForward = RecordingPlayerText.skipForward(AudioPlayer.skipInterval)
}

extension FocusedValues {
    /// Opens the new tune form. Published by the shell.
    @Entry public var newTuneAction: MenuAction?
    /// Starts making a list. Published by the shell.
    @Entry public var newListAction: MenuAction?
    /// Opens the record sheet. Published by the shell.
    @Entry public var recordAction: MenuAction?
    /// Runs a sync now. Published by the shell while a store is open.
    @Entry public var syncNowAction: MenuAction?
    /// Focuses the search field of the screen that has one. Read on iPadOS only; on the Mac the
    /// system Find items reach a screen through its `.searchable` field.
    @Entry public var findAction: MenuAction?
    /// Plays or pauses the loaded item. Published by the shell while something it can play is
    /// loaded.
    @Entry public var playPauseAction: MenuAction?
    /// Whether the loaded item plays now, which names the play and pause command.
    @Entry public var isPlaying: Bool?
    /// Skips the loaded item back. Published by the shell with ``playPauseAction``.
    @Entry public var skipBackAction: MenuAction?
    /// Skips the loaded item forward. Published by the shell with ``playPauseAction``.
    @Entry public var skipForwardAction: MenuAction?
    /// Opens the loaded recording's screen. Published by the shell while a recording is loaded.
    @Entry public var goToRecordingAction: MenuAction?
    /// Unloads the player. Published by the shell while something is loaded.
    @Entry public var closePlayerAction: MenuAction?
    /// Shows the catalog. Published by the shell.
    @Entry public var showCatalogAction: MenuAction?
    /// Shows the recordings. Published by the shell.
    @Entry public var showRecordingsAction: MenuAction?
}
