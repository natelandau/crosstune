import CrosstuneRecording
import Foundation

/// The parts of a ``Recorder`` that the recording Live Activity follows.
public struct RecorderSnapshot: Equatable, Sendable {
    public var state: Recorder.State
    public var elapsed: TimeInterval
    public var resumeAvailable: Bool
    public var savedRecordingID: String?
    public var errorMessage: String?
    public var levels: [Float]
    public var levelCount: Int

    public init(
        state: Recorder.State, elapsed: TimeInterval, resumeAvailable: Bool, savedRecordingID: String?,
        errorMessage: String?, levels: [Float], levelCount: Int
    ) {
        self.state = state
        self.elapsed = elapsed
        self.resumeAvailable = resumeAvailable
        self.savedRecordingID = savedRecordingID
        self.errorMessage = errorMessage
        self.levels = levels
        self.levelCount = levelCount
    }

    @MainActor
    public init(_ recorder: Recorder) {
        self.init(
            state: recorder.state, elapsed: recorder.elapsed, resumeAvailable: recorder.resumeAvailable,
            savedRecordingID: recorder.savedRecordingID, errorMessage: recorder.errorMessage,
            levels: recorder.levels, levelCount: recorder.levelCount
        )
    }
}
