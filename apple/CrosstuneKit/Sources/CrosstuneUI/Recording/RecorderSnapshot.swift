import CrosstuneRecording
import Foundation

/// The parts of a ``Recorder`` that the recording Live Activity follows.
public struct RecorderSnapshot: Equatable, Sendable {
    public var state: Recorder.State
    public var elapsed: TimeInterval
    public var resumeAvailable: Bool
    public var savedRecordingID: String?
    public var errorMessage: String?

    public init(
        state: Recorder.State, elapsed: TimeInterval, resumeAvailable: Bool, savedRecordingID: String?,
        errorMessage: String?
    ) {
        self.state = state
        self.elapsed = elapsed
        self.resumeAvailable = resumeAvailable
        self.savedRecordingID = savedRecordingID
        self.errorMessage = errorMessage
    }

    @MainActor
    public init(_ recorder: Recorder) {
        self.init(
            state: recorder.state, elapsed: recorder.elapsed, resumeAvailable: recorder.resumeAvailable,
            savedRecordingID: recorder.savedRecordingID, errorMessage: recorder.errorMessage
        )
    }
}
