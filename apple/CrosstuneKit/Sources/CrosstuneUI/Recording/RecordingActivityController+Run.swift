import CrosstuneRecording
import Observation

extension RecordingActivityController {
    /// Follows `host`'s recorder until the calling task is cancelled, and keeps the activity
    /// current on a timer while it shows a recording.
    public func run(host: RecorderHost) async {
        var keepingAlive: Task<Void, Never>?
        defer { keepingAlive?.cancel() }
        // Reads `current` on each pass, so a recorder for another account is followed.
        let snapshots = Observations { host.current.map(RecorderSnapshot.init) ?? .idle }
        for await snapshot in snapshots {
            observe(snapshot, now: .now)
            if !isShowingRecording {
                keepingAlive?.cancel()
                keepingAlive = nil
            } else if keepingAlive == nil {
                keepingAlive = Task {
                    // Checks twice per interval, so a check that lands a moment before the
                    // interval is due never doubles the time between updates.
                    while (try? await Task.sleep(for: Self.keepAliveInterval / 2)) != nil {
                        keepAlive(now: .now)
                    }
                }
            }
        }
    }
}

extension RecorderSnapshot {
    fileprivate static let idle = RecorderSnapshot(
        state: .idle, elapsed: 0, resumeAvailable: false, savedRecordingID: nil, errorMessage: nil
    )
}
