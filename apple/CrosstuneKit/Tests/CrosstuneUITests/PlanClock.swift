import Foundation

/// A clock the test moves by hand. A sleep ends once the clock reaches its end, and throws when
/// its task is cancelled, as `Task.sleep` does.
@MainActor
final class PlanClock {
    var now = Date(timeIntervalSince1970: 1_791_633_600) {
        didSet { wakeSleepers() }
    }
    private(set) var sleeps: [TimeInterval] = []
    /// How many sleeps ended by cancellation rather than by the clock.
    private(set) var cancelled = 0
    private var sleepers: [UUID: Sleeper] = [:]

    private struct Sleeper {
        let end: Date
        let wake: CheckedContinuation<Void, any Error>
    }

    func sleep(_ seconds: TimeInterval) async throws {
        sleeps.append(seconds)
        let end = now.addingTimeInterval(seconds)
        let id = UUID()
        do {
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, any Error>) in
                    park(Sleeper(end: end, wake: wake), as: id)
                }
            } onCancel: { [weak self] in
                Task { @MainActor in self?.cancelSleeper(id) }
            }
        } catch {
            cancelled += 1
            throw error
        }
    }

    private func park(_ sleeper: Sleeper, as id: UUID) {
        if Task.isCancelled {
            sleeper.wake.resume(throwing: CancellationError())
        } else if now >= sleeper.end {
            sleeper.wake.resume()
        } else {
            sleepers[id] = sleeper
        }
    }

    private func wakeSleepers() {
        for (id, sleeper) in sleepers where now >= sleeper.end {
            sleepers[id] = nil
            sleeper.wake.resume()
        }
    }

    private func cancelSleeper(_ id: UUID) {
        sleepers.removeValue(forKey: id)?.wake.resume(throwing: CancellationError())
    }
}
