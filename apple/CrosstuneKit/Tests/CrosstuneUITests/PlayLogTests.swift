import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// A clock a test moves by hand: the monotonic instant audible time is measured on, and the wall
/// time a play or session starts at, moved together.
@MainActor
final class ActivityClock {
    private(set) var instant = SuspendingClock.now
    private(set) var date = noon.date

    func advance(_ milliseconds: Int64) {
        instant += .milliseconds(milliseconds)
        date += Double(milliseconds) / 1000
    }

    var timestamp: Timestamp { Timestamp(date) }
}

/// What the player wrote, in order.
@MainActor
final class ActivityRecorded {
    private(set) var plays: [PlayEvent] = []
    private(set) var sessions: [PracticeSession] = []

    var writer: ActivityWriter {
        ActivityWriter(
            owner: ObjectIdentifier(self), play: { [self] in plays.append($0) },
            practice: { [self] in sessions.append($0) })
    }
}

@MainActor
func waitFor(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

/// A player on fakes, timed on a test clock, writing what it logs to `recorded`.
@MainActor
struct ActivityRig {
    let clock: ActivityClock
    let audio = FakeAudio()
    let music = FakeMusic()
    let recorded = ActivityRecorded()
    let player: PlayerModel

    init() {
        let clock = ActivityClock()
        self.clock = clock
        player = PlayerModel(
            audio: audio, appleMusic: AppleMusic(access: FakeAccess(.fullTracks), player: music),
            clock: { clock.instant }, now: { clock.date })
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
        audio.duration = 60
        player.activityWriter = recorded.writer
    }

    /// Waits until the player's activity has been told of a state that meets `condition`.
    func fed(_ condition: @MainActor (ActivitySnapshot) -> Bool) async throws {
        try await waitFor { player.activity.lastFed.map(condition) ?? false }
    }

    /// Waits until the play log has heard the player start or stop.
    func heard(playing: Bool) async throws {
        try await fed { $0.playing == playing }
    }

    /// Plays recording `id` from `origin` and waits until its audio plays and is being timed.
    func playRecording(_ id: String = "r1", tuneID: String? = "t1", origin: PlayOrigin = .row) async throws {
        player.play(.recording(loggedTake(id, tuneID: tuneID), tuneTitle: nil), origin: origin)
        try await waitFor { audio.isPlaying }
        try await heard(playing: true)
    }

    func pause() async throws {
        player.transport?.pause()
        try await heard(playing: false)
    }

    func resume() async throws {
        player.transport?.play()
        try await heard(playing: true)
    }
}

func loggedTake(_ id: String = "r1", tuneID: String? = "t1") -> Recording {
    Recording(
        id: id, tuneID: tuneID, source: "microphone", recordedAt: noon, label: "Jam", state: "ready",
        sourceDurationMs: 60_000, speedPercent: 100, pitchCents: 0)
}

private let songURL = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833090"

private func link(
    _ id: String = "l1", url: String = songURL, provider: String = "apple_music"
) -> RecordingLink {
    RecordingLink(id: id, tuneID: "t1", url: url, provider: provider, providerRef: detectProvider(url).providerRef)
}

@MainActor
@Suite struct PlayLogTests {
    private let clock = ActivityClock()
    private let recorded = ActivityRecorded()
    private let recording = PlaySubject(kind: .recording, id: "rec-1")

    private func makeLog() -> PlayLog {
        let clock = clock
        let recorded = recorded
        return PlayLog(clock: { clock.instant }, now: { clock.date }, write: { recorded.writer.play($0) })
    }

    @Test func writesNothingUnderTenSeconds() {
        let log = makeLog()
        log.start(recording, origin: .row, lengthMs: 60_000)
        log.playing(true)
        clock.advance(9_999)
        log.playing(false)
        log.end()
        #expect(recorded.plays.isEmpty)
    }

    @Test func writesAPlayAtTenSeconds() throws {
        let log = makeLog()
        let startedAt = clock.timestamp
        log.start(recording, origin: .row, lengthMs: 60_000)
        log.playing(true)
        clock.advance(10_000)
        log.end()
        let play = try #require(recorded.plays.only)
        #expect(play.recordingID == "rec-1")
        #expect(play.linkID == nil)
        #expect(play.context == "row")
        #expect(play.listID == nil)
        #expect(play.startedAt == startedAt)
        #expect(play.listenedMs == 10_000)
        #expect(play.createdAt == clock.timestamp)
    }

    @Test func aShortItemPlayedToTheEndCounts() {
        let log = makeLog()
        log.start(recording, origin: .dock, lengthMs: 4_000)
        log.playing(true)
        clock.advance(4_000)
        log.playing(false)
        log.end()
        #expect(recorded.plays.map(\.listenedMs) == [4_000])
    }

    @Test func theWholeItemIsScaledByPlaybackSpeed() {
        #expect(heardLengthMs(6_000, speedPercent: 100) == 6_000)
        #expect(heardLengthMs(6_000, speedPercent: 150) == 4_000)
        #expect(heardLengthMs(6_000, speedPercent: 50) == 12_000)
    }

    @Test func pauseAndResumeIsOnePlay() throws {
        let log = makeLog()
        log.start(recording, origin: .row, lengthMs: 60_000)
        clock.advance(500)
        let startedAt = clock.timestamp
        log.playing(true)
        clock.advance(6_000)
        log.playing(false)
        // Paused time is not audible.
        clock.advance(30_000)
        log.playing(true)
        clock.advance(6_000)
        log.end()
        let play = try #require(recorded.plays.only)
        #expect(play.startedAt == startedAt)
        #expect(play.listenedMs == 12_000)
    }

    @Test func aNewItemEndsThePreviousOne() {
        let log = makeLog()
        log.start(recording, origin: .row, lengthMs: 60_000)
        log.playing(true)
        clock.advance(15_000)
        log.start(PlaySubject(kind: .recording, id: "rec-2"), origin: .row, lengthMs: 60_000)
        #expect(recorded.plays.map(\.recordingID) == ["rec-1"])
        #expect(recorded.plays.map(\.listenedMs) == [15_000])
        #expect(log.current?.id == "rec-2")
        // The new item starts paused; only a fresh playing signal counts toward it.
        clock.advance(20_000)
        log.end()
        #expect(recorded.plays.count == 1)
    }

    @Test func keepsTheContextAndListID() throws {
        let log = makeLog()
        log.start(recording, origin: .list(id: "list-1"), lengthMs: 60_000)
        log.playing(true)
        clock.advance(11_000)
        log.end()
        let play = try #require(recorded.plays.only)
        #expect(play.context == "list")
        #expect(play.listID == "list-1")
        #expect(play.listenedMs == 11_000)
    }

    @Test func anUnknownLengthWaitsForTenSeconds() {
        let log = makeLog()
        log.start(recording, origin: .row)
        log.playing(true)
        clock.advance(5_000)
        log.end()
        #expect(recorded.plays.isEmpty)
    }

    @Test func takesTheLengthOnceLoaded() {
        let log = makeLog()
        log.start(recording, origin: .row)
        log.setLength(3_000)
        log.playing(true)
        clock.advance(3_000)
        log.end()
        #expect(recorded.plays.map(\.listenedMs) == [3_000])
    }

    @Test func flushWritesTheOpenPlayAndOpensAFreshOne() throws {
        let log = makeLog()
        log.start(recording, origin: .list(id: "list-1"), lengthMs: 60_000)
        log.playing(true)
        clock.advance(20_000)
        log.flush()
        #expect(recorded.plays.map(\.listenedMs) == [20_000])
        #expect(log.current == recording)
        let resumedAt = clock.timestamp
        log.playing(true)
        clock.advance(12_000)
        log.end()
        let second = try #require(recorded.plays.last)
        #expect(recorded.plays.count == 2)
        #expect(second.context == "list")
        #expect(second.listID == "list-1")
        #expect(second.startedAt == resumedAt)
    }

    @Test func dropForgetsTheOpenPlay() {
        let log = makeLog()
        log.start(recording, origin: .row, lengthMs: 60_000)
        log.playing(true)
        clock.advance(30_000)
        log.drop()
        log.end()
        #expect(recorded.plays.isEmpty)
        #expect(log.current == nil)
    }

    @Test func aLinkPlayNamesTheLink() throws {
        let log = makeLog()
        log.start(PlaySubject(kind: .link, id: "link-1"), origin: .row, lengthMs: 200_000)
        log.playing(true)
        clock.advance(10_000)
        log.end()
        let play = try #require(recorded.plays.only)
        #expect(play.linkID == "link-1")
        #expect(play.recordingID == nil)
    }
}

@MainActor
@Suite struct PlayerPlayLogTests {
    private let suite = TemporaryDefaults("PlayLogTests")

    @Test func aRecordingPlayedFromARowIsLogged() async throws {
        let rig = ActivityRig()
        try await rig.playRecording(origin: .row)
        rig.clock.advance(12_000)
        rig.player.close()
        let play = try #require(rig.recorded.plays.only)
        #expect(play.recordingID == "r1")
        #expect(play.context == "row")
        #expect(play.listenedMs == 12_000)
    }

    @Test func aPausedOpenLogsNoPlay() async throws {
        let rig = ActivityRig()
        rig.player.open(.recording(loggedTake(), tuneTitle: nil), playing: false)
        try await waitFor { rig.player.recordingAudio == .loaded }
        try await rig.heard(playing: false)
        rig.clock.advance(30_000)
        rig.player.isExpanded = false
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func pauseAndResumeOnTheSameRecordingIsOnePlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(6_000)
        try await rig.pause()
        rig.clock.advance(60_000)
        try await rig.resume()
        rig.clock.advance(6_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [12_000])
    }

    @Test func startingAnotherItemEndsTheCurrentPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording("r1")
        rig.clock.advance(15_000)
        rig.player.play(.recording(loggedTake("r2"), tuneTitle: nil))
        #expect(rig.recorded.plays.map(\.recordingID) == ["r1"])
        #expect(rig.recorded.plays.map(\.listenedMs) == [15_000])
    }

    @Test func aReplayAfterTheEndIsASecondPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(20_000)
        rig.audio.end(.finished)
        #expect(rig.recorded.plays.map(\.listenedMs) == [20_000])
        try await rig.heard(playing: false)
        try await rig.resume()
        rig.clock.advance(11_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [20_000, 11_000])
    }

    @Test func appleMusicNativePlayIsLogged() async throws {
        let rig = ActivityRig()
        rig.music.duration = 200
        rig.player.play(try #require(PlayerItem.link(link())), origin: .row)
        try await waitFor { rig.player.linkAudio == .native }
        try await rig.heard(playing: true)
        rig.clock.advance(30_000)
        try await rig.pause()
        rig.player.close()
        let play = try #require(rig.recorded.plays.only)
        #expect(play.linkID == "l1")
        #expect(play.recordingID == nil)
        #expect(play.context == "row")
        #expect(play.listenedMs == 30_000)
    }

    @Test func embedPlayIsNotLogged() async throws {
        let rig = ActivityRig()
        let video = link(url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube")
        rig.player.play(try #require(PlayerItem.link(video)), origin: .row)
        #expect(rig.player.embed != nil)
        rig.clock.advance(60_000)
        rig.player.close()
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func listPlaybackLogsListContext() async throws {
        let rig = ActivityRig()
        let playback = ListPlayback(player: rig.player, commands: NoTrackCommands(), defaults: suite.defaults)
        playback.resolve = { _, tuneID in
            ListPlayback.Turn(
                title: "Tune \(tuneID)", item: .recording(loggedTake("r\(tuneID)", tuneID: tuneID), tuneTitle: nil))
        }
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        try await waitFor { rig.audio.isPlaying && rig.player.item?.id == "ra" }
        try await rig.heard(playing: true)
        rig.clock.advance(15_000)
        rig.audio.end(.finished)
        try await waitFor { rig.player.item?.id == "rb" }
        let play = try #require(rig.recorded.plays.only)
        #expect(play.recordingID == "ra")
        #expect(play.context == "list")
        #expect(play.listID == "list1")
    }

    private func playlist(_ rig: ActivityRig, _ items: [String: PlayerItem]) throws -> ListPlayback {
        let playback = ListPlayback(player: rig.player, commands: NoTrackCommands(), defaults: suite.defaults)
        playback.resolve = { _, tuneID in items[tuneID].map { ListPlayback.Turn(title: "Tune \(tuneID)", item: $0) } }
        return playback
    }

    @Test func aPlaylistSongLogsItsListAndLink() async throws {
        let rig = ActivityRig()
        rig.music.duration = 200
        let playback = try playlist(rig, ["a": try #require(PlayerItem.link(link()))])
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a"], shuffled: false)
        try await waitFor { rig.player.linkAudio == .native }
        try await rig.heard(playing: true)
        rig.clock.advance(12_000)
        playback.end()
        rig.player.close()
        let play = try #require(rig.recorded.plays.only)
        #expect(play.linkID == "l1")
        #expect(play.recordingID == nil)
        #expect(play.context == "list")
        #expect(play.listID == "list1")
        #expect(play.listenedMs == 12_000)
    }

    @Test func aSyncedAddressChangeKeepsTheQueuedSongsPlay() async throws {
        let rig = ActivityRig()
        rig.music.duration = 200
        let playback = try playlist(rig, ["a": try #require(PlayerItem.link(link()))])
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a"], shuffled: false)
        try await waitFor { rig.player.linkAudio == .native }
        try await rig.heard(playing: true)
        rig.clock.advance(6_000)
        let moved = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833099"
        rig.player.linkChanged(id: "l1", to: link(url: moved))
        #expect(rig.recorded.plays.isEmpty)
        try await waitFor { rig.player.linkAudio == .native && rig.music.isPlaying }
        try await rig.heard(playing: true)
        rig.clock.advance(6_000)
        playback.end()
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [12_000])
        #expect(rig.recorded.plays.map(\.listID) == ["list1"])
    }

    @Test func anAppleMusicSongStoppingAtItsEndCountsAReplayAsASecondPlay() async throws {
        let rig = ActivityRig()
        rig.music.duration = 200
        rig.player.play(try #require(PlayerItem.link(link())), origin: .row)
        try await waitFor { rig.player.linkAudio == .native }
        try await rig.heard(playing: true)
        rig.clock.advance(30_000)
        // MusicKit stops at the end of a song played on its own without reporting an end.
        rig.music.elapsed = 199.6
        rig.music.isPlaying = false
        try await waitFor { rig.recorded.plays.count == 1 }
        #expect(rig.recorded.plays.map(\.listenedMs) == [30_000])
        try await rig.heard(playing: false)
        rig.music.elapsed = 0
        try await rig.resume()
        rig.clock.advance(11_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [30_000, 11_000])
    }

    @Test func aPauseBeforeTheEndKeepsOnePlay() async throws {
        let rig = ActivityRig()
        rig.music.duration = 200
        rig.player.play(try #require(PlayerItem.link(link())), origin: .row)
        try await waitFor { rig.player.linkAudio == .native }
        try await rig.heard(playing: true)
        rig.clock.advance(6_000)
        rig.music.elapsed = 150
        try await rig.pause()
        try await rig.resume()
        rig.clock.advance(6_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [12_000])
    }

    @Test func backgroundWhilePausedFlushesThePlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(14_000)
        try await rig.pause()
        rig.player.leftForeground()
        #expect(rig.recorded.plays.map(\.listenedMs) == [14_000])
        // What plays after coming back is a play of its own.
        try await rig.resume()
        rig.clock.advance(3_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [14_000])
    }

    @Test func backgroundWhilePlayingKeepsOnePlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(8_000)
        rig.player.leftForeground()
        #expect(rig.recorded.plays.isEmpty)
        rig.clock.advance(8_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [16_000])
    }

    @Test func leavingTheStoreDropsTheOpenPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(30_000)
        rig.player.leaveStore()
        #expect(rig.recorded.plays.isEmpty)
        #expect(rig.player.activityWriter == nil)
    }

    @Test func anotherStoresWriterDropsTheOpenPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(30_000)
        let other = ActivityRecorded()
        rig.player.activityWriter = other.writer
        rig.player.close()
        #expect(rig.recorded.plays.isEmpty)
        #expect(other.plays.isEmpty)
    }

    @Test func theSameStoresWriterKeepsTheOpenPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.clock.advance(30_000)
        rig.player.activityWriter = rig.recorded.writer
        rig.player.close()
        #expect(rig.recorded.plays.map(\.listenedMs) == [30_000])
    }
}

/// Offers no next or previous to the system.
@MainActor
private final class NoTrackCommands: TrackCommands {
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
    func disable() {}
}

@MainActor
@Suite struct StoreActivityWriterTests {
    private let root = TemporaryRoot()

    @Test func recordsAPlayUnderItsRecordingsTuneWithoutStartingASync() async throws {
        let store = try root.open()
        try await store.database.write { db in
            try Tune(id: "t1", title: "Silver Spear").insert(db)
            try loggedTake("r1", tuneID: "t1").insert(db)
            try link("l1").insert(db)
        }
        let writer = ActivityWriter.store(store)
        writer.play(PlayEvent(context: "row", startedAt: noon, listenedMs: 12_000, recordingID: "r1"))
        writer.play(PlayEvent(context: "row", startedAt: noon, listenedMs: 12_000, linkID: "l1"))
        writer.practice(
            PracticeSession(recordingID: "r1", startedAt: noon, durationMs: 12_000, speedPercent: 80, pitchCents: 0))
        let stored = { try await store.read { db in (try PlayEvent.fetchAll(db), try PracticeSession.fetchAll(db)) } }
        try await waitFor(async: {
            let (plays, sessions) = try await stored()
            return plays.count == 2 && sessions.count == 1
        })
        let (plays, sessions) = try await stored()
        #expect(plays.map(\.tuneID) == ["t1", "t1"])
        #expect(sessions.map(\.tuneID) == ["t1"])
    }
}

@MainActor
private func waitFor(async condition: () async throws -> Bool) async throws {
    if try await poll(condition) { return }
    Issue.record("The condition never held")
}

extension Array {
    /// The one element, or nil when there are none or several.
    var only: Element? { count == 1 ? first : nil }
}
