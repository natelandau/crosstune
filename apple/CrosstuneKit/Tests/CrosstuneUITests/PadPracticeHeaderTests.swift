import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
private final class NoCommands: TrackCommands {
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
    func disable() {}
}

@MainActor
@Suite final class PadPracticeHeaderTests {
    private let suite = TemporaryDefaults("PadPracticeHeaderTests")
    private var defaults: UserDefaults { suite.defaults }

    private let recording = Recording(
        id: "r1", tuneID: nil, source: "microphone", addedAt: noon,
        label: "Jam at Mike's", state: "ready", sourceDurationMs: 4000)

    private func ownSubtitle() -> String {
        RecordingScreenText.subtitle(recording, tuneTitle: nil, lengthMs: 4000)
    }

    private func subtitle(_ playback: ListPlayback?, showsReadingPane: Bool) -> String? {
        PadPracticeHeader.subtitle(
            recording: recording, tuneTitle: nil, lengthMs: 4000, playback: playback,
            showsReadingPane: showsReadingPane)
    }

    private func playback() -> ListPlayback {
        ListPlayback(player: PlayerModel(), commands: NoCommands(), defaults: defaults)
    }

    @Test func namesTheListWhileOneIsPlaying() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b", "c"], shuffled: false)
        #expect(subtitle(playback, showsReadingPane: true) == "Saturday session \u{B7} 1 of 3")
        playback.end()
    }

    @Test func keepsTheTakesOwnSubtitleWhenNoListPlays() {
        let playback = playback()
        #expect(subtitle(playback, showsReadingPane: true) == ownSubtitle())
        #expect(subtitle(nil, showsReadingPane: true) == ownSubtitle())
    }

    @Test func keepsTheTakesOwnSubtitleOffThePadPracticeScreen() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(subtitle(playback, showsReadingPane: false) == ownSubtitle())
        playback.end()
    }

    @Test func aLinkNamesTheListWhileOnePlays() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(
            PadPracticeHeader.linkSubtitle(player: PlayerModel(), playback: playback)
                == "Saturday session \u{B7} 1 of 2")
        playback.end()
    }

    @Test func aLinkWithNoListAndNoTrackHasNoSubtitle() {
        #expect(PadPracticeHeader.linkSubtitle(player: PlayerModel(), playback: playback()) == nil)
        #expect(PadPracticeHeader.linkSubtitle(player: PlayerModel(), playback: nil) == nil)
    }
}
