import Foundation

/// What the recording Live Activity shows. Holds nothing that names the tune or the recording.
public struct RecordingActivityState: Codable, Hashable, Sendable {
    public enum Status: String, Codable, Sendable {
        case recording, interrupted, saving, saved, failed
        /// Shown by the widget once a recording goes stale. The app never sends it.
        case notRecording
    }

    public var status: Status
    /// Set only while recording, so the system counts the time up without updates.
    public var timerStart: Date?
    /// Shown when `timerStart` is nil, and held once the activity goes stale.
    public var elapsed: TimeInterval
    public var canResume: Bool

    public init(status: Status, timerStart: Date?, elapsed: TimeInterval, canResume: Bool) {
        self.status = status
        self.timerStart = timerStart
        self.elapsed = elapsed
        self.canResume = canResume
    }

    /// What a stale activity shows: the app stopped, so nothing records and nothing can be done.
    public var stale: RecordingActivityState {
        RecordingActivityState(status: .notRecording, timerStart: nil, elapsed: elapsed, canResume: false)
    }
}
