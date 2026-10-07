import CrosstuneAudio
import SwiftUI

/// Something a menu command does, published by the screen or shell that can do it. A command
/// whose action no focused view publishes is disabled.
///
/// Two actions are equal when they share an identity, so a publisher that makes the same action
/// again on its next pass leaves the menu bar as it is.
public struct MenuAction: Equatable {
    private let id: AnyHashable
    private let perform: @MainActor () -> Void

    /// An action equal to none made apart from it.
    public init(_ perform: @escaping @MainActor () -> Void) {
        self.init(id: UUID(), perform)
    }

    /// - Parameter id: The same for two actions only when they do the same thing: it carries
    ///   every value `perform` captures that can differ from one pass to the next.
    public init(id: some Hashable, _ perform: @escaping @MainActor () -> Void) {
        self.id = AnyHashable(id)
        self.perform = perform
    }

    public static func == (lhs: MenuAction, rhs: MenuAction) -> Bool {
        lhs.id == rhs.id
    }

    @MainActor public func callAsFunction() {
        perform()
    }
}

/// The identities of the shell's own menu actions, each carrying the objects its action captures,
/// so the same action made on another pass compares equal and a changed one does not. An action
/// that acts on its own window carries that window, so another window's equal-looking action is
/// never taken for it when focus moves.
enum ShellActionID: Hashable {
    case playPause(ObjectIdentifier)
    case skipBack(ObjectIdentifier)
    case skipForward(ObjectIdentifier)
    case goToRecording(player: ObjectIdentifier, window: UUID)
    case closePlayer(player: ObjectIdentifier, playback: ObjectIdentifier?)
    case nextTune(ObjectIdentifier?)
    case previousTune(ObjectIdentifier?)
    case show(Destination, window: UUID)
    case openCatalogRoot
    case record(
        store: ObjectIdentifier, recorders: ObjectIdentifier, player: ObjectIdentifier, playback: ObjectIdentifier?,
        window: UUID)
    case syncNow(ObjectIdentifier)
    case newTune(catalog: ObjectIdentifier?, window: UUID?)
    case newList(window: UUID?)
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
    /// The View menu's choice of how the screen on show is sorted.
    public static let sortBy = "Sort By"
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
    /// Focuses the search field of the screen or sheet that has one.
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
    /// Plays the playing list's next tune. Published by the shell while a list plays.
    @Entry public var nextTuneAction: MenuAction?
    /// Plays the playing list's previous tune. Published by the shell with ``nextTuneAction``.
    @Entry public var previousTuneAction: MenuAction?
    /// Opens the loaded recording's screen. Published by the shell while a recording is loaded.
    @Entry public var goToRecordingAction: MenuAction?
    /// Unloads the player. Published by the shell while something is loaded, or while a
    /// playlist's end message shows.
    @Entry public var closePlayerAction: MenuAction?
    /// Shows the catalog. Published by the shell.
    @Entry public var showCatalogAction: MenuAction?
    /// Shows the recordings. Published by the shell.
    @Entry public var showRecordingsAction: MenuAction?
    /// How the recordings are sorted. Published by the recordings screen while it shows.
    @Entry public var recordingsSort: Binding<RecordingSortChoice>?
    /// How the catalog is sorted. Published by the catalog screen while it shows.
    @Entry public var catalogSort: Binding<CatalogSortChoice>?
}
