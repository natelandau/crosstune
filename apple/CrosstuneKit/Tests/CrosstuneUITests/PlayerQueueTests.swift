import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Synchronization
import Testing

@testable import CrosstuneUI

/// Notes what the player tells the queue driving it.
@MainActor
private final class FakeQueue: PlayerQueue {
    private(set) var calls: [String] = []
    private(set) var ends: [TrackEnd] = []

    func playerTrackEnded(_ end: TrackEnd) {
        ends.append(end)
        calls.append("trackEnded")
    }

    func playerCouldNotPlay() {
        calls.append("couldNotPlay")
    }

    func playerLeftQueue() {
        calls.append("leftQueue")
    }
}

private let queuedSong = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833090"
private let queuedAlbum = "https://music.apple.com/us/album/the-silver-spear/1440833081"
private let queuedAudio = URL(filePath: "/tmp/queued.m4a")

private func songItem(_ url: String = queuedSong) throws -> PlayerItem {
    let link = RecordingLink(
        id: "l1", tuneID: "t1", url: url, provider: "apple_music", providerRef: detectProvider(url).providerRef)
    return try #require(PlayerItem.link(link))
}

private func recordingItem() -> PlayerItem {
    let row = Recording(id: "r1", tuneID: "t1", source: "microphone", addedAt: noon, label: "Jam", state: "ready")
    return .recording(row, tuneTitle: "Kitchen Girl")
}

private let queuedNowPlaying = NowPlaying(title: "Jam", tuneTitle: "Kitchen Girl")

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

@MainActor
@Suite struct PlayerQueueTests {
    private struct Fixture {
        let player: PlayerModel
        let audio: FakeAudio
        let music: FakeMusic
        let queue: FakeQueue
    }

    private func fixture(_ state: AppleMusicAccessState = .fullTracks, found: Bool = true) -> Fixture {
        let audio = FakeAudio()
        let music = FakeMusic()
        music.found = found
        let player = PlayerModel(audio: audio, appleMusic: AppleMusic(access: FakeAccess(state), player: music))
        // A held load waits on the test, never on the clock, so a stalled runner cannot let the
        // decision deadline fall back to the embed mid-test. The deadline's own test sets its own.
        player.decisionTimeout = .seconds(86_400)
        player.audioSource = { _ in
            RecordingAudioFile(url: queuedAudio, file: RecordingFile(id: "r1", localState: .downloaded))
        }
        let queue = FakeQueue()
        player.queue = queue
        return Fixture(player: player, audio: audio, music: music, queue: queue)
    }

    private func queueRecording(_ fixture: Fixture) async throws {
        fixture.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.player.recordingAudio == .loaded }
    }

    private func queueSong(_ fixture: Fixture) async throws {
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.player.linkAudio == .native }
    }

    @Test func aQueuedRecordingTurnsOffIntervalSkips() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        #expect(!fixture.audio.skipsByInterval)
        fixture.player.close()
        #expect(fixture.audio.skipsByInterval)
    }

    @Test func aQueuedTrackHoldsTheSessionUntilTheQueueLeaves() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        #expect(fixture.audio.holdsSession)
        #expect(!fixture.audio.calls.contains("releaseSession"))
        fixture.player.close()
        #expect(!fixture.audio.holdsSession)
        #expect(fixture.audio.calls.last == "releaseSession")
    }

    @Test func aQueuedSongYieldsTheSessionAndLoadsGuarded() async throws {
        let fixture = fixture()
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }
        // The load is still waiting, so the yield came first.
        #expect(fixture.audio.calls == ["yieldSessionToMusic"])
        fixture.music.release()
        try await eventually { fixture.player.linkAudio == .native }
        #expect(fixture.music.loaded == [.song(id: "1440833090")])
        #expect(fixture.music.guardedLoads == [true])
        #expect(fixture.music.calls == ["load", "play"])
        #expect(!fixture.player.isExpanded)
    }

    @Test func aQueuedSongLoadedPausedTellsTheTunerItYieldedForNothing() async throws {
        let fixture = fixture()
        var told = 0
        fixture.player.playbackDidNotStart = { told += 1 }
        fixture.player.playQueued(
            try songItem(), nowPlaying: queuedNowPlaying, autoplay: false, trigger: .autoAdvance)
        try await eventually { fixture.player.linkAudio == .native }

        #expect(fixture.audio.calls == ["yieldSessionToMusic"])
        #expect(!fixture.music.calls.contains("play"))
        #expect(told == 1)
    }

    @Test func aQueuedSongThatPlaysLeavesTheTunerWaiting() async throws {
        let fixture = fixture()
        var told = 0
        fixture.player.playbackDidNotStart = { told += 1 }
        try await queueSong(fixture)

        #expect(fixture.music.calls == ["load", "play"])
        #expect(told == 0)
    }

    @Test func aSongStillBeingLookedUpLoadsPausedForTheTuner() async throws {
        let fixture = fixture()
        fixture.music.holdsLoads = true
        fixture.player.play(try songItem())
        try await eventually { fixture.music.isHoldingLoad }
        #expect(fixture.player.linkAudio == .deciding)

        fixture.player.quietForTuner()
        fixture.music.release()

        try await eventually { fixture.player.linkAudio == .native }
        #expect(fixture.music.calls == ["load"])
        #expect(fixture.player.isLoaded)
    }

    @Test func aQueuedSongStillBeingLookedUpLoadsPausedForTheTuner() async throws {
        let fixture = fixture()
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }

        fixture.player.quietForTuner()
        fixture.music.release()

        try await eventually { fixture.player.linkAudio == .native }
        #expect(fixture.music.calls == ["load"])
        #expect(fixture.player.queue != nil)
    }

    @Test func queuingTheLoadedSongAgainReloadsIt() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.end(.finished)
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.loaded.count == 2 && fixture.player.linkAudio == .native }
        #expect(fixture.music.guardedLoads == [true, true])
        #expect(fixture.music.calls == ["load", "play", "stop", "load", "play"])
    }

    @Test func queuingTheLoadedRecordingAgainReloadsIt() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        fixture.audio.end(.finished)
        fixture.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.audio.calls.count(where: { $0 == "load" }) == 2 && fixture.audio.isPlaying }
        #expect(fixture.audio.calls.count(where: { $0 == "play" }) == 2)
    }

    @Test(arguments: [AppleMusicAccessState.noSubscription, .declined, .notAsked])
    func aQueuedSongWithoutAccessReportsCouldNotPlay(state: AppleMusicAccessState) async throws {
        let fixture = fixture(state)
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(fixture.player.linkAudio == nil)
        #expect(fixture.player.embed == nil)
        #expect(!fixture.player.isLoaded)
        #expect(!fixture.player.isExpanded)
        #expect(fixture.music.loaded.isEmpty)
        #expect(!fixture.music.calls.contains("play"))
    }

    @Test func aQueuedSongThatIsNotFoundReportsCouldNotPlay() async throws {
        let fixture = fixture(.fullTracks, found: false)
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(fixture.player.linkAudio == nil)
        #expect(fixture.player.embed == nil)
        #expect(!fixture.player.isLoaded)
        #expect(!fixture.player.isExpanded)
    }

    @Test func aQueuedSongThatDoesNotStartReportsCouldNotPlay() async throws {
        let fixture = fixture()
        fixture.music.starts = false
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(fixture.player.linkAudio == nil)
        #expect(!fixture.player.isLoaded)
    }

    @Test func aQueuedAlbumReportsCouldNotPlayWithoutLoading() async throws {
        let fixture = fixture()
        fixture.player.playQueued(try songItem(queuedAlbum), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(fixture.music.loaded.isEmpty)
        #expect(fixture.player.linkAudio == nil)
        #expect(fixture.player.embed == nil)
    }

    @Test func aQueuedRecordingWithNoAudioReportsCouldNotPlay() async throws {
        let fixture = fixture()
        fixture.player.audioSource = { _ in nil }
        fixture.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.recordingAudio == nil)
        #expect(fixture.audio.holdsSession)
    }

    @Test func aQueuedRecordingPlaysWithoutItsLoop() async throws {
        let fixture = fixture()
        let loop = RecordingLoop(
            id: "p1", createdAt: noon, updatedAt: noon, recordingID: "r1", label: nil, startMs: 1000, endMs: 2000,
            color: 0)
        fixture.player.loops.follow([loop])
        fixture.player.loops.select("p1")
        #expect(fixture.player.loops.selectedID == "p1")
        try await queueRecording(fixture)
        #expect(fixture.audio.keptLoop == false)
        #expect(fixture.audio.loop == nil)
        #expect(!fixture.audio.calls.contains("setLoop"))
        #expect(!fixture.audio.calls.contains("setRepeat(true)"))
        #expect(!fixture.audio.isRepeating)
        #expect(fixture.player.loops.selectedID == nil)
        #expect(fixture.audio.isPlaying)
    }

    @Test func eachTrackEndReportsToTheQueue() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        fixture.audio.end(.finished)
        try await queueSong(fixture)
        fixture.music.end(.next)
        fixture.music.end(.previous(elapsed: 5))
        #expect(fixture.queue.ends == [.finished, .next, .previous(elapsed: 5)])
    }

    @Test func closeAndPlainPlayLeaveTheQueue() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        fixture.player.close()
        #expect(fixture.queue.calls == ["leftQueue"])
        #expect(fixture.player.queue == nil)
        #expect(!fixture.audio.holdsSession)
        #expect(fixture.audio.skipsByInterval)

        fixture.player.queue = fixture.queue
        try await queueRecording(fixture)
        fixture.player.play(recordingItem())
        #expect(fixture.queue.calls == ["leftQueue", "leftQueue"])
        #expect(fixture.player.queue == nil)
        #expect(!fixture.audio.holdsSession)
        #expect(fixture.audio.skipsByInterval)
        try await eventually { fixture.player.recordingAudio == .loaded }
        // The recording just loaded no longer reports to a queue.
        fixture.audio.end(.finished)
        #expect(fixture.queue.ends.isEmpty)
    }

    @Test func leavingTheStoreLeavesTheQueue() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        fixture.player.leaveStore()
        #expect(fixture.queue.calls == ["leftQueue"])
        #expect(fixture.player.queue == nil)
    }

    @Test func leaveQueueKeepsTheLoadedItem() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        let item = fixture.player.item
        fixture.player.leaveQueue()
        #expect(fixture.player.item == item)
        #expect(fixture.player.recordingAudio == .loaded)
        #expect(fixture.player.queue == nil)
        #expect(fixture.queue.calls.isEmpty)
        #expect(!fixture.audio.holdsSession)
        #expect(fixture.audio.skipsByInterval)
        #expect(fixture.audio.calls.last == "releaseSession")
        fixture.audio.end(.finished)
        #expect(fixture.queue.ends.isEmpty)
    }

    @Test func aTakeStartingWhileASongLoadsLeavesTheQueue() async throws {
        let fixture = fixture()
        let capturing = Mutex(false)
        fixture.player.isCapturing = { capturing.withLock { $0 } }
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }
        capturing.withLock { $0 = true }
        fixture.music.release()
        try await eventually { fixture.queue.calls == ["leftQueue"] }
        #expect(!fixture.music.calls.contains("play"))
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.queue == nil)
        #expect(fixture.audio.calls.last == "releaseSession")
    }

    @Test func aTakeStartingBeforeASongLoadsLeavesTheSessionAlone() async throws {
        let fixture = fixture()
        let capturing = Mutex(false)
        fixture.player.isCapturing = { capturing.withLock { $0 } }
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        // Before the decision's access lookup returns, as a tuner or take can start meanwhile.
        capturing.withLock { $0 = true }
        try await eventually { fixture.queue.calls == ["leftQueue"] }
        #expect(!fixture.audio.calls.contains("yieldSessionToMusic"))
        #expect(fixture.music.loaded.isEmpty)
        #expect(!fixture.player.isLoaded)
    }

    @Test func aSongNotDecidedByTheTimeoutReportsCouldNotPlay() async throws {
        let fixture = fixture()
        fixture.player.decisionTimeout = .milliseconds(20)
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.embed == nil)
        fixture.music.release()
    }

    @Test func aPlainPlayOfTheQueuedSongLoadsItUnguarded() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.player.play(try songItem())
        try await eventually { fixture.music.loaded.count == 2 && fixture.player.linkAudio == .native }
        #expect(fixture.music.guardedLoads == [true, false])
        #expect(fixture.queue.calls == ["leftQueue"])
    }

    @Test func aSongLeftLoadedByTheQueueResumesUnguarded() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.end(.finished)
        fixture.player.leaveQueue()
        let told = fixture.queue.calls
        try await eventually { fixture.music.loaded.count == 2 && fixture.player.linkAudio == .native }
        #expect(fixture.music.guardedLoads == [true, false])
        #expect(!fixture.music.isPlaying)

        // The bar's play button.
        fixture.player.transport?.play()
        #expect(fixture.music.isPlaying)
        fixture.music.pause()
        fixture.player.play(try songItem())
        #expect(fixture.music.isPlaying)
        #expect(fixture.music.loaded.count == 2)
        #expect(fixture.queue.calls == told)
    }

    @Test func aSongThatLoadsAfterTheQueueLeftIsReleasedUnguarded() async throws {
        let fixture = fixture()
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }
        fixture.player.leaveQueue()
        fixture.music.holdsLoads = false
        fixture.music.release()
        try await eventually { fixture.music.guardedLoads.last == false && fixture.player.linkAudio == .native }
        #expect(!fixture.music.isPlaying)
        #expect(!fixture.music.calls.contains("play"))
        #expect(!fixture.music.calls.contains("stop"))
    }

    @Test func releasingASongKeepsTheOpenPlayerAndTheBar() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.player.expand()
        fixture.music.holdsLoads = true
        fixture.player.leaveQueue()
        try await eventually { fixture.music.isHoldingLoad }
        #expect(fixture.player.linkAudio == .native)
        #expect(fixture.player.isExpanded)
        #expect(fixture.player.transport === fixture.music)
        #expect(!fixture.music.calls.contains("stop"))
        fixture.music.holdsLoads = false
        fixture.music.release()
        try await eventually { fixture.music.guardedLoads == [true, false] }
        #expect(fixture.player.isExpanded)
        #expect(fixture.player.linkAudio == .native)
    }

    @Test func aFailedReleaseLeavesTheSongPlayableInTheBar() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.found = false
        fixture.player.leaveQueue()
        try await eventually { fixture.music.guardedLoads == [true, false] }
        #expect(fixture.player.linkAudio == .native)
        #expect(fixture.player.transport === fixture.music)
        #expect(fixture.player.playsInBar)
    }

    @Test func aPlayDuringTheReleaseCancelsIt() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.holdsLoads = true
        fixture.player.leaveQueue()
        try await eventually { fixture.music.isHoldingLoad }
        fixture.player.play(try songItem())
        try await eventually { fixture.music.heldLoads == 2 }
        fixture.music.holdsLoads = false
        fixture.music.release()
        try await eventually { fixture.player.linkAudio == .native }
        #expect(fixture.music.cancelledLoads == [.song(id: "1440833090")])
        #expect(fixture.music.guardedLoads == [true, false, false])
        #expect(fixture.music.isPlaying)
    }

    @Test func theBarsPlayDuringTheReleaseKeepsTheGuardedSong() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.pause()
        fixture.music.holdsLoads = true
        fixture.player.leaveQueue()
        try await eventually { fixture.music.isHoldingLoad }
        fixture.player.transport?.play()
        fixture.music.holdsLoads = false
        fixture.music.release()
        try await eventually { fixture.music.loadResults.count == 2 }
        #expect(fixture.music.loadResults == [true, false])
        #expect(fixture.music.guardedLoads == [true, false])
        #expect(fixture.music.isPlaying)

        // The guard queue is still loaded, so a play of the same song frees it.
        fixture.music.pause()
        fixture.player.play(try songItem())
        try await eventually { fixture.music.loaded.count == 3 && fixture.music.isPlaying }
        #expect(fixture.music.guardedLoads == [true, false, false])
    }

    @Test func aQueuedSongFailingAfterTheQueueLeftFallsBackToTheEmbed() async throws {
        let fixture = fixture()
        fixture.music.found = false
        fixture.music.holdsLoads = true
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.music.isHoldingLoad }
        fixture.player.leaveQueue()
        fixture.music.release()
        try await eventually { fixture.player.linkAudio == .embed }
        #expect(fixture.player.isLoaded)
        #expect(!fixture.player.isExpanded)
        #expect(fixture.queue.calls.isEmpty)
    }

    @Test func aQueuedRecordingKeepsTheQueuesNowPlayingThroughEdits() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        let file = RecordingAudioFile(url: queuedAudio, file: RecordingFile(id: "r1", localState: .downloaded))
        var row = try #require(recordingItem().recording)
        row.label = "Renamed"
        fixture.player.recordingChanged(id: "r1", to: row, audioFile: file, tuneTitle: "Kitchen Reel")
        #expect(fixture.player.title == "Renamed")
        #expect(fixture.audio.nowPlaying == queuedNowPlaying)

        let revision = RecordingAudioFile(
            url: URL(filePath: "/tmp/queued-2.m4a"), file: RecordingFile(id: "r1", localState: .downloaded))
        fixture.player.recordingChanged(id: "r1", to: row, audioFile: revision, tuneTitle: "Kitchen Reel")
        #expect(fixture.audio.loaded == revision.url)
        #expect(fixture.audio.nowPlaying == queuedNowPlaying)
    }

    @Test func aQueuedRecordingReloadedAfterAFailedDeleteReportsCouldNotPlayWhenGone() async throws {
        struct Refused: Error {}
        let fixture = fixture()
        try await queueRecording(fixture)
        fixture.player.audioSource = { _ in nil }
        await fixture.player.deleteLoadedRecording { throw Refused() }
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        #expect(!fixture.player.isLoaded)
    }

    @Test func aFetchThatFailsAfterTheQueueLeftShowsUnavailable() async throws {
        let fixture = fixture()
        var waiting: CheckedContinuation<Void, Never>?
        var asked = false
        fixture.player.audioSource = { _ in
            asked = true
            await withCheckedContinuation { waiting = $0 }
            return nil
        }
        fixture.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { asked && waiting != nil }
        fixture.player.leaveQueue()
        waiting?.resume()
        try await eventually { fixture.player.recordingAudio == .unavailable }
        #expect(fixture.queue.calls.isEmpty)
        #expect(fixture.player.isLoaded)
    }

    @Test func aQueuedTrackIsRefusedDuringATake() async throws {
        let fixture = fixture()
        fixture.player.isCapturing = { true }
        #expect(!fixture.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance))
        #expect(!fixture.player.isLoaded)
        #expect(fixture.queue.calls.isEmpty)
    }

    @Test func aSyncedSongAddressLoadsGuardedForTheQueue() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        fixture.player.linkChanged(id: "l1", to: row)
        try await eventually { fixture.music.loaded.count == 2 && fixture.player.linkAudio == .native }
        #expect(fixture.music.loaded.last == .song(id: "1440833095"))
        #expect(fixture.music.guardedLoads == [true, true])
        #expect(fixture.player.queue === fixture.queue)
        // The song still reports its end, so the queue moves on.
        fixture.music.end(.finished)
        #expect(fixture.queue.ends == [.finished])
    }

    @Test func aSyncedSongAddressKeepsAPausedQueuedSongPaused() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.music.pause()
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        fixture.player.linkChanged(id: "l1", to: row)
        try await eventually { fixture.music.loaded.count == 2 && fixture.player.linkAudio == .native }
        #expect(fixture.music.guardedLoads == [true, true])
        #expect(!fixture.music.isPlaying)
    }

    @Test func aSyncedSongAddressKeepsAPlayingQueuedSongPlaying() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        fixture.player.linkChanged(id: "l1", to: row)
        try await eventually { fixture.music.loaded.count == 2 && fixture.music.isPlaying }
        #expect(fixture.music.guardedLoads == [true, true])
    }

    @Test func aSyncedAddressThatIsNoLongerASongReportsCouldNotPlay() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: queuedAlbum, provider: "apple_music",
            providerRef: detectProvider(queuedAlbum).providerRef)
        fixture.player.linkChanged(id: "l1", to: row)
        #expect(fixture.queue.calls == ["couldNotPlay"])
        #expect(!fixture.player.isLoaded)
        #expect(fixture.music.loaded.count == 1)
        #expect(fixture.player.queue === fixture.queue)
    }

    @Test func aQueuedRecordingDeletedBySyncReportsCouldNotPlay() async throws {
        let fixture = fixture()
        try await queueRecording(fixture)
        var row = try #require(recordingItem().recording)
        row.deletedAt = noon
        fixture.player.recordingChanged(id: "r1", to: row, audioFile: nil, tuneTitle: "Kitchen Girl")
        #expect(fixture.queue.calls == ["couldNotPlay"])
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.queue === fixture.queue)
    }

    @Test func aQueuedSongWhoseLinkIsGoneReportsCouldNotPlay() async throws {
        let fixture = fixture()
        try await queueSong(fixture)
        fixture.player.linkChanged(id: "l1", to: nil)
        #expect(fixture.queue.calls == ["couldNotPlay"])
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.queue === fixture.queue)
    }

    @Test func aQueuedReplaceKeepsTheOpenPlayer() async throws {
        let fixture = fixture()
        let window = UUID()
        try await queueRecording(fixture)
        fixture.player.expand(in: window)
        try await queueSong(fixture)
        #expect(fixture.player.isExpanded)
        #expect(fixture.player.expandedWindow == window)
        try await queueRecording(fixture)
        #expect(fixture.player.showsExpanded(in: window))
    }

    @Test func aQueuedTrackThatCannotPlayKeepsTheOpenPlayerForTheNext() async throws {
        let fixture = fixture()
        let window = UUID()
        try await queueRecording(fixture)
        fixture.player.expand(in: window)
        fixture.music.found = false
        fixture.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying, trigger: .autoAdvance)
        try await eventually { fixture.queue.calls == ["couldNotPlay"] }
        try await queueRecording(fixture)
        #expect(fixture.player.showsExpanded(in: window))
    }
}
