@_spi(Testing) import CrosstuneDiagnostics
import CrosstuneStore
@_spi(Testing) import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PlayerDiagnosticsTests {
    private let audio = FakeAudio()
    private let sink = RecordingDiagnosticsSink()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio, diagnostics: sink.client)
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
    }

    private var item: PlayerItem {
        .recording(
            Recording(id: "r1", tuneID: "t1", source: "microphone", addedAt: noon, label: nil, state: "ready"),
            tuneTitle: nil)
    }

    @Test func notesTheRecordingLoadingAndPlayingToItsEnd() async throws {
        player.play(item)
        try await eventually { player.recordingAudio == .loaded }
        audio.end(.finished)

        #expect(sink.events == [.recordingLoaded, .playbackEnded])
    }

    @Test func notesTheRecordingScreenClosingAndThePlayerClosing() async throws {
        player.open(item, playing: false)
        try await eventually { player.recordingAudio == .loaded }
        player.screenOpened("r1")
        player.screenClosed()
        player.close()

        #expect(sink.events == [.recordingLoaded, .recordingScreenClosed, .playerClosed])
    }
}
