import Foundation

/// The recording labels and time format the app and its Live Activity share, so both read the same.
public enum RecordingActivityText {
    public static let recording = "Recording"
    public static let interrupted = "Interrupted"
    public static let saving = "Saving"
    public static let saved = "Saved"
    public static let notRecording = "Not recording"
    public static let stop = "Stop"
    public static let resume = "Resume"
    public static let saveFailed =
        "The recording could not be saved. It will be recovered the next time Crosstune opens."

    /// `m:ss`, rounded to the nearest second.
    public static func duration(of milliseconds: Int64) -> String {
        let total = wholeSeconds(of: milliseconds)
        let seconds = total % 60
        return "\(total / 60):\(seconds < 10 ? "0" : "")\(seconds)"
    }

    /// ``duration(of:)`` for a time in seconds.
    public static func duration(ofSeconds seconds: TimeInterval) -> String {
        duration(of: Int64((seconds * 1000).rounded()))
    }

    /// `milliseconds` rounded to the nearest second, the second ``duration(of:)`` shows.
    public static func wholeSeconds(of milliseconds: Int64) -> Int64 {
        Int64((Double(milliseconds) / 1000).rounded())
    }
}

extension RecordingActivityState.Status {
    /// What the activity says for this status.
    public var label: String {
        switch self {
        case .recording: RecordingActivityText.recording
        case .interrupted: RecordingActivityText.interrupted
        case .saving: RecordingActivityText.saving
        case .saved: RecordingActivityText.saved
        case .failed: RecordingActivityText.saveFailed
        case .notRecording: RecordingActivityText.notRecording
        }
    }
}
