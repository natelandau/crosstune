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
    private struct Rig {
        let player: PlayerModel
        let audio: FakeAudio
        let music: FakeMusic
        let queue: FakeQueue
    }

    private func rig(_ state: AppleMusicAccessState = .fullTracks, found: Bool = true) -> Rig {
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
        return Rig(player: player, audio: audio, music: music, queue: queue)
    }

    private func queueRecording(_ rig: Rig) async throws {
        rig.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.player.recordingAudio == .loaded }
    }

    private func queueSong(_ rig: Rig) async throws {
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.player.linkAudio == .native }
    }

    @Test func aQueuedRecordingTurnsOffIntervalSkips() async throws {
        let rig = rig()
        try await queueRecording(rig)
        #expect(!rig.audio.skipsByInterval)
        rig.player.close()
        #expect(rig.audio.skipsByInterval)
    }

    @Test func aQueuedTrackHoldsTheSessionUntilTheQueueLeaves() async throws {
        let rig = rig()
        try await queueRecording(rig)
        #expect(rig.audio.holdsSession)
        #expect(!rig.audio.calls.contains("releaseSession"))
        rig.player.close()
        #expect(!rig.audio.holdsSession)
        #expect(rig.audio.calls.last == "releaseSession")
    }

    @Test func aQueuedSongYieldsTheSessionAndLoadsGuarded() async throws {
        let rig = rig()
        rig.music.holdsLoads = true
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.isHoldingLoad }
        // The load is still waiting, so the yield came first.
        #expect(rig.audio.calls == ["yieldSessionToMusic"])
        rig.music.release()
        try await eventually { rig.player.linkAudio == .native }
        #expect(rig.music.loaded == [.song(id: "1440833090")])
        #expect(rig.music.guardedLoads == [true])
        #expect(rig.music.calls == ["load", "play"])
        #expect(!rig.player.isExpanded)
    }

    @Test func queuingTheLoadedSongAgainReloadsIt() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.end(.finished)
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.loaded.count == 2 && rig.player.linkAudio == .native }
        #expect(rig.music.guardedLoads == [true, true])
        #expect(rig.music.calls == ["load", "play", "stop", "load", "play"])
    }

    @Test func queuingTheLoadedRecordingAgainReloadsIt() async throws {
        let rig = rig()
        try await queueRecording(rig)
        rig.audio.end(.finished)
        rig.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.audio.calls.filter { $0 == "load" }.count == 2 && rig.audio.isPlaying }
        #expect(rig.audio.calls.filter { $0 == "play" }.count == 2)
    }

    @Test(arguments: [AppleMusicAccessState.noSubscription, .declined, .notAsked])
    func aQueuedSongWithoutAccessReportsCouldNotPlay(state: AppleMusicAccessState) async throws {
        let rig = rig(state)
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(rig.player.linkAudio == nil)
        #expect(rig.player.embed == nil)
        #expect(!rig.player.isLoaded)
        #expect(!rig.player.isExpanded)
        #expect(rig.music.loaded.isEmpty)
        #expect(!rig.music.calls.contains("play"))
    }

    @Test func aQueuedSongThatIsNotFoundReportsCouldNotPlay() async throws {
        let rig = rig(.fullTracks, found: false)
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(rig.player.linkAudio == nil)
        #expect(rig.player.embed == nil)
        #expect(!rig.player.isLoaded)
        #expect(!rig.player.isExpanded)
    }

    @Test func aQueuedSongThatDoesNotStartReportsCouldNotPlay() async throws {
        let rig = rig()
        rig.music.starts = false
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(rig.player.linkAudio == nil)
        #expect(!rig.player.isLoaded)
    }

    @Test func aQueuedAlbumReportsCouldNotPlayWithoutLoading() async throws {
        let rig = rig()
        rig.player.playQueued(try songItem(queuedAlbum), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(rig.music.loaded.isEmpty)
        #expect(rig.player.linkAudio == nil)
        #expect(rig.player.embed == nil)
    }

    @Test func aQueuedRecordingWithNoAudioReportsCouldNotPlay() async throws {
        let rig = rig()
        rig.player.audioSource = { _ in nil }
        rig.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(!rig.player.isLoaded)
        #expect(rig.player.recordingAudio == nil)
        #expect(rig.audio.holdsSession)
    }

    @Test func aQueuedRecordingPlaysWithoutItsLoop() async throws {
        let rig = rig()
        let loop = RecordingLoop(
            id: "p1", createdAt: noon, updatedAt: noon, recordingID: "r1", label: nil, startMs: 1000, endMs: 2000,
            color: 0)
        rig.player.loops.follow([loop])
        rig.player.loops.select("p1")
        #expect(rig.player.loops.selectedID == "p1")
        try await queueRecording(rig)
        #expect(rig.audio.keptLoop == false)
        #expect(rig.audio.loop == nil)
        #expect(!rig.audio.calls.contains("setLoop"))
        #expect(!rig.audio.calls.contains("setRepeat(true)"))
        #expect(!rig.audio.isRepeating)
        #expect(rig.player.loops.selectedID == nil)
        #expect(rig.audio.isPlaying)
    }

    @Test func eachTrackEndReportsToTheQueue() async throws {
        let rig = rig()
        try await queueRecording(rig)
        rig.audio.end(.finished)
        try await queueSong(rig)
        rig.music.end(.next)
        rig.music.end(.previous(elapsed: 5))
        #expect(rig.queue.ends == [.finished, .next, .previous(elapsed: 5)])
    }

    @Test func closeAndPlainPlayLeaveTheQueue() async throws {
        let rig = rig()
        try await queueRecording(rig)
        rig.player.close()
        #expect(rig.queue.calls == ["leftQueue"])
        #expect(rig.player.queue == nil)
        #expect(!rig.audio.holdsSession)
        #expect(rig.audio.skipsByInterval)

        rig.player.queue = rig.queue
        try await queueRecording(rig)
        rig.player.play(recordingItem())
        #expect(rig.queue.calls == ["leftQueue", "leftQueue"])
        #expect(rig.player.queue == nil)
        #expect(!rig.audio.holdsSession)
        #expect(rig.audio.skipsByInterval)
        try await eventually { rig.player.recordingAudio == .loaded }
        // The recording just loaded no longer reports to a queue.
        rig.audio.end(.finished)
        #expect(rig.queue.ends.isEmpty)
    }

    @Test func leavingTheStoreLeavesTheQueue() async throws {
        let rig = rig()
        try await queueRecording(rig)
        rig.player.leaveStore()
        #expect(rig.queue.calls == ["leftQueue"])
        #expect(rig.player.queue == nil)
    }

    @Test func leaveQueueKeepsTheLoadedItem() async throws {
        let rig = rig()
        try await queueRecording(rig)
        let item = rig.player.item
        rig.player.leaveQueue()
        #expect(rig.player.item == item)
        #expect(rig.player.recordingAudio == .loaded)
        #expect(rig.player.queue == nil)
        #expect(rig.queue.calls.isEmpty)
        #expect(!rig.audio.holdsSession)
        #expect(rig.audio.skipsByInterval)
        #expect(rig.audio.calls.last == "releaseSession")
        rig.audio.end(.finished)
        #expect(rig.queue.ends.isEmpty)
    }

    @Test func aTakeStartingWhileASongLoadsLeavesTheQueue() async throws {
        let rig = rig()
        let capturing = Mutex(false)
        rig.player.isCapturing = { capturing.withLock { $0 } }
        rig.music.holdsLoads = true
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.isHoldingLoad }
        capturing.withLock { $0 = true }
        rig.music.release()
        try await eventually { rig.queue.calls == ["leftQueue"] }
        #expect(!rig.music.calls.contains("play"))
        #expect(!rig.player.isLoaded)
        #expect(rig.player.queue == nil)
        #expect(rig.audio.calls.last == "releaseSession")
    }

    @Test func aSongNotDecidedByTheTimeoutReportsCouldNotPlay() async throws {
        let rig = rig()
        rig.player.decisionTimeout = .milliseconds(20)
        rig.music.holdsLoads = true
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.isHoldingLoad }
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(!rig.player.isLoaded)
        #expect(rig.player.embed == nil)
        rig.music.release()
    }

    @Test func aPlainPlayOfTheQueuedSongLoadsItUnguarded() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.player.play(try songItem())
        try await eventually { rig.music.loaded.count == 2 && rig.player.linkAudio == .native }
        #expect(rig.music.guardedLoads == [true, false])
        #expect(rig.queue.calls == ["leftQueue"])
    }

    @Test func aSongLeftLoadedByTheQueueResumesUnguarded() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.end(.finished)
        rig.player.leaveQueue()
        let told = rig.queue.calls
        try await eventually { rig.music.loaded.count == 2 && rig.player.linkAudio == .native }
        #expect(rig.music.guardedLoads == [true, false])
        #expect(!rig.music.isPlaying)

        // The bar's play button.
        rig.player.transport?.play()
        #expect(rig.music.isPlaying)
        rig.music.pause()
        rig.player.play(try songItem())
        #expect(rig.music.isPlaying)
        #expect(rig.music.loaded.count == 2)
        #expect(rig.queue.calls == told)
    }

    @Test func aSongThatLoadsAfterTheQueueLeftIsReleasedUnguarded() async throws {
        let rig = rig()
        rig.music.holdsLoads = true
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.isHoldingLoad }
        rig.player.leaveQueue()
        rig.music.holdsLoads = false
        rig.music.release()
        try await eventually { rig.music.guardedLoads.last == false && rig.player.linkAudio == .native }
        #expect(!rig.music.isPlaying)
        #expect(!rig.music.calls.contains("play"))
        #expect(!rig.music.calls.contains("stop"))
    }

    @Test func releasingASongKeepsTheOpenPlayerAndTheBar() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.player.expand()
        rig.music.holdsLoads = true
        rig.player.leaveQueue()
        try await eventually { rig.music.isHoldingLoad }
        #expect(rig.player.linkAudio == .native)
        #expect(rig.player.isExpanded)
        #expect(rig.player.transport === rig.music)
        #expect(!rig.music.calls.contains("stop"))
        rig.music.holdsLoads = false
        rig.music.release()
        try await eventually { rig.music.guardedLoads == [true, false] }
        #expect(rig.player.isExpanded)
        #expect(rig.player.linkAudio == .native)
    }

    @Test func aFailedReleaseLeavesTheSongPlayableInTheBar() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.found = false
        rig.player.leaveQueue()
        try await eventually { rig.music.guardedLoads == [true, false] }
        #expect(rig.player.linkAudio == .native)
        #expect(rig.player.transport === rig.music)
        #expect(rig.player.playsInBar)
    }

    @Test func aPlayDuringTheReleaseCancelsIt() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.holdsLoads = true
        rig.player.leaveQueue()
        try await eventually { rig.music.isHoldingLoad }
        rig.player.play(try songItem())
        try await eventually { rig.music.heldLoads == 2 }
        rig.music.holdsLoads = false
        rig.music.release()
        try await eventually { rig.player.linkAudio == .native }
        #expect(rig.music.cancelledLoads == [.song(id: "1440833090")])
        #expect(rig.music.guardedLoads == [true, false, false])
        #expect(rig.music.isPlaying)
    }

    @Test func theBarsPlayDuringTheReleaseKeepsTheGuardedSong() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.pause()
        rig.music.holdsLoads = true
        rig.player.leaveQueue()
        try await eventually { rig.music.isHoldingLoad }
        rig.player.transport?.play()
        rig.music.holdsLoads = false
        rig.music.release()
        try await eventually { rig.music.loadResults.count == 2 }
        #expect(rig.music.loadResults == [true, false])
        #expect(rig.music.guardedLoads == [true, false])
        #expect(rig.music.isPlaying)

        // The guard queue is still loaded, so a play of the same song frees it.
        rig.music.pause()
        rig.player.play(try songItem())
        try await eventually { rig.music.loaded.count == 3 && rig.music.isPlaying }
        #expect(rig.music.guardedLoads == [true, false, false])
    }

    @Test func aQueuedSongFailingAfterTheQueueLeftFallsBackToTheEmbed() async throws {
        let rig = rig()
        rig.music.found = false
        rig.music.holdsLoads = true
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.music.isHoldingLoad }
        rig.player.leaveQueue()
        rig.music.release()
        try await eventually { rig.player.linkAudio == .embed }
        #expect(rig.player.isLoaded)
        #expect(!rig.player.isExpanded)
        #expect(rig.queue.calls.isEmpty)
    }

    @Test func aQueuedRecordingKeepsTheQueuesNowPlayingThroughEdits() async throws {
        let rig = rig()
        try await queueRecording(rig)
        let file = RecordingAudioFile(url: queuedAudio, file: RecordingFile(id: "r1", localState: .downloaded))
        var row = try #require(recordingItem().recording)
        row.label = "Renamed"
        rig.player.recordingChanged(id: "r1", to: row, audioFile: file, tuneTitle: "Kitchen Reel")
        #expect(rig.player.title == "Renamed")
        #expect(rig.audio.nowPlaying == queuedNowPlaying)

        let revision = RecordingAudioFile(
            url: URL(filePath: "/tmp/queued-2.m4a"), file: RecordingFile(id: "r1", localState: .downloaded))
        rig.player.recordingChanged(id: "r1", to: row, audioFile: revision, tuneTitle: "Kitchen Reel")
        #expect(rig.audio.loaded == revision.url)
        #expect(rig.audio.nowPlaying == queuedNowPlaying)
    }

    @Test func aQueuedRecordingReloadedAfterAFailedDeleteReportsCouldNotPlayWhenGone() async throws {
        struct Refused: Error {}
        let rig = rig()
        try await queueRecording(rig)
        rig.player.audioSource = { _ in nil }
        await rig.player.deleteLoadedRecording { throw Refused() }
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        #expect(!rig.player.isLoaded)
    }

    @Test func aFetchThatFailsAfterTheQueueLeftShowsUnavailable() async throws {
        let rig = rig()
        var waiting: CheckedContinuation<Void, Never>?
        var asked = false
        rig.player.audioSource = { _ in
            asked = true
            await withCheckedContinuation { waiting = $0 }
            return nil
        }
        rig.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying)
        try await eventually { asked && waiting != nil }
        rig.player.leaveQueue()
        waiting?.resume()
        try await eventually { rig.player.recordingAudio == .unavailable }
        #expect(rig.queue.calls.isEmpty)
        #expect(rig.player.isLoaded)
    }

    @Test func aQueuedTrackIsRefusedDuringATake() async throws {
        let rig = rig()
        rig.player.isCapturing = { true }
        #expect(!rig.player.playQueued(recordingItem(), nowPlaying: queuedNowPlaying))
        #expect(!rig.player.isLoaded)
        #expect(rig.queue.calls.isEmpty)
    }

    @Test func aSyncedSongAddressLoadsGuardedForTheQueue() async throws {
        let rig = rig()
        try await queueSong(rig)
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        rig.player.linkChanged(id: "l1", to: row)
        try await eventually { rig.music.loaded.count == 2 && rig.player.linkAudio == .native }
        #expect(rig.music.loaded.last == .song(id: "1440833095"))
        #expect(rig.music.guardedLoads == [true, true])
        #expect(rig.player.queue === rig.queue)
        // The song still reports its end, so the queue moves on.
        rig.music.end(.finished)
        #expect(rig.queue.ends == [.finished])
    }

    @Test func aSyncedSongAddressKeepsAPausedQueuedSongPaused() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.music.pause()
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        rig.player.linkChanged(id: "l1", to: row)
        try await eventually { rig.music.loaded.count == 2 && rig.player.linkAudio == .native }
        #expect(rig.music.guardedLoads == [true, true])
        #expect(!rig.music.isPlaying)
    }

    @Test func aSyncedSongAddressKeepsAPlayingQueuedSongPlaying() async throws {
        let rig = rig()
        try await queueSong(rig)
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833095"
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: moved, provider: "apple_music", providerRef: detectProvider(moved).providerRef)
        rig.player.linkChanged(id: "l1", to: row)
        try await eventually { rig.music.loaded.count == 2 && rig.music.isPlaying }
        #expect(rig.music.guardedLoads == [true, true])
    }

    @Test func aSyncedAddressThatIsNoLongerASongReportsCouldNotPlay() async throws {
        let rig = rig()
        try await queueSong(rig)
        let row = RecordingLink(
            id: "l1", tuneID: "t1", url: queuedAlbum, provider: "apple_music",
            providerRef: detectProvider(queuedAlbum).providerRef)
        rig.player.linkChanged(id: "l1", to: row)
        #expect(rig.queue.calls == ["couldNotPlay"])
        #expect(!rig.player.isLoaded)
        #expect(rig.music.loaded.count == 1)
        #expect(rig.player.queue === rig.queue)
    }

    @Test func aQueuedRecordingDeletedBySyncReportsCouldNotPlay() async throws {
        let rig = rig()
        try await queueRecording(rig)
        var row = try #require(recordingItem().recording)
        row.deletedAt = noon
        rig.player.recordingChanged(id: "r1", to: row, audioFile: nil, tuneTitle: "Kitchen Girl")
        #expect(rig.queue.calls == ["couldNotPlay"])
        #expect(!rig.player.isLoaded)
        #expect(rig.player.queue === rig.queue)
    }

    @Test func aQueuedSongWhoseLinkIsGoneReportsCouldNotPlay() async throws {
        let rig = rig()
        try await queueSong(rig)
        rig.player.linkChanged(id: "l1", to: nil)
        #expect(rig.queue.calls == ["couldNotPlay"])
        #expect(!rig.player.isLoaded)
        #expect(rig.player.queue === rig.queue)
    }

    @Test func aQueuedReplaceKeepsTheOpenPlayer() async throws {
        let rig = rig()
        let window = UUID()
        try await queueRecording(rig)
        rig.player.expand(in: window)
        try await queueSong(rig)
        #expect(rig.player.isExpanded)
        #expect(rig.player.expandedWindow == window)
        try await queueRecording(rig)
        #expect(rig.player.showsExpanded(in: window))
    }

    @Test func aQueuedTrackThatCannotPlayKeepsTheOpenPlayerForTheNext() async throws {
        let rig = rig()
        let window = UUID()
        try await queueRecording(rig)
        rig.player.expand(in: window)
        rig.music.found = false
        rig.player.playQueued(try songItem(), nowPlaying: queuedNowPlaying)
        try await eventually { rig.queue.calls == ["couldNotPlay"] }
        try await queueRecording(rig)
        #expect(rig.player.showsExpanded(in: window))
    }
}
