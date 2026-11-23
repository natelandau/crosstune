import CrosstuneRecordingActivity
import Testing

@testable import CrosstuneWidgetData

struct RecordingsWidgetModeTests {
    enum Expected: Sendable {
        case premium, ready, live
    }

    @Test(
        arguments: [
            (true, nil, Expected.ready),
            (false, nil, .premium),
            (true, RecordingActivityState.Status.notRecording, .ready),
            (false, .notRecording, .premium),
            (true, .recording, .live),
            (true, .interrupted, .live),
            (true, .saving, .live),
            (true, .saved, .live),
            (true, .failed, .live),
            (false, .recording, .live),
        ] as [(Bool, RecordingActivityState.Status?, Expected)])
    func theModeFollowsThePlanAndTheRecording(
        recordingsPlay: Bool, status: RecordingActivityState.Status?, expected: Expected
    ) {
        let recording = status.map { RecordingActivityState(status: $0, timerStart: nil, elapsed: 5, canResume: false) }
        let summary = WidgetSummary(
            recordingsPlay: recordingsPlay, recordings: [], lists: [], tunerReferenceLabel: nil, recording: recording,
            recordingFreshUntil: nil, listPlayback: nil)
        let mode = RecordingsWidgetMode(summary)
        switch expected {
        case .premium: #expect(mode == .premium)
        case .ready: #expect(mode == .ready)
        case .live: #expect(mode == recording.map(RecordingsWidgetMode.live))
        }
    }
}
