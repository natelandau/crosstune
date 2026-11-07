#if os(macOS)
    import CrosstuneStore
    import CrosstuneTestSupport
    import Foundation
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacDetailTests {
        private let audio = FakeAudio()
        private let player: PlayerModel

        init() {
            player = PlayerModel(audio: audio)
            player.audioSource = { id in
                RecordingAudioFile(
                    url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
            }
        }

        @Test func picksTheRecordingThenTheTuneThenThePlaceholder() {
            let place = ShellPlace()
            #expect(place.detailPath.detail == .placeholder)
            place.detailPath.tune = "t1"
            #expect(place.detailPath.detail == .tune("t1"))
            place.detailPath.recording = "r1"
            #expect(place.detailPath.detail == .recording("r1"))
        }

        @Test func theDetailColumnShowsTheOpenedRecordingNotTheLoadedOne() async throws {
            player.play(.recording(loggedRecording("r1"), tuneTitle: nil))
            try await eventually { player.recordingAudio == .loaded }
            let place = ShellPlace()
            place.openRecordingPage("r2", source: .recordingsList)
            #expect(place.detailPath.detail == .recording("r2"))
            #expect(player.item?.id == "r1")
        }

        @Test func openingARecordingPageFromTheTunerShowsTheRecordings() {
            let place = ShellPlace()
            place.sidebar = .tuner
            place.openRecordingPage("r1", source: .recordingsList)
            #expect(place.sidebar == .recordings)
            #expect(place.detailPath.detail == .recording("r1"))
        }

        @Test func openingAnyTuneClosesTheRecordingPage() {
            let place = ShellPlace()
            place.detailPath.tune = "t1"
            place.openRecordingPage("r1", source: .recordingsList)
            let detailTune = place.listedTuneValue()
            #expect(detailTune.value == nil)

            detailTune.value = "t1"
            #expect(place.detailPath.recording == nil)
            #expect(place.detailPath.tune == "t1")
            #expect(detailTune.value == "t1")
        }

        @Test func anUnhighlightWhileARecordingShowsKeepsTheTuneUnderneath() {
            let place = ShellPlace()
            place.detailPath.tune = "t1"
            place.openRecordingPage("r1", source: .recordingsList)
            let detailTune = place.listedTuneValue()

            detailTune.value = nil
            #expect(place.detailPath.tune == "t1")
            #expect(place.detailPath.recording == "r1")
        }
    }
#endif
