#if os(iOS)
    @preconcurrency import ActivityKit
    import CrosstuneRecordingActivity
    import Foundation
    import os

    /// Shows the recording Live Activity through ActivityKit.
    @MainActor
    public final class LiveRecordingActivityClient: RecordingActivityClient {
        private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "live-activity")

        private var activity: Activity<RecordingActivityAttributes>?
        /// The newest update not yet sent. A later update replaces it, so a stalled ActivityKit
        /// leaves at most one update waiting.
        private var pendingUpdate: ActivityContent<RecordingActivityState>?
        /// The last change sent. Each change waits on it, so ActivityKit sees them in order.
        private var lastChange: Task<Void, Never>?

        public init() {}

        public func start(_ state: RecordingActivityState, staleDate: Date?) -> Bool {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
            do {
                activity = try Activity.request(
                    attributes: RecordingActivityAttributes(), content: content(state, staleDate: staleDate),
                    pushType: nil)
                return true
            } catch {
                Self.logger.warning("The system refused the recording Live Activity: \(error, privacy: .public)")
                return false
            }
        }

        public func update(_ state: RecordingActivityState, staleDate: Date?) {
            guard activity != nil else { return }
            let isQueued = pendingUpdate != nil
            pendingUpdate = content(state, staleDate: staleDate)
            guard !isQueued else { return }
            enqueue {
                // An end or endAll since the update was queued clears both, which drops it.
                guard let activity = self.activity, let content = self.pendingUpdate else { return }
                self.pendingUpdate = nil
                await activity.update(content)
            }
        }

        public func end(_ state: RecordingActivityState, dismissAfter: Duration?) {
            guard let activity else { return }
            // The end carries the newest state, so an update still waiting is dropped.
            reset()
            let content = content(state, staleDate: nil)
            let policy: ActivityUIDismissalPolicy =
                dismissAfter.map { .after(.now.addingTimeInterval($0 / .seconds(1))) } ?? .immediate
            enqueue { await activity.end(content, dismissalPolicy: policy) }
        }

        public func endAll() {
            reset()
            let activities = Activity<RecordingActivityAttributes>.activities
            enqueue {
                for activity in activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }

        private func reset() {
            activity = nil
            pendingUpdate = nil
        }

        private func content(
            _ state: RecordingActivityState, staleDate: Date?
        ) -> ActivityContent<RecordingActivityState> {
            ActivityContent(state: state, staleDate: staleDate)
        }

        private func enqueue(_ change: @escaping @MainActor () async -> Void) {
            let previous = lastChange
            lastChange = Task {
                await previous?.value
                await change()
            }
        }
    }
#endif
