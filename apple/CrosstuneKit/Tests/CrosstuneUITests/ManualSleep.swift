import Foundation

/// Sleeps that end only when the test calls ``wake()``, in place of `Task.sleep`. A sleep
/// throws when its task is cancelled, as `Task.sleep` does, so a test can tell a cancelled
/// timer from one still waiting.
@MainActor
final class ManualSleep {
    /// The length of each sleep still waiting, oldest first.
    var pending: [Duration] { sleepers.map(\.duration) }
    /// How many sleeps ended by cancellation rather than by ``wake()``.
    private(set) var cancelled = 0
    private var sleepers: [Sleeper] = []

    private struct Sleeper {
        let id: UUID
        let duration: Duration
        let wake: CheckedContinuation<Void, any Error>
    }

    func sleep(_ duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, any Error>) in
                if Task.isCancelled {
                    cancelled += 1
                    wake.resume(throwing: CancellationError())
                } else {
                    sleepers.append(Sleeper(id: id, duration: duration, wake: wake))
                }
            }
        } onCancel: { [weak self] in
            Task { @MainActor in self?.cancel(id) }
        }
    }

    /// Ends every sleep waiting now.
    func wake() {
        let woken = sleepers
        sleepers.removeAll()
        for sleeper in woken { sleeper.wake.resume() }
    }

    private func cancel(_ id: UUID) {
        guard let index = sleepers.firstIndex(where: { $0.id == id }) else { return }
        cancelled += 1
        sleepers.remove(at: index).wake.resume(throwing: CancellationError())
    }
}
