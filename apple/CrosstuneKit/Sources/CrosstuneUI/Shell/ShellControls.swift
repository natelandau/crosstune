import CrosstuneAudio
import SwiftUI

/// Publishes the player's menu commands and the destination commands, and hears the player's
/// keys while nothing is being typed and no control inside wants them: Space plays and pauses,
/// and Command-Left and Command-Right skip. The keys live here rather than on the menu items, since a bare Space
/// menu shortcut never fires and a Command-Left one would take the key from every text field.
struct ShellControls: ViewModifier {
    let player: PlayerModel
    /// The playlist driving the player, when the app has one.
    let playback: ListPlayback?
    /// The window the shell lives in, where Go to recording opens the recording's screen.
    let window: UUID
    /// False while a sheet or dialog covers the shell, which stands every command down.
    let isActive: Bool
    let show: @MainActor (Destination) -> Void

    /// Modifiers that make a key some other command, which these keys leave alone.
    private static let otherModifiers: EventModifiers = [.control, .option, .shift]

    func body(content: Content) -> some View {
        let transport = isActive ? player.transport : nil
        content
            .focusedSceneValue(
                \.playPauseAction,
                transport.map { transport in
                    MenuAction(id: ShellActionID.playPause(ObjectIdentifier(transport))) { transport.toggle() }
                }
            )
            .focusedSceneValue(\.isPlaying, transport?.isPlaying)
            .focusedSceneValue(
                \.skipBackAction,
                transport.map { transport in
                    MenuAction(id: ShellActionID.skipBack(ObjectIdentifier(transport))) {
                        Self.skip(transport, back: true)
                    }
                }
            )
            .focusedSceneValue(
                \.skipForwardAction,
                transport.map { transport in
                    MenuAction(id: ShellActionID.skipForward(ObjectIdentifier(transport))) {
                        Self.skip(transport, back: false)
                    }
                }
            )
            .focusedSceneValue(
                \.goToRecordingAction,
                isActive && player.item?.kind == .recording
                    ? MenuAction(id: ShellActionID.goToRecording(player: ObjectIdentifier(player), window: window)) {
                        player.expand(in: window)
                    } : nil
            )
            .focusedSceneValue(
                \.closePlayerAction,
                isActive && PlayerBar.isShown(player, playback)
                    ? MenuAction(
                        id: ShellActionID.closePlayer(
                            player: ObjectIdentifier(player), playback: playback.map(ObjectIdentifier.init))
                    ) { PlayerBar.closePlayer(player, playback) } : nil
            )
            .focusedSceneValue(
                \.nextTuneAction,
                isActive && playback?.isActive == true
                    ? MenuAction(id: ShellActionID.nextTune(playback.map(ObjectIdentifier.init))) { playback?.next() }
                    : nil
            )
            .focusedSceneValue(
                \.previousTuneAction,
                isActive && playback?.isActive == true
                    ? MenuAction(id: ShellActionID.previousTune(playback.map(ObjectIdentifier.init))) {
                        playback?.previous()
                    } : nil
            )
            .focusedSceneValue(
                \.showCatalogAction,
                isActive ? MenuAction(id: ShellActionID.show(.catalog, window: window)) { show(.catalog) } : nil
            )
            .focusedSceneValue(
                \.showRecordingsAction,
                isActive ? MenuAction(id: ShellActionID.show(.recordings, window: window)) { show(.recordings) } : nil
            )
            .onKeyPress(.space, phases: .down) { press in
                guard let transport, !TextEntry.isActive,
                    press.modifiers.isDisjoint(with: Self.otherModifiers.union(.command))
                else {
                    return .ignored
                }
                transport.toggle()
                return .handled
            }
            .onKeyPress(keys: [.leftArrow, .rightArrow], phases: [.down, .repeat]) { press in
                guard let transport, !TextEntry.isActive, press.modifiers.contains(.command),
                    press.modifiers.isDisjoint(with: Self.otherModifiers)
                else { return .ignored }
                Self.skip(transport, back: press.key == .leftArrow)
                return .handled
            }
    }

    private static func skip(_ transport: any PlaybackTransport, back: Bool) {
        transport.skip(by: back ? -AudioPlayer.skipInterval : AudioPlayer.skipInterval)
    }
}
