import CrosstuneAudio
import Foundation
import Observation
import SwiftUI

/// Where the record sheet's take stands, read off its ``Recorder``.
public enum RecordPhase: Equatable, Sendable {
    /// Waiting on microphone permission and the capture file.
    case starting
    case recording
    /// A call or another app took the microphone; the take so far is kept.
    case interrupted
    case saving
    /// Saved with something to say about it, such as reaching the size limit.
    case saved
    /// Permission was refused, or the take could not start or be saved.
    case notRecording
}

/// One take in the record sheet: starts it when the sheet opens, and turns Stop and Cancel
/// into what the recorder does, as the web's record modal does.
@MainActor
@Observable
public final class RecordSheetModel {
    public static let title = "New recording"
    public static let startingMicrophone = "Starting the microphone"
    public static let interrupted = "Interrupted"
    public static let saving = "Saving"
    public static let saved = "Saved"
    public static let notRecording = "Not recording"
    public static let interruptedMessage = """
        Recording interrupted. A call or another app took the microphone. Stop to keep what you \
        have, or resume when it is free.
        """
    public static let stop = "Stop"
    public static let resume = "Resume"
    public static let cancel = "Cancel"
    public static let done = "Done"
    public static let openSettings = "Open Settings"
    public static let discardTitle = "Discard this recording?"
    public static let discardMessage = "The recording is not saved."
    public static let discard = "Discard"

    /// How a take ended, once the sheet should close.
    public enum Outcome: Equatable, Sendable {
        /// Saved as this recording.
        case saved(recordingID: String)
        /// Discarded, or never started.
        case dropped
    }

    public let recorder: Recorder
    public let tuneID: String?
    /// Set once the sheet should close.
    public private(set) var outcome: Outcome?
    /// True while the discard confirmation is up.
    public var confirmsDiscard = false

    /// True once the sheet has shown and taken the recorder. A sheet that never showed, as
    /// when another sheet was already up, holds nothing to give back.
    public private(set) var holdsRecorder = false
    private var hasAppeared = false
    private var hasBegun = false
    private var startEnded = false
    /// Set by the first Stop or Cancel, so a second press in the same moment does nothing.
    private var ending = false

    public init(recorder: Recorder, tuneID: String?) {
        self.recorder = recorder
        self.tuneID = tuneID
    }

    public var phase: RecordPhase {
        // Until this sheet's start runs, the recorder still describes the last take.
        guard hasBegun else { return .starting }
        if recorder.isStarting { return .starting }
        switch recorder.state {
        case .recording: return .recording
        case .paused: return .interrupted
        case .finishing: return .saving
        case .idle:
            if recorder.savedRecordingID != nil { return .saved }
            return startEnded || recorder.errorMessage != nil ? .notRecording : .starting
        }
    }

    public var status: String {
        switch phase {
        case .starting: Self.startingMicrophone
        case .recording: RecordingText.recording
        case .interrupted: Self.interrupted
        case .saving: Self.saving
        case .saved: Self.saved
        case .notRecording: Self.notRecording
        }
    }

    /// True while there is a take to lose: the sheet refuses a swipe away and Cancel asks first.
    public var isLive: Bool {
        [.starting, .recording, .interrupted].contains(phase)
    }

    /// True once audio is being captured, so a discard has something to ask about.
    public var hasStarted: Bool {
        phase == .recording || phase == .interrupted
    }

    public var showsTimer: Bool {
        hasStarted || phase == .saving || phase == .saved
    }

    /// Whole milliseconds captured, for the timer.
    public var elapsedMilliseconds: Int64 {
        Int64((recorder.elapsed * 1000).rounded())
    }

    /// What went wrong, or what a saved take has to say. Nil while all is well.
    public var message: String? {
        guard hasBegun else { return nil }
        return recorder.errorMessage
    }

    public var canResume: Bool {
        phase == .interrupted && recorder.resumeAvailable
    }

    /// Takes the recorder with `claim` and starts, once the sheet shows. Closes at once when
    /// another window's sheet got the recorder first.
    public func open(claim: @MainActor () -> Bool) async {
        guard !hasAppeared else { return }
        hasAppeared = true
        guard claim() else {
            outcome = .dropped
            return
        }
        holdsRecorder = true
        await begin()
    }

    /// Gives up the recorder once the sheet has gone. True when this sheet held it, so the
    /// caller releases it exactly once.
    public func releaseRecorder() -> Bool {
        guard holdsRecorder else { return false }
        holdsRecorder = false
        return true
    }

    /// True while the sheet was asked for but has not shown, as when another sheet was up;
    /// asking again replaces it.
    public var isPending: Bool { !hasAppeared }

    /// True when the sheet closed on a saved take with no tune. A take started from a tune is
    /// saved under the tune whose screen is already open, so only an unfiled one moves the
    /// musician, to the recordings where it landed. A sheet swiped away after a save with a
    /// note counts, since the take is saved all the same.
    public var landsOnRecordings: Bool {
        guard tuneID == nil else { return false }
        if case .saved = outcome { return true }
        return outcome == nil && phase == .saved
    }

    /// The haptic for a change of phase: start as capture begins, stop as it ends however the
    /// save turns out, since a quick save can pass `.saving` between two frames.
    nonisolated public static func feedback(from old: RecordPhase, to new: RecordPhase) -> SensoryFeedback? {
        if old == .starting && new == .recording { return .start }
        let wasCapturing = old == .recording || old == .interrupted
        if wasCapturing && [.saving, .saved, .notRecording].contains(new) { return .stop }
        return nil
    }

    /// Starts the take, filed under the sheet's tune. Call once, when the sheet opens.
    func begin() async {
        guard !hasBegun else { return }
        hasBegun = true
        await recorder.start(tuneID: tuneID)
        startEnded = true
    }

    /// Stops and saves the take. The sheet closes unless the save has something to say.
    public func stop() async {
        guard !ending, hasStarted else { return }
        ending = true
        await recorder.stop()
        ending = false
        settle()
    }

    /// Reads a take the recorder ended on its own, as at the size limit.
    public func settle() {
        guard outcome == nil, phase == .saved, let id = recorder.savedRecordingID else { return }
        if recorder.errorMessage == nil { outcome = .saved(recordingID: id) }
    }

    public func resume() async {
        await recorder.resume()
    }

    /// Cancel: asks first once audio is captured; before that there is nothing to lose.
    public func cancel() async {
        guard !ending, isLive else { return }
        if hasStarted {
            confirmsDiscard = true
        } else {
            await discard()
        }
    }

    /// Throws the take away and closes, or keeps the sheet open to say the discard failed.
    public func discard() async {
        guard !ending else { return }
        ending = true
        await recorder.discard()
        ending = false
        if recorder.errorMessage == nil { outcome = .dropped }
    }

    /// Done, once there is nothing live left: closes on what the take came to.
    public func finish() {
        guard !isLive, phase != .saving else { return }
        if let id = recorder.savedRecordingID, phase == .saved {
            outcome = .saved(recordingID: id)
        } else {
            outcome = .dropped
        }
    }

    /// The sheet went away without Stop or Cancel, as when its window closed. A live take is
    /// kept rather than lost.
    public func abandon() async {
        guard outcome == nil else { return }
        if isLive { await recorder.stop() }
    }
}
