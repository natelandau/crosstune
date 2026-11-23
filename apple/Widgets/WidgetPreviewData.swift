import CrosstuneRecordingActivity
import CrosstuneWidgetData
import Foundation

// Sample data for the widgets' previews only.
extension WidgetSummary {
    /// A signed-in summary for previews, with nothing in it but the tuner's reference pitch.
    static func preview(referenceLabel: String?) -> WidgetSummary {
        WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: referenceLabel, recording: nil,
            recordingFreshUntil: nil, listPlayback: nil)
    }

    /// A signed-in summary for the Recordings widget's previews.
    static func preview(
        recordingsPlay: Bool, recordings: [WidgetRecording], recording: RecordingActivityState?
    ) -> WidgetSummary {
        WidgetSummary(
            recordingsPlay: recordingsPlay, recordings: recordings, lists: [], tunerReferenceLabel: nil,
            recording: recording, recordingFreshUntil: nil, listPlayback: nil)
    }
}

extension WidgetRecording {
    private static let day: TimeInterval = 86_400

    /// The five newest recordings, filed and unfiled, from today and two days back.
    static let previewRecordings = [
        WidgetRecording(
            id: "r5", title: "Soldier's Joy", isUnfiled: false, recordedAt: .now.addingTimeInterval(-600),
            recordedPrecision: .time, duration: 161),
        WidgetRecording(
            id: "r4", title: "Recording 14", isUnfiled: true, recordedAt: .now.addingTimeInterval(-3_600),
            recordedPrecision: .time, duration: 362),
        WidgetRecording(
            id: "r3", title: "Big Sciota", isUnfiled: false, recordedAt: .now.addingTimeInterval(-2 * day),
            recordedPrecision: .time, duration: 95),
        WidgetRecording(
            id: "r2", title: "Cluck Old Hen", isUnfiled: false, recordedAt: .now.addingTimeInterval(-2 * day),
            recordedPrecision: .time, duration: 133),
        WidgetRecording(
            id: "r1", title: "Recording 13", isUnfiled: true, recordedAt: .now.addingTimeInterval(-10 * day),
            recordedPrecision: .time, duration: 1_204),
    ]

    /// A recording whose length is not known yet.
    static let previewRecordingWithNoLength = WidgetRecording(
        id: "r6", title: "Recording 15", isUnfiled: true, recordedAt: .now, recordedPrecision: .time, duration: nil)
}
