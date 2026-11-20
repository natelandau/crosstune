import Foundation
import Testing

@testable import CrosstuneRecordingActivity

@Test func staleRecordingShowsNotRecordingWithTheTimeHeld() {
    let recording = RecordingActivityState(
        status: .recording, timerStart: Date(timeIntervalSinceReferenceDate: 1_000), elapsed: 42,
        canResume: true, bars: [1, 2, 3, 4, 5, 6, 7, 8, 7, 6])

    #expect(
        recording.stale
            == RecordingActivityState(
                status: .notRecording, timerStart: nil, elapsed: 42, canResume: false,
                bars: RecordingActivityState.flatBars))
}
