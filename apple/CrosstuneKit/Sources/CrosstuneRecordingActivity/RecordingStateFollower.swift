/// The recording state a surface shows as the recorder changes, so the Live Activity and the
/// widgets agree on it: the recorder's state while it records, and a saved or failed state only
/// when a recording that was under way ends.
public struct RecordingStateFollower: Sendable {
    public static let savedDismissal: Duration = .seconds(4)
    public static let failedDismissal: Duration = .seconds(10)

    public private(set) var shown: RecordingActivityState?
    /// Changes with each shown state, so a dismissal set for an older one is ignored.
    public private(set) var token = 0

    public init() {}

    /// How long an ended state stays on screen. Nil for a state that is not an end.
    public static func dismissal(after status: RecordingActivityState.Status) -> Duration? {
        switch status {
        case .saved: savedDismissal
        case .failed: failedDismissal
        case .recording, .interrupted, .saving, .notRecording: nil
        }
    }

    /// Takes `next`, what the recorder's state shows, which is nil, saved, or failed only for an
    /// idle recorder. Returns how long an ended state stays, when one just began.
    public mutating func observe(_ next: RecordingActivityState?) -> Duration? {
        guard let next, Self.dismissal(after: next.status) == nil else {
            // An idle recorder keeps the outcome of its last recording, so the saved or failed
            // state shows only when a recording that was under way ends.
            guard let current = shown, Self.dismissal(after: current.status) == nil else { return nil }
            show(next)
            return next.flatMap { Self.dismissal(after: $0.status) }
        }
        // A recording's timer runs on its own, so a new elapsed time leaves the state as it is.
        if next.status == .recording, shown?.status == .recording { return nil }
        show(next)
        return nil
    }

    /// Clears the ended state shown since `token`, which has stayed long enough.
    public mutating func dismiss(token: Int) {
        guard token == self.token else { return }
        show(nil)
    }

    private mutating func show(_ state: RecordingActivityState?) {
        guard state != shown else { return }
        shown = state
        token += 1
    }
}
