import CrosstuneAudio
import CrosstuneRecording
import CrosstuneRecordingActivity
import Foundation

/// Shows, changes, and ends the system's recording Live Activity.
@MainActor
public protocol RecordingActivityClient: AnyObject {
    /// False when the system refuses, as when Live Activities are turned off. Past `staleDate`,
    /// the activity shows that nothing is recording. Nil never goes stale.
    func start(_ state: RecordingActivityState, staleDate: Date?) -> Bool
    func update(_ state: RecordingActivityState, staleDate: Date?)
    /// Ends the activity, leaving `state` on screen for `dismissAfter`. Nil removes it at once.
    func end(_ state: RecordingActivityState, dismissAfter: Duration?)
    /// Ends every recording Live Activity still showing.
    func endAll()
}

/// Turns the recorder's state into the recording Live Activity.
@MainActor
public final class RecordingActivityController {
    /// How often ``publishMeter(now:)`` should run while recording.
    public static let meterInterval: Duration = .seconds(1)
    static let savedDismissal: Duration = .seconds(4)
    static let failedDismissal: Duration = .seconds(10)
    /// How long a recording update stays current. Past it, the activity shows that nothing is
    /// recording, which covers the system ending the app with no chance to end the activity.
    static let staleWindow: Duration = .seconds(15)
    /// The longest a recording goes without an update, so its stale date stays ahead while the app runs.
    static let keepAliveInterval: Duration = .seconds(5)

    private let client: any RecordingActivityClient
    private var lastState: Recorder.State = .idle
    /// What the live activity shows. Nil when none is live.
    private var shown: RecordingActivityState?
    /// When `shown` was last sent.
    private var sentAt: Date?
    /// Whether this recording has asked for an activity, so a refusal is not asked again.
    private var askedToStart = false
    private var newLevels = NewLevels()
    private var levelCount = 0
    private var pendingLevels: [Float] = []

    public init(client: any RecordingActivityClient) {
        self.client = client
    }

    /// Ends any activity a previous run left, whose recording launch recovery finishes.
    public func launch() {
        client.endAll()
    }

    public func observe(_ snapshot: RecorderSnapshot, now: Date) {
        defer { takeLevels(from: snapshot) }
        let previous = lastState
        lastState = snapshot.state

        switch snapshot.state {
        case .recording:
            guard previous != .recording else { return }
            showOrStart(activityState(.recording, snapshot, now: now), now: now)
        case .paused:
            // Observation can coalesce a start and an interruption, so `.recording` may never be seen.
            showOrStart(activityState(.interrupted, snapshot, now: now), now: now)
        case .finishing:
            show(activityState(.saving, snapshot, now: now), now: now)
        case .idle:
            askedToStart = false
            guard let current = shown else { return }
            shown = nil
            // Decided from the fields alone: observation can coalesce a stop and its save, so
            // `.finishing` may never be seen.
            if snapshot.savedRecordingID != nil {
                client.end(activityState(.saved, snapshot, now: now), dismissAfter: Self.savedDismissal)
            } else if snapshot.errorMessage == RecordingActivityText.saveFailed {
                client.end(activityState(.failed, snapshot, now: now), dismissAfter: Self.failedDismissal)
            } else {
                client.end(current, dismissAfter: nil)
            }
        }
    }

    /// Whether the live activity shows a recording under way, the only time the meter changes.
    var isShowingRecording: Bool { shown?.status == .recording }

    /// Sends the levels measured since the last call as meter bars, while recording. Also sends
    /// an unchanged state once ``keepAliveInterval`` has passed, to move its stale date ahead.
    public func publishMeter(now: Date) {
        defer { pendingLevels = [] }
        guard let current = shown, current.status == .recording else { return }
        var state = current
        state.bars = MeterBars.reduce(pendingLevels)
        guard state != current || isKeepAliveDue(now: now) else { return }
        // A stale activity holds `elapsed`, so it keeps up with the timer.
        if let timerStart = state.timerStart {
            state.elapsed = now.timeIntervalSince(timerStart) - Self.timerLead
        }
        send(state, now: now)
    }

    private func isKeepAliveDue(now: Date) -> Bool {
        guard let sentAt else { return true }
        return now.timeIntervalSince(sentAt) >= Self.keepAliveInterval / .seconds(1)
    }

    private func takeLevels(from snapshot: RecorderSnapshot) {
        // A smaller count is a new recording, so levels held from the old one are dropped.
        if snapshot.levelCount < levelCount { pendingLevels = [] }
        levelCount = snapshot.levelCount
        let fresh = newLevels.take(snapshot.levels, total: snapshot.levelCount)
        // Levels from an interruption or a save would show on the meter after a resume.
        if isShowingRecording { pendingLevels += fresh }
    }

    /// The time runs on its own only while recording, and holds still at `snapshot.elapsed` otherwise.
    private func activityState(
        _ status: RecordingActivityState.Status, _ snapshot: RecorderSnapshot, now: Date
    ) -> RecordingActivityState {
        RecordingActivityState(
            status: status,
            timerStart: status == .recording ? Self.timerStart(elapsed: snapshot.elapsed, now: now) : nil,
            elapsed: snapshot.elapsed,
            canResume: status == .interrupted && snapshot.resumeAvailable,
            bars: RecordingActivityState.flatBars
        )
    }

    /// A system timer drops the fraction of a second, and a held time rounds it. Starting half a
    /// second early makes the timer round too, so the time never jumps on a pause or a save.
    static func timerStart(elapsed: TimeInterval, now: Date) -> Date {
        now.addingTimeInterval(-(elapsed + timerLead))
    }

    private static let timerLead: TimeInterval = 0.5

    /// Only a recording goes stale: every other status holds still and needs no update.
    private static func staleDate(for state: RecordingActivityState, now: Date) -> Date? {
        state.status == .recording ? now.addingTimeInterval(staleWindow / .seconds(1)) : nil
    }

    /// Updates the live activity, or asks for one when this recording has not yet.
    private func showOrStart(_ state: RecordingActivityState, now: Date) {
        if shown != nil {
            show(state, now: now)
        } else if !askedToStart {
            askedToStart = true
            if client.start(state, staleDate: Self.staleDate(for: state, now: now)) {
                shown = state
                sentAt = now
            }
        }
    }

    /// Updates the live activity when `state` differs from what it shows.
    private func show(_ state: RecordingActivityState, now: Date) {
        guard let current = shown, current != state else { return }
        send(state, now: now)
    }

    private func send(_ state: RecordingActivityState, now: Date) {
        shown = state
        sentAt = now
        client.update(state, staleDate: Self.staleDate(for: state, now: now))
    }
}
