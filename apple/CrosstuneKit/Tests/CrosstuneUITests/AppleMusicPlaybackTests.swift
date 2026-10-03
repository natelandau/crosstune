import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import MusicKit
import Testing

@testable import CrosstuneUI

/// Stands in for the device's Apple Music access: answers `state`, and the first request
/// moves a never-asked state to `answer`.
@MainActor
final class FakeAccess: AppleMusicAccess {
    var state: AppleMusicAccessState
    var answer: AppleMusicAccessState
    private(set) var requests = 0

    init(_ state: AppleMusicAccessState, answer: AppleMusicAccessState = .fullTracks) {
        self.state = state
        self.answer = answer
    }

    func current() async -> AppleMusicAccessState { state }

    func request() async -> AppleMusicAccessState {
        if state == .notAsked {
            requests += 1
            state = answer
        }
        return state
    }
}

/// Stands in for the device's MusicKit player, noting what the model asked of it. With
/// `holdsLoads` on, a load waits until ``release()``.
@MainActor
final class FakeMusic: MusicPlayback {
    var isPlaying = false
    var elapsed: TimeInterval = 0
    var duration: TimeInterval?
    var trackTitle: String?
    var artwork: Artwork? { nil }
    var hasAlbum = false
    var found = true
    var holdsLoads = false
    private(set) var loaded: [AppleMusicKind] = []
    private(set) var calls: [String] = []
    private var held: CheckedContinuation<Void, Never>?

    func load(_ kind: AppleMusicKind) async -> Bool {
        calls.append("load")
        loaded.append(kind)
        if holdsLoads { await withCheckedContinuation { held = $0 } }
        return found
    }

    func release() {
        held?.resume()
        held = nil
    }

    var isHoldingLoad: Bool { held != nil }

    func play() {
        isPlaying = true
        calls.append("play")
    }

    func pause() {
        isPlaying = false
        calls.append("pause")
    }

    func seek(to seconds: TimeInterval) {
        elapsed = seconds
        calls.append("seek")
    }

    func skipTrack(forward: Bool) {
        calls.append(forward ? "next" : "previous")
    }

    func stop() {
        isPlaying = false
        calls.append("stop")
    }
}

private let songURL = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833090"

private func appleLink(url: String = songURL) -> RecordingLink {
    RecordingLink(
        id: "l1", tuneID: "t1", url: url, provider: "apple_music",
        providerRef: detectProvider(url).providerRef)
}

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

@MainActor
@Suite struct AppleMusicPlaybackTests {
    private func model(
        _ state: AppleMusicAccessState, found: Bool = true
    ) -> (PlayerModel, FakeAccess, FakeMusic) {
        let access = FakeAccess(state)
        let music = FakeMusic()
        music.found = found
        return (PlayerModel(audio: FakeAudio(), appleMusic: AppleMusic(access: access, player: music)), access, music)
    }

    private func play(_ player: PlayerModel, _ row: RecordingLink = appleLink()) async throws {
        player.play(try #require(PlayerItem.link(row)))
        try await eventually { player.linkAudio != .deciding }
    }

    @Test func playsASongInFullInTheBarForASubscriber() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        #expect(player.linkAudio == .native)
        #expect(music.loaded == [.song(id: "1440833090")])
        #expect(music.calls == ["load", "play"])
        #expect(!player.isExpanded)
        #expect(player.playsInBar)
        #expect(player.embed == nil)
        #expect(player.music === music)
    }

    @Test(arguments: [AppleMusicAccessState.noSubscription, .declined])
    func fallsBackToTheEmbedWithoutAccessOrSubscription(state: AppleMusicAccessState) async throws {
        let (player, _, music) = model(state)
        try await play(player)
        #expect(player.linkAudio == .embed)
        #expect(player.isExpanded)
        #expect(player.embed != nil)
        #expect(!player.playsInBar)
        #expect(player.music == nil)
        #expect(music.calls.isEmpty)
    }

    @Test func asksOnceWhenNotAskedAndPlaysWhenAllowed() async throws {
        let (player, access, music) = model(.notAsked)
        try await play(player)
        #expect(access.requests == 1)
        #expect(player.linkAudio == .native)
        #expect(music.calls == ["load", "play"])
    }

    @Test func fallsBackToTheEmbedWhenTheTrackIsNotFound() async throws {
        let (player, _, _) = model(.fullTracks, found: false)
        try await play(player)
        #expect(player.linkAudio == .embed)
        #expect(player.isExpanded)
        #expect(player.embed != nil)
    }

    @Test func playsVideosAndPlaylistsInTheEmbedWithoutAsking() async throws {
        let (player, access, music) = model(.notAsked)
        try await play(player, appleLink(url: "https://music.apple.com/us/music-video/x/1440833099"))
        #expect(player.linkAudio == .embed)
        #expect(access.requests == 0)
        #expect(music.calls.isEmpty)
    }

    @Test func usesTheEmbedWhenNoAppleMusicIsGiven() throws {
        let player = PlayerModel(audio: FakeAudio())
        player.play(try #require(PlayerItem.link(appleLink())))
        #expect(player.linkAudio == .embed)
        #expect(player.isExpanded)
    }

    @Test func closeStopsAndEmptiesTheQueue() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        player.close()
        #expect(music.calls.last == "stop")
        #expect(player.linkAudio == nil)
        #expect(player.music == nil)
    }

    @Test func aDecisionThatLandsAfterCloseNeverPlays() async throws {
        let (player, _, music) = model(.fullTracks)
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.isHoldingLoad }
        player.close()
        music.release()
        try await Task.sleep(for: .milliseconds(20))
        #expect(!music.calls.contains("play"))
        #expect(!player.isLoaded)
        #expect(player.linkAudio == nil)
    }

    @Test func aDecisionThatLandsDuringATakeNeverPlays() async throws {
        let (player, _, music) = model(.fullTracks)
        var capturing = false
        player.isCapturing = { capturing }
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.isHoldingLoad }
        capturing = true
        music.release()
        try await eventually { player.linkAudio == .native }
        #expect(!music.calls.contains("play"))
    }

    @Test func decidesAgainOnEachPlayTap() async throws {
        let (player, access, _) = model(.fullTracks)
        try await play(player)
        #expect(player.linkAudio == .native)
        player.close()
        access.state = .noSubscription
        try await play(player)
        #expect(player.linkAudio == .embed)
    }

    @Test func aPlayTapOnTheLoadedNativeLinkResumes() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        music.pause()
        try await play(player)
        #expect(music.calls == ["load", "play", "pause", "play"])
        #expect(player.linkAudio == .native)
    }

    @Test func playingARecordingStopsTheNativeLink() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        player.play(PlayerItem(kind: .recording, id: "r1", title: "Kitchen Girl"))
        #expect(music.calls.last == "stop")
        #expect(player.linkAudio == nil)
    }

    @Test func aDeletedLinkStopsTheNativePlayer() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        var deleted = appleLink()
        deleted.deletedAt = .now
        player.linkChanged(id: "l1", to: deleted)
        #expect(music.calls.last == "stop")
        #expect(!player.isLoaded)
    }

    @Test func aRetitledLinkKeepsPlaying() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        var renamed = appleLink()
        renamed.title = "The Silver Spear"
        player.linkChanged(id: "l1", to: renamed)
        #expect(player.title == "The Silver Spear")
        #expect(player.linkAudio == .native)
        #expect(music.calls == ["load", "play"])
    }

    @Test func namesTheAlbumTrackUnderTheLinkTitle() async throws {
        let (player, _, music) = model(.fullTracks)
        music.hasAlbum = true
        music.trackTitle = "The Mason's Apron"
        try await play(player, appleLink(url: "https://music.apple.com/us/album/reels/1440833081"))
        #expect(PlayerBar.subtitle(player) == "The Mason's Apron")
    }

    @Test func namesNoTrackForASongOrAnEmbed() async throws {
        let (player, access, music) = model(.fullTracks)
        music.trackTitle = "The Silver Spear"
        try await play(player)
        #expect(PlayerBar.subtitle(player) == nil)
        player.close()
        access.state = .declined
        try await play(player)
        #expect(PlayerBar.subtitle(player) == nil)
    }
}
