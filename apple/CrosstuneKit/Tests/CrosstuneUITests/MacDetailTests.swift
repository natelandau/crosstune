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

        private func openPaused(in window: UUID) async throws {
            player.open(.recording(loggedTake(), tuneTitle: nil), in: window, playing: false)
            try await waitFor { player.recordingAudio == .loaded }
        }

        @Test func picksPracticeThenTuneThenPlaceholder() async throws {
            let window = UUID()
            #expect(MacDetail.pick(player, in: window, tune: nil) == .placeholder)
            #expect(MacDetail.pick(player, in: window, tune: "t1") == .tune("t1"))

            try await openPaused(in: window)
            #expect(MacDetail.pick(player, in: window, tune: "t1") == .practice)
        }

        @Test func anotherWindowKeepsItsTune() async throws {
            try await openPaused(in: UUID())
            #expect(MacDetail.pick(player, in: UUID(), tune: "t1") == .tune("t1"))
        }

        @Test func aLinkInFullIsNotPractice() throws {
            var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
            link.providerRef = "dQw4w9WgXcQ"
            player.play(try #require(PlayerItem.link(link)))
            #expect(player.isExpanded)
            #expect(MacDetail.pick(player, in: UUID(), tune: "t1") == .tune("t1"))
        }

        @Test func openingAnyTuneClosesPractice() async throws {
            let place = ShellPlace()
            place.detailTune = "t1"
            let window = UUID()
            try await openPaused(in: window)
            let detailTune = practiceAwareDetailTune(place, player: player, window: window)
            #expect(detailTune.value == nil)

            detailTune.value = "t1"
            #expect(!player.isExpanded)
            #expect(place.detailTune == "t1")
            #expect(detailTune.value == "t1")
        }

        @Test func anUnhighlightWhileExpandedKeepsTheTuneUnderneath() async throws {
            let place = ShellPlace()
            place.detailTune = "t1"
            let window = UUID()
            try await openPaused(in: window)
            player.transport?.play()
            let detailTune = practiceAwareDetailTune(place, player: player, window: window)

            detailTune.value = nil
            #expect(place.detailTune == "t1")
        }
    }
#endif
