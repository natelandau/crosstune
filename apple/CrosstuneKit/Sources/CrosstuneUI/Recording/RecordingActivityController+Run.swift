import CrosstuneRecording
import Observation

extension RecordingActivityController {
    /// Follows `host`'s recorder until the calling task is cancelled, and sends the meter on a
    /// timer while the activity shows a recording.
    public func run(host: RecorderHost) async {
        var meter: Task<Void, Never>?
        defer { meter?.cancel() }
        // Reads `current` on each pass, so a recorder for another account is followed.
        let snapshots = Observations { host.current.map(RecorderSnapshot.init) ?? .idle }
        for await snapshot in snapshots {
            observe(snapshot, now: .now)
            if !isShowingRecording {
                meter?.cancel()
                meter = nil
            } else if meter == nil {
                meter = Task {
                    while (try? await Task.sleep(for: Self.meterInterval)) != nil {
                        publishMeter(now: .now)
                    }
                }
            }
        }
    }
}

extension RecorderSnapshot {
    fileprivate static let idle = RecorderSnapshot(
        state: .idle, elapsed: 0, resumeAvailable: false, savedRecordingID: nil, errorMessage: nil,
        levels: [], levelCount: 0
    )
}
