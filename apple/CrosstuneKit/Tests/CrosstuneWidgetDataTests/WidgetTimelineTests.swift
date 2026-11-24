import CrosstuneRecordingActivity
import Foundation
import Testing

@testable import CrosstuneWidgetData

struct WidgetTimelineTests {
    private static let now = Date(timeIntervalSince1970: 1_800_000_000)
    private static let recording = RecordingActivityState(
        status: .recording, timerStart: now.addingTimeInterval(-30), elapsed: 30, canResume: false)
    private static let playback = WidgetListPlayback(
        listID: "l1", currentTuneID: "t1", isPlaying: true, position: 1, count: 3, nextTuneID: "t2")

    private static func summary(recordingFreshUntil: Date?) -> WidgetSummary {
        WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: nil, recording: recording,
            recordingFreshUntil: recordingFreshUntil, listPlayback: playback)
    }

    private static func moment(_ date: Date, _ summary: WidgetSummary) -> WidgetMoment {
        WidgetMoment(date: date, current: .available(summary))
    }

    @Test(arguments: [CurrentWidgetSummary.signedOut, .unavailable])
    func noSummaryIsOneMomentNow(current: CurrentWidgetSummary) {
        #expect(WidgetTimeline.moments(for: current, now: Self.now) == [WidgetMoment(date: Self.now, current: current)])
    }

    @Test func aSummaryWithNoFreshUntilIsOneMomentNow() {
        let summary = Self.summary(recordingFreshUntil: nil)
        #expect(WidgetTimeline.moments(for: .available(summary), now: Self.now) == [Self.moment(Self.now, summary)])
    }

    @Test func aFreshUntilAddsTheStaleRecordingAtThatDate() {
        let freshUntil = Self.now.addingTimeInterval(120)
        let summary = Self.summary(recordingFreshUntil: freshUntil)
        var stale = summary
        stale.recording = Self.recording.stale
        #expect(
            WidgetTimeline.moments(for: .available(summary), now: Self.now) == [
                Self.moment(Self.now, summary), Self.moment(freshUntil, stale),
            ])
    }

    @Test func aPassedFreshUntilShowsTheStaleRecordingNow() {
        let summary = Self.summary(recordingFreshUntil: Self.now.addingTimeInterval(-1))
        var stale = summary
        stale.recording = Self.recording.stale
        #expect(WidgetTimeline.moments(for: .available(summary), now: Self.now) == [Self.moment(Self.now, stale)])
    }

    /// A paused list can stay paused for any time while the app is suspended, so it never
    /// expires on the widget's clock. Only the app ending clears it.
    @Test func aPausedListStaysWithNoExpiry() {
        var summary = Self.summary(recordingFreshUntil: nil)
        summary.recording = nil
        summary.listPlayback = WidgetListPlayback(
            listID: "l1", currentTuneID: "t1", isPlaying: false, position: 1, count: 3, nextTuneID: "t2")
        #expect(WidgetTimeline.moments(for: .available(summary), now: Self.now) == [Self.moment(Self.now, summary)])
    }

    @Test(arguments: [
        (RecordingActivityState.Status.recording, true), (.interrupted, false), (.saving, false), (.saved, false),
    ])
    func theAppEndingClearsListPlaybackAndEveryRecordingButOneUnderWay(
        status: RecordingActivityState.Status, keepsRecording: Bool
    ) {
        var summary = Self.summary(recordingFreshUntil: status == .recording ? Self.now : nil)
        summary.recording = RecordingActivityState(status: status, timerStart: nil, elapsed: 3, canResume: true)

        let ended = summary.afterAppEnded

        #expect(ended.listPlayback == nil)
        #expect((ended.recording != nil) == keepsRecording)
        #expect(ended.recordingFreshUntil == (keepsRecording ? Self.now : nil))
    }
}
