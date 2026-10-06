import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import MusicKit
import Observation
import Synchronization
import Testing

@testable import CrosstuneUI

/// Stands in for the device's Apple Music access: answers `state`, and a request moves a
/// never-asked state to `answer`. With `holdsRequests` on, a request waits until
/// ``releaseRequest()``, as the system prompt waits on the person.
@MainActor
final class FakeAccess: AppleMusicAccess {
    var state: AppleMusicAccessState
    var answer: AppleMusicAccessState
    var holdsRequests = false
    /// Once a request has been answered, every later read of the state waits until cancelled, as
    /// a subscription lookup can on a stalled network.
    var stallsAfterRequest = false
    private(set) var requests = 0
    private var held: CheckedContinuation<Void, Never>?

    init(_ state: AppleMusicAccessState, answer: AppleMusicAccessState = .fullTracks) {
        self.state = state
        self.answer = answer
    }

    var isHoldingRequest: Bool { held != nil }

    func releaseRequest() {
        held?.resume()
        held = nil
    }

    func current() async -> AppleMusicAccessState {
        if stallsAfterRequest && requests > 0 {
            try? await Task.sleep(for: .seconds(3600))
        }
        return state
    }

    func request() async -> AppleMusicAccessState {
        guard state == .notAsked else { return state }
        requests += 1
        if holdsRequests { await withCheckedContinuation { held = $0 } }
        state = answer
        return state
    }
}

/// Stands in for the device's MusicKit player, noting what the model asked of it. With
/// `holdsLoads` on, each load waits until ``release()``, and notes whether its task was
/// cancelled by then. Observable, as the device's player is.
@MainActor
@Observable
final class FakeMusic: MusicPlayback {
    var isPlaying = false
    var elapsed: TimeInterval = 0
    var duration: TimeInterval?
    var trackTitle: String?
    var artistName: String?
    var artwork: Artwork? { nil }
    var hasAlbum = false
    var found = true
    var starts = true
    var holdsLoads = false
    /// Each start waits until ``releaseStart()``, as MusicKit's play waits on buffering.
    var holdsStarts = false
    private var heldStart: CheckedContinuation<Void, Never>?
    /// Each settle after a previous waits until ``releaseSettle()``, as iOS waits on MusicKit.
    var holdsSettles = false
    private var heldSettle: CheckedContinuation<Void, Never>?
    /// Counts the settles that have returned.
    private(set) var settled = 0
    private(set) var loaded: [AppleMusicKind] = []
    /// Whether each load asked for a guarded song, in the order of `loaded`.
    private(set) var guardedLoads: [Bool] = []
    private(set) var cancelledLoads: [AppleMusicKind] = []
    /// What each finished load returned, in the order they finished.
    private(set) var loadResults: [Bool] = []
    /// Moves on with each play, as the device's player counts starts.
    private var plays = 0
    private(set) var calls: [String] = []
    private var held: [CheckedContinuation<Void, Never>] = []
    var onTrackEnd: (@MainActor (TrackEnd) -> Void)?

    /// Ends the track on its own, paused, as the device's player does.
    func end(_ end: TrackEnd) {
        isPlaying = false
        onTrackEnd?(end)
    }

    func load(_ kind: AppleMusicKind, guarded: Bool) async -> Bool {
        calls.append("load")
        loaded.append(kind)
        guardedLoads.append(guarded)
        let playsAtLoad = plays
        if holdsLoads { await withCheckedContinuation { held.append($0) } }
        if Task.isCancelled {
            cancelledLoads.append(kind)
            loadResults.append(false)
            return false
        }
        let result = found && plays == playsAtLoad
        loadResults.append(result)
        return result
    }

    func release() {
        let waiting = held
        held = []
        for continuation in waiting { continuation.resume() }
    }

    var heldLoads: Int { held.count }
    var isHoldingLoad: Bool { !held.isEmpty }

    var isHoldingStart: Bool { heldStart != nil }

    func releaseStart() {
        heldStart?.resume()
        heldStart = nil
    }

    func start() async -> Bool {
        plays += 1
        if holdsStarts { await withCheckedContinuation { heldStart = $0 } }
        calls.append("play")
        isPlaying = starts
        return starts
    }

    func play() {
        plays += 1
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

    var isHoldingSettle: Bool { heldSettle != nil }

    func releaseSettle() {
        heldSettle?.resume()
        heldSettle = nil
    }

    func settleAfterPrevious() async {
        calls.append("settle")
        if holdsSettles { await withCheckedContinuation { heldSettle = $0 } }
        settled += 1
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
        #expect(player.transport === music)
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
        #expect(player.transport == nil)
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

    @Test func aDecisionThatLandsDuringATakeEmptiesTheQueueAndCloses() async throws {
        let (player, _, music) = model(.fullTracks)
        let capturing = Mutex(false)
        player.isCapturing = { capturing.withLock { $0 } }
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.isHoldingLoad }
        capturing.withLock { $0 = true }
        music.release()
        try await eventually { !player.isLoaded }
        #expect(!music.calls.contains("play"))
        #expect(music.calls.last == "stop")
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
        // With no list playing, the link's Stand names the track too.
        #expect(StandHeader.linkSubtitle(player: player, playback: nil) == "The Mason's Apron")
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

    @Test func aSecondAppleMusicPlayCancelsTheFirstLoad() async throws {
        let (player, _, music) = model(.fullTracks)
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.heldLoads == 1 }
        var other = appleLink(url: "https://music.apple.com/us/song/the-mason-s-apron/1440833095")
        other.id = "l2"
        player.play(try #require(PlayerItem.link(other)))
        try await eventually { music.heldLoads == 2 }
        music.release()
        try await eventually { player.linkAudio == .native }
        #expect(music.cancelledLoads == [.song(id: "1440833090")])
        #expect(player.holds(.link, id: "l2"))
        #expect(music.calls.filter { $0 == "play" }.count == 1)
    }

    @Test func closeWhileThePromptIsUpNeverLoads() async throws {
        let (player, access, music) = model(.notAsked)
        access.holdsRequests = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { access.isHoldingRequest }
        player.close()
        access.releaseRequest()
        try await Task.sleep(for: .milliseconds(20))
        #expect(!music.calls.contains("load"))
        #expect(!player.isLoaded)
    }

    @Test func aFailedLoadEmptiesTheQueueBeforeTheEmbed() async throws {
        let (player, _, music) = model(.fullTracks, found: false)
        try await play(player)
        #expect(player.linkAudio == .embed)
        #expect(music.calls == ["load", "stop"])
    }

    @Test func decidesAgainWhenASubscriptionStarts() async throws {
        let (player, access, _) = model(.noSubscription)
        try await play(player)
        #expect(player.linkAudio == .embed)
        player.close()
        access.state = .fullTracks
        try await play(player)
        #expect(player.linkAudio == .native)
    }

    @Test func aStalledDecisionFallsBackToTheEmbed() async throws {
        let (player, _, music) = model(.fullTracks)
        player.decisionTimeout = .milliseconds(50)
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { player.linkAudio == .embed }
        #expect(player.isExpanded)
        #expect(music.calls.last == "stop")
        music.release()
        try await Task.sleep(for: .milliseconds(20))
        #expect(!music.calls.contains("play"))
        #expect(player.linkAudio == .embed)
    }

    @Test func theDeadlineWaitsOutTheAccessPrompt() async throws {
        let (player, access, _) = model(.notAsked)
        player.decisionTimeout = .milliseconds(50)
        access.holdsRequests = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { access.isHoldingRequest }
        try await Task.sleep(for: .milliseconds(120))
        #expect(player.linkAudio == .deciding)
        access.releaseRequest()
        try await eventually { player.linkAudio == .native }
    }

    @Test func aTrackThatWillNotStartFallsBackToTheEmbed() async throws {
        let (player, _, music) = model(.fullTracks)
        music.starts = false
        try await play(player)
        #expect(player.linkAudio == .embed)
        #expect(player.isExpanded)
        #expect(music.calls == ["load", "play", "stop"])
    }

    @Test func aSyncedAddressChangeKeepsThePlayerAsTheMusicianLeftIt() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player)
        music.pause()
        player.linkChanged(
            id: "l1", to: appleLink(url: "https://music.apple.com/us/song/the-mason-s-apron/1440833095"))
        try await eventually { player.linkAudio == .native }
        #expect(music.loaded.last == .song(id: "1440833095"))
        #expect(music.calls.filter { $0 == "play" }.count == 1)
        #expect(!player.isExpanded)
    }

    @Test func aSyncedAddressChangeThatFallsBackLeavesTheCollapsedPlayerCollapsed() async throws {
        let (player, _, _) = model(.noSubscription)
        try await play(player)
        player.isExpanded = false
        player.linkChanged(
            id: "l1", to: appleLink(url: "https://music.apple.com/us/song/the-mason-s-apron/1440833095"))
        try await eventually { player.linkAudio == .embed }
        #expect(!player.isExpanded)
        #expect(player.embed != nil)
    }

    @Test func aSyncedChangeFromAnEmbedLoadsTheTrackPaused() async throws {
        let (player, _, music) = model(.fullTracks)
        try await play(player, appleLink(url: "https://music.apple.com/us/music-video/x/1440833099"))
        player.linkChanged(id: "l1", to: appleLink())
        try await eventually { player.linkAudio == .native }
        #expect(music.calls == ["load"])
    }

    @Test func aSyncedChangeFromAnEmbedNeverAsksForAccess() async throws {
        let (player, access, music) = model(.notAsked)
        try await play(player, appleLink(url: "https://music.apple.com/us/music-video/x/1440833099"))
        player.linkChanged(id: "l1", to: appleLink())
        try await eventually { player.linkAudio == .embed }
        #expect(access.requests == 0)
        #expect(!music.calls.contains("load"))
    }

    @Test func aDecidingBarShowsOnlyTheTitle() async throws {
        let (player, _, music) = model(.fullTracks)
        music.holdsLoads = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.isHoldingLoad }
        #expect(!PlayerBar.showsGlyph(player))
        #expect(!PlayerBar.canExpand(player))
        music.release()
        try await eventually { player.linkAudio == .native }
        #expect(PlayerBar.canExpand(player))
    }

    @Test func readsTheAlbumTrackInTheBarsSpokenName() async throws {
        let (player, _, music) = model(.fullTracks)
        music.hasAlbum = true
        music.trackTitle = "The Mason's Apron"
        var row = appleLink(url: "https://music.apple.com/us/album/reels/1440833081")
        row.title = "Reels"
        try await play(player, row)
        #expect(PlayerBar.showLabel(player) == "Show player, Reels, The Mason's Apron")
    }

    @Test func aStalledSubscriptionReadAfterThePromptFallsBackToTheEmbed() async throws {
        let (player, access, music) = model(.notAsked)
        access.stallsAfterRequest = true
        player.decisionTimeout = .milliseconds(50)
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { player.linkAudio == .embed }
        #expect(access.requests == 1)
        #expect(!music.calls.contains("load"))
        #expect(!music.calls.contains("play"))
    }

    @Test func aTrackThatStartsAfterTheDeadlineIsStoppedAgain() async throws {
        let (player, _, music) = model(.fullTracks)
        player.decisionTimeout = .milliseconds(50)
        music.holdsStarts = true
        player.play(try #require(PlayerItem.link(appleLink())))
        try await eventually { music.isHoldingStart }
        try await eventually { player.linkAudio == .embed }
        music.releaseStart()
        try await eventually { music.calls.last == "stop" && music.calls.contains("play") }
        #expect(player.linkAudio == .embed)
        #expect(!music.isPlaying)
    }
}
