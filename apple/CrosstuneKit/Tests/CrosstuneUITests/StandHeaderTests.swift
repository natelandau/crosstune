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
@Suite final class StandHeaderTests {
    private let suite = "StandHeaderTests.\(UUID().uuidString)"
    private let defaults: UserDefaults

    init() throws {
        defaults = try #require(UserDefaults(suiteName: suite))
    }

    deinit {
        UserDefaults.standard.removePersistentDomain(forName: suite)
    }

    private let recording = Recording(
        id: "r1", tuneID: nil, source: "microphone", addedAt: noon,
        label: "Jam at Mike's", state: "ready", sourceDurationMs: 4000)

    private func ownSubtitle() -> String {
        RecordingScreenText.subtitle(recording, tuneTitle: nil, lengthMs: 4000)
    }

    private func subtitle(_ playback: ListPlayback?, standsWithReading: Bool) -> String? {
        StandHeader.subtitle(
            recording: recording, tuneTitle: nil, lengthMs: 4000, playback: playback,
            standsWithReading: standsWithReading)
    }

    private func playback() -> ListPlayback {
        ListPlayback(player: PlayerModel(), commands: NoCommands(), defaults: defaults)
    }

    @Test func namesTheListWhileOneStandsPlaying() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b", "c"], shuffled: false)
        #expect(subtitle(playback, standsWithReading: true) == "Saturday session \u{B7} 1 of 3")
        playback.end()
    }

    @Test func keepsTheTakesOwnSubtitleWhenNoListPlays() {
        let playback = playback()
        #expect(subtitle(playback, standsWithReading: true) == ownSubtitle())
        #expect(subtitle(nil, standsWithReading: true) == ownSubtitle())
    }

    @Test func keepsTheTakesOwnSubtitleOffTheStand() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(subtitle(playback, standsWithReading: false) == ownSubtitle())
        playback.end()
    }

    @Test func aLinkNamesTheListWhileOnePlays() {
        let playback = playback()
        playback.start(listID: "l1", name: "Saturday session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(StandHeader.linkSubtitle(player: PlayerModel(), playback: playback) == "Saturday session \u{B7} 1 of 2")
        playback.end()
    }

    @Test func aLinkWithNoListAndNoTrackHasNoSubtitle() {
        #expect(StandHeader.linkSubtitle(player: PlayerModel(), playback: playback()) == nil)
        #expect(StandHeader.linkSubtitle(player: PlayerModel(), playback: nil) == nil)
    }
}
