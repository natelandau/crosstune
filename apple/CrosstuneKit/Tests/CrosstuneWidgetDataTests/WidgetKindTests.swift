import CrosstuneRecordingActivity
import Foundation
import Testing

@testable import CrosstuneWidgetData

/// A summary write reloads only the widgets that show what changed.
struct WidgetKindTests {
    private static let base = WidgetSummary(
        recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: nil, recording: nil,
        recordingFreshUntil: nil, listPlayback: nil)

    struct Change: Sendable, CustomTestStringConvertible {
        let testDescription: String
        let expected: Set<WidgetKind>
        let apply: @Sendable (inout WidgetSummary) -> Void
    }

    static let changes: [Change] = [
        Change(testDescription: "plan", expected: [.recordings]) { $0.recordingsPlay = false },
        Change(testDescription: "recordings", expected: [.recordings]) {
            $0.recordings = [
                WidgetRecording(
                    id: "r1", title: "Kesh", isUnfiled: false, recordedAt: .distantPast, recordedPrecision: .time,
                    duration: 60)
            ]
        },
        Change(testDescription: "recording state", expected: [.recordings]) {
            $0.recording = RecordingActivityState(status: .saving, timerStart: nil, elapsed: 3, canResume: false)
        },
        Change(testDescription: "recording fresh-until", expected: [.recordings]) {
            $0.recordingFreshUntil = .distantFuture
        },
        Change(testDescription: "lists", expected: [.list]) {
            $0.lists = [WidgetList(id: "l1", name: "Session", tunes: [])]
        },
        Change(testDescription: "list playback", expected: [.list]) {
            $0.listPlayback = WidgetListPlayback(
                listID: "l1", currentTuneID: "t1", isPlaying: true, position: 1, count: 1, nextTuneID: nil)
        },
        Change(testDescription: "tuner pitch", expected: [.tuner]) { $0.tunerReferenceLabel = "A4 = 442 Hz" },
        Change(testDescription: "nothing", expected: []) { _ in },
    ]

    @Test(arguments: changes)
    func aChangeReloadsTheKindsThatShowIt(_ change: Change) {
        var changed = Self.base
        change.apply(&changed)
        #expect(WidgetKind.showingChanges(from: Self.base, to: changed) == change.expected)
    }

    @Test func aFirstWriteReloadsEveryKind() {
        #expect(WidgetKind.showingChanges(from: nil, to: Self.base) == Set(WidgetKind.allCases))
    }
}
