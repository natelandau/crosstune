import Foundation

/// When the download pass may next try each recording whose download failed, doubling the wait
/// with each failure in a row as uploads do, so a lasting error is not re-sent after every sync.
/// Kept in memory: a relaunch tries each once more, and a play fetches regardless.
@MainActor
final class DownloadRetries {
    var now: () -> ContinuousClock.Instant = { .now }
    private var waits: [String: (attempts: Int, until: ContinuousClock.Instant)] = [:]

    func isWaiting(_ id: String) -> Bool {
        guard let wait = waits[id] else { return false }
        return now() < wait.until
    }

    func failed(_ id: String) {
        let attempts = waits[id]?.attempts ?? 0
        waits[id] = (attempts + 1, now().advanced(by: uploadBackoff(attempts: attempts)))
    }

    func succeeded(_ id: String) {
        waits[id] = nil
    }
}
