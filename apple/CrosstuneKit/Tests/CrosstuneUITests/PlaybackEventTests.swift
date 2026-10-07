import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private final class NoTrackCommands: TrackCommands {
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
    func disable() {}
}

private func recording(_ id: String) -> PlayerItem {
    .recording(
        Recording(id: id, tuneID: "t\(id)", source: "microphone", addedAt: noon, label: "Take \(id)", state: "ready"),
        tuneTitle: "Tune \(id)")
}

/// The player reports a play once its audio is actually playing, or once a link's own player is
/// up, and never again for a resume of the same play.
@MainActor
@Suite struct PlaybackEventTests {
    private let sink = RecordingAnalyticsSink()
    private let audio = FakeAudio()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio, analytics: sink.client)
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
    }

    private func started(_ kind: String, _ source: String) -> RecordingAnalyticsSink.Capture {
        .init(name: "playback_started", properties: ["kind": .string(kind), "source": .string(source)])
    }

    /// Waits for the activity log to have heard the player as it now stands, which the report
    /// is made just ahead of.
    private func heard(playing: Bool) async throws {
        #expect(try await poll { player.activity.lastFed?.playing == playing })
    }

    @Test func reportsARecordingOnceItPlaysAndNotOnAResume() async throws {
        player.play(recording("a"), origin: .row, source: .recordingsList)
        try await heard(playing: true)
        #expect(sink.captures == [started("recording", "recordings_list")])

        audio.pause()
        try await heard(playing: false)
        audio.play()
        try await heard(playing: true)
        player.play(recording("a"), origin: .row, source: .recordingsList)
        try await heard(playing: true)

        #expect(sink.captures == [started("recording", "recordings_list")])
    }

    @Test func reportsNothingForARecordingWhoseAudioNeverPlays() async throws {
        player.audioSource = { _ in nil }
        player.play(recording("a"), origin: .row, source: .tune)
        #expect(try await poll { player.recordingAudio == .unavailable })

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsARecordingOpenedPausedWhenItFirstPlays() async throws {
        player.open(recording("a"), playing: false)
        #expect(try await poll { player.recordingAudio == .loaded })
        try await heard(playing: false)
        #expect(sink.calls.isEmpty)

        audio.play()
        try await heard(playing: true)

        #expect(sink.captures == [started("recording", "recording")])
    }

    @Test func reportsALinkOnceItsEmbedIsUp() async throws {
        let link = RecordingLink(
            id: "l1", tuneID: "t1", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube",
            providerRef: "dQw4w9WgXcQ")
        player.play(try #require(PlayerItem.link(link)), origin: .row, source: .tune)

        #expect(sink.captures == [started("link", "tune")])
    }

    @Test func reportsAPlaylistOnceWhenItsFirstTunePlays() async throws {
        let suite = TemporaryDefaults("PlaybackEventTests")
        let playback = ListPlayback(player: player, commands: NoTrackCommands(), defaults: suite.defaults)
        playback.resolve = { _, tuneID in ListPlayback.Turn(title: "Tune \(tuneID)", item: recording(tuneID)) }

        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(try await poll { player.item?.id == "a" && audio.isPlaying })
        try await heard(playing: true)
        playback.next()
        #expect(try await poll { player.item?.id == "b" && audio.isPlaying })
        try await heard(playing: true)

        #expect(sink.captures == [started("recording", "list")])
    }
}
