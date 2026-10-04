import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PracticeLogTests {
    private let clock = ActivityClock()
    private let recorded = ActivityRecorded()

    private func makeLog() -> PracticeLog {
        let clock = clock
        let recorded = recorded
        return PracticeLog(clock: { clock.instant }, now: { clock.date }, write: { recorded.writer.practice($0) })
    }

    @Test func aLoopSessionIsPractice() throws {
        let log = makeLog()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        clock.advance(1_000)
        let startedAt = clock.timestamp
        log.playing(true)
        log.usedLoop("loop-1")
        clock.advance(8_000)
        log.usedLoop("loop-2")
        log.usedLoop("loop-1")
        clock.advance(4_000)
        log.playing(false)
        #expect(log.close() == .practice)
        let session = try #require(recorded.sessions.only)
        #expect(session.recordingID == "rec-1")
        #expect(session.startedAt == startedAt)
        #expect(session.durationMs == 12_000)
        #expect(session.loopIDs == ["loop-1", "loop-2"])
        #expect(session.speedPercent == 100)
        #expect(session.pitchCents == 0)
        #expect(session.createdAt == clock.timestamp)
    }

    @Test func aSlowedDownSessionIsPracticeAtTheLongestSpeed() throws {
        let log = makeLog()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        log.playing(true)
        clock.advance(5_000)
        log.setSpeed(75)
        clock.advance(20_000)
        log.setSpeed(90)
        log.setPitch(-100)
        clock.advance(6_000)
        #expect(log.close() == .practice)
        let session = try #require(recorded.sessions.only)
        #expect(session.durationMs == 31_000)
        #expect(session.loopIDs.isEmpty)
        #expect(session.speedPercent == 75)
        #expect(session.pitchCents == 0)
    }

    @Test func aSettingChangedWhilePausedCountsOnlyOnceItPlays() {
        let log = makeLog()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        log.setSpeed(50)
        clock.advance(60_000)
        log.setSpeed(100)
        log.playing(true)
        clock.advance(30_000)
        #expect(log.close() == .play)
        #expect(recorded.sessions.isEmpty)
    }

    @Test func defaultSettingsFallBackToAPlay() {
        let log = makeLog()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        log.playing(true)
        clock.advance(40_000)
        #expect(log.close() == .play)
        #expect(recorded.sessions.isEmpty)
    }

    @Test func practiceUnderTenSecondsWritesNothing() {
        let log = makeLog()
        log.open("rec-1", speedPercent: 80, pitchCents: 0)
        log.playing(true)
        clock.advance(9_000)
        #expect(log.close() == nil)
        #expect(recorded.sessions.isEmpty)
    }

    @Test func closingResetsForTheNextVisit() {
        let log = makeLog()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        log.playing(true)
        log.usedLoop("loop-1")
        clock.advance(12_000)
        log.close()
        log.open("rec-1", speedPercent: 100, pitchCents: 0)
        log.playing(true)
        clock.advance(12_000)
        #expect(log.close() == .play)
        #expect(recorded.sessions.count == 1)
    }
}

private func loop(_ id: String) -> RecordingLoop {
    RecordingLoop(
        id: id, createdAt: noon, updatedAt: noon, recordingID: "r1", label: nil, startMs: 1_000, endMs: 5_000,
        color: 0)
}

/// The recording screen's visits, as the player's activity sees them.
@MainActor
@Suite struct RecordingScreenPracticeTests {
    private let noLoopWrites = LoopWriter(
        add: { _, _ in throw CancellationError() }, update: { _, _, _ in }, remove: { _ in })

    @Test func openingTheScreenEndsTheDockPlayAndAnOrdinaryVisitIsAScreenPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording(origin: .row)
        rig.clock.advance(15_000)
        rig.player.screenOpened("r1")
        #expect(rig.recorded.plays.map(\.context) == ["row"])
        #expect(rig.recorded.plays.map(\.listenedMs) == [15_000])
        rig.clock.advance(12_000)
        rig.player.screenClosed()
        #expect(rig.recorded.plays.map(\.context) == ["row", "recording_screen"])
        #expect(rig.recorded.plays.last?.listenedMs == 12_000)
        #expect(rig.recorded.sessions.isEmpty)
    }

    @Test func aSlowedDownVisitIsPracticeAndNotAlsoAPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(20_000)
        rig.player.screenClosed()
        #expect(rig.recorded.plays.isEmpty)
        let session = try #require(rig.recorded.sessions.only)
        #expect(session.recordingID == "r1")
        #expect(session.speedPercent == 80)
        #expect(session.durationMs == 20_000)
    }

    @Test func anotherRecordingPlayingWhileTheScreenShowsCountsTowardNoVisit() async throws {
        let rig = ActivityRig()
        try await rig.playRecording("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.player.screenOpened("r2")
        // A pause and resume from the lock screen, while r1 is still the one loaded.
        try await rig.pause()
        try await rig.resume()
        rig.clock.advance(20_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.isEmpty)
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func aLoopPlayedOnTheScreenIsPractice() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.loopsChanged(id: "r1", to: [loop("loop1")])
        rig.player.loops.select("loop1")
        try await rig.fed { $0.loopID == "loop1" }
        rig.clock.advance(12_000)
        rig.player.screenClosed()
        #expect(rig.recorded.plays.isEmpty)
        #expect(rig.recorded.sessions.only?.loopIDs == ["loop1"])
    }

    @Test func playingOnInTheDockAfterTheScreenIsAFreshPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(20_000)
        rig.player.screenClosed()
        rig.clock.advance(11_000)
        rig.player.close()
        #expect(rig.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(rig.recorded.plays.map(\.context) == ["dock"])
        #expect(rig.recorded.plays.map(\.listenedMs) == [11_000])
    }

    @Test func trimTimeYieldsNoPlay() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        // The trim screen plays at normal speed and pitch while it shows.
        rig.player.hold("r1", PlaybackSettings(speedPercent: 100, pitchCents: 0))
        try await rig.fed { $0.trimming && $0.playing }
        rig.clock.advance(30_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.isEmpty)
        #expect(rig.recorded.plays.isEmpty)
        // Playing on in the dock afterward is a play of its own.
        rig.player.hold("r1", nil)
        rig.clock.advance(11_000)
        rig.player.close()
        #expect(rig.recorded.plays.map(\.context) == ["dock"])
        #expect(rig.recorded.plays.map(\.listenedMs) == [11_000])
    }

    @Test func leavingTheForegroundPausedOnTheScreenWritesThePracticeSoFar() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(20_000)
        try await rig.pause()
        rig.player.leftForeground()
        #expect(rig.recorded.sessions.map(\.durationMs) == [20_000])
        // The screen still open starts a visit of its own.
        try await rig.resume()
        rig.clock.advance(15_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.map(\.durationMs) == [20_000, 15_000])
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func leavingTheForegroundPlayingOnTheScreenKeepsOneVisit() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(20_000)
        rig.player.leftForeground()
        #expect(rig.recorded.sessions.isEmpty)
        rig.clock.advance(15_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.map(\.durationMs) == [35_000])
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func closingThePlayerOnTheScreenDecidesTheVisitOnce() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        rig.player.screenOpened("r1")
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(20_000)
        rig.player.close()
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(rig.recorded.plays.isEmpty)
    }

    @Test func theVisitFollowsTheLoadedRecordingWhenItChanges() async throws {
        let rig = ActivityRig()
        try await rig.playRecording("r1")
        let first = PracticeModel(player: rig.player, recording: loggedTake("r1"), file: nil, writer: noLoopWrites)
        first.enter()
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(12_000)
        // A playlist moves on while the screen shows; the screen's view, keyed by recording,
        // is made again for the new one.
        rig.player.playQueued(
            .recording(loggedTake("r2"), tuneTitle: nil), nowPlaying: NowPlaying(title: "r2", tuneTitle: nil))
        #expect(rig.recorded.sessions.map(\.recordingID) == ["r1"])
        first.leave()
        let second = PracticeModel(player: rig.player, recording: loggedTake("r2"), file: nil, writer: noLoopWrites)
        second.enter()
        #expect(rig.player.activity.screenRecordingID == "r2")
        try await waitFor { rig.audio.isPlaying && rig.player.item?.id == "r2" }
        rig.player.setSpeed(70)
        try await rig.fed { $0.playing && $0.speedPercent == 70 }
        rig.clock.advance(15_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.map(\.recordingID) == ["r1", "r2"])
        #expect(rig.recorded.sessions.map(\.durationMs) == [12_000, 15_000])
    }

    @Test func showingTheScreenAgainCarriesOnItsVisit() async throws {
        let rig = ActivityRig()
        try await rig.playRecording()
        let model = PracticeModel(player: rig.player, recording: loggedTake(), file: nil, writer: noLoopWrites)
        model.enter()
        rig.player.setSpeed(80)
        try await rig.fed { $0.speedPercent == 80 }
        rig.clock.advance(10_000)
        // As on coming back from the trim screen.
        model.leave()
        model.enter()
        rig.clock.advance(10_000)
        rig.player.screenClosed()
        #expect(rig.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(rig.recorded.sessions.map(\.speedPercent) == [80])
        #expect(rig.recorded.plays.isEmpty)
    }
}
