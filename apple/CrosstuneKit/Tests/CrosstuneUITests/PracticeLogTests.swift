import CrosstuneAnalytics
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
        let fixture = ActivityFixture()
        try await fixture.playRecording(origin: .row)
        fixture.clock.advance(15_000)
        fixture.player.screenOpened("r1")
        #expect(fixture.recorded.plays.map(\.context) == ["row"])
        #expect(fixture.recorded.plays.map(\.listenedMs) == [15_000])
        fixture.clock.advance(12_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.plays.map(\.context) == ["row", "recording_screen"])
        #expect(fixture.recorded.plays.last?.listenedMs == 12_000)
        #expect(fixture.recorded.sessions.isEmpty)
    }

    @Test func aSlowedDownVisitIsPracticeAndNotAlsoAPlay() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(20_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.plays.isEmpty)
        let session = try #require(fixture.recorded.sessions.only)
        #expect(session.recordingID == "r1")
        #expect(session.speedPercent == 80)
        #expect(session.durationMs == 20_000)
    }

    @Test func onlyTheLatestScreenToOpenClosesTheVisit() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        let first = UUID()
        let second = UUID()
        fixture.player.screenOpened("r1", by: first)
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(5_000)
        // A second window shows the same recording, then the first window's screen goes.
        fixture.player.screenOpened("r1", by: second)
        fixture.player.screenClosed(by: first)
        fixture.clock.advance(15_000)
        #expect(fixture.recorded.sessions.isEmpty)

        fixture.player.screenClosed(by: second)
        let session = try #require(fixture.recorded.sessions.only)
        #expect(session.durationMs == 20_000)
    }

    @Test func anotherRecordingPlayingWhileTheScreenShowsCountsTowardNoVisit() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.player.screenOpened("r2")
        // A pause and resume from the lock screen, while r1 is still the one loaded.
        try await fixture.pause()
        try await fixture.resume()
        fixture.clock.advance(20_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.isEmpty)
        #expect(fixture.recorded.plays.isEmpty)
    }

    @Test func aLoopPlayedOnTheScreenIsPractice() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.loopsChanged(id: "r1", to: [loop("loop1")])
        fixture.player.loops.select("loop1")
        try await fixture.fed { $0.loopID == "loop1" }
        fixture.clock.advance(12_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.plays.isEmpty)
        #expect(fixture.recorded.sessions.only?.loopIDs == ["loop1"])
    }

    @Test func playingOnInTheDockAfterTheScreenIsAFreshPlay() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(20_000)
        fixture.player.screenClosed()
        fixture.clock.advance(11_000)
        fixture.player.close()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(fixture.recorded.plays.map(\.context) == ["dock"])
        #expect(fixture.recorded.plays.map(\.listenedMs) == [11_000])
    }

    @Test func trimTimeYieldsNoPlay() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        // The trim screen plays at normal speed and pitch while it shows.
        fixture.player.hold("r1", PlaybackSettings(speedPercent: 100, pitchCents: 0))
        try await fixture.fed { $0.trimming && $0.playing }
        fixture.clock.advance(30_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.isEmpty)
        #expect(fixture.recorded.plays.isEmpty)
        // Playing on in the dock afterward is a play of its own.
        fixture.player.hold("r1", nil)
        fixture.clock.advance(11_000)
        fixture.player.close()
        #expect(fixture.recorded.plays.map(\.context) == ["dock"])
        #expect(fixture.recorded.plays.map(\.listenedMs) == [11_000])
    }

    @Test func leavingTheForegroundPausedOnTheScreenWritesThePracticeSoFar() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(20_000)
        try await fixture.pause()
        fixture.player.leftForeground()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [20_000])
        // The screen still open starts a visit of its own.
        try await fixture.resume()
        fixture.clock.advance(15_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [20_000, 15_000])
        #expect(fixture.recorded.plays.isEmpty)
    }

    @Test func leavingTheForegroundPlayingOnTheScreenKeepsOneVisit() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(20_000)
        fixture.player.leftForeground()
        #expect(fixture.recorded.sessions.isEmpty)
        fixture.clock.advance(15_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [35_000])
        #expect(fixture.recorded.plays.isEmpty)
    }

    @Test func closingThePlayerOnTheScreenDecidesTheVisitOnce() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(20_000)
        fixture.player.close()
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(fixture.recorded.plays.isEmpty)
    }

    @Test func theVisitFollowsTheLoadedRecordingWhenItChanges() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording("r1")
        let first = PracticeModel(
            player: fixture.player, recording: loggedRecording("r1"), file: nil, writer: noLoopWrites)
        first.enter()
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(12_000)
        // A playlist moves on while the screen shows; the screen's view, keyed by recording,
        // is made again for the new one.
        fixture.player.playQueued(
            .recording(loggedRecording("r2"), tuneTitle: nil), nowPlaying: NowPlaying(title: "r2", tuneTitle: nil),
            trigger: .autoAdvance)
        #expect(fixture.recorded.sessions.map(\.recordingID) == ["r1"])
        first.leave()
        let second = PracticeModel(
            player: fixture.player, recording: loggedRecording("r2"), file: nil, writer: noLoopWrites)
        second.enter()
        #expect(fixture.player.activity.screenRecordingID == "r2")
        try await waitFor { fixture.audio.isPlaying && fixture.player.item?.id == "r2" }
        fixture.player.setSpeed(70)
        try await fixture.fed { $0.playing && $0.speedPercent == 70 }
        fixture.clock.advance(15_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.map(\.recordingID) == ["r1", "r2"])
        #expect(fixture.recorded.sessions.map(\.durationMs) == [12_000, 15_000])
    }

    @Test func showingTheScreenAgainCarriesOnItsVisit() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        let model = PracticeModel(player: fixture.player, recording: loggedRecording(), file: nil, writer: noLoopWrites)
        model.enter()
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 }
        fixture.clock.advance(10_000)
        // As on coming back from the trim screen.
        model.leave()
        model.enter()
        fixture.clock.advance(10_000)
        fixture.player.screenClosed()
        #expect(fixture.recorded.sessions.map(\.durationMs) == [20_000])
        #expect(fixture.recorded.sessions.map(\.speedPercent) == [80])
        #expect(fixture.recorded.plays.isEmpty)
    }
}

/// A recording screen visit reports once as it closes: as practice with the tools it used, or
/// as a play from the screen when it was not practice.
@MainActor
@Suite struct PracticeEndedTests {
    @Test func aPracticeVisitReportsTheToolsUsed() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.player.loopsChanged(id: "r1", to: [loop("loop1")])
        fixture.player.loops.select("loop1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.loopID == "loop1" && $0.speedPercent == 80 && $0.playing }
        fixture.clock.advance(120_000)
        fixture.player.screenClosed()
        try await waitFor { !fixture.sent("practice_ended").isEmpty }
        let report = try #require(fixture.sent("practice_ended").only)
        #expect(report["used_loops"] == .bool(true))
        #expect(report["used_speed"] == .bool(true))
        #expect(report["used_pitch"] == .bool(false))
        #expect(report["duration_bucket"] == .string("2-5m"))
        #expect(report["kind"] == .string("recorded"))
        #expect(report["recording_id"] == .string("r1"))
        #expect(fixture.sent("playback_ended").isEmpty)
    }

    @Test func aVisitThatWasNotPracticeIsAPlayFromTheScreen() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording()
        fixture.player.screenOpened("r1")
        fixture.clock.advance(12_000)
        fixture.player.screenClosed()
        try await waitFor { !fixture.sent("playback_ended").isEmpty }
        let report = try #require(fixture.sent("playback_ended").only)
        #expect(report["source"] == .string("recording_screen"))
        #expect(report["ended_by"] == .string("closed"))
        #expect(fixture.sent("practice_ended").isEmpty)
    }

    @Test func aRecordingFiledDuringThePracticeReportsItsNewTune() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording(tuneID: nil)
        fixture.player.screenOpened("r1")
        fixture.player.setSpeed(80)
        try await fixture.fed { $0.speedPercent == 80 && $0.playing }
        fixture.clock.advance(60_000)
        fixture.recorded.tunes["r1"] = "t9"
        fixture.player.screenClosed()
        try await waitFor { !fixture.sent("practice_ended").isEmpty }
        #expect(fixture.sent("practice_ended").only?["tune_id"] == .string("t9"))
    }

    @Test func aRecordingFiledDuringTheVisitReportsItsPlayUnderItsNewTune() async throws {
        let fixture = ActivityFixture()
        try await fixture.playRecording(tuneID: nil)
        fixture.player.screenOpened("r1")
        fixture.clock.advance(12_000)
        fixture.recorded.tunes["r1"] = "t9"
        fixture.player.screenClosed()
        try await waitFor { !fixture.sent("playback_ended").isEmpty }
        #expect(fixture.sent("playback_ended").only?["tune_id"] == .string("t9"))
    }
}
