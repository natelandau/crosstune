import Foundation
import Observation
import os

/// Waits for a duration, throwing if the waiting task is cancelled first. `Task.sleep` in the
/// app; tests pass one they release by hand.
public typealias Sleeper = @Sendable (Duration) async throws -> Void

/// A loop's states: at rest, running, and the one failure that is expected and never logged.
protocol LoopStatus: Hashable, Sendable {
    static var idle: Self { get }
    static var busy: Self { get }
    static var offline: Self { get }
}

/// A run gave up at a request boundary because its loop was stopped.
struct RunStopped: Error {}

/// How long each retry of a failing streak waits; the last delay repeats.
let retryBackoff: [Duration] = [1, 2, 4, 8, 16, 32, 60].map { .seconds($0) }

/// A serialized run loop.
///
/// A trigger while a run is in flight coalesces into one more run after it. A failed run backs
/// off and retries, and the first failure of a streak is logged.
@MainActor @Observable
final class SyncLoop<Status: LoopStatus> {
    private(set) var status = Status.idle

    private let run: @MainActor () async throws -> Void
    /// The status a failed run leaves behind.
    private let classify: @MainActor (any Error) -> Status
    private let isStopped: @MainActor () -> Bool
    private let afterRun: @MainActor () -> Void
    private let sleep: Sleeper
    private let logger: Logger

    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var again = false
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var retry: Task<Void, Never>?

    init(
        name: String,
        sleep: @escaping Sleeper,
        isStopped: @escaping @MainActor () -> Bool,
        classify: @escaping @MainActor (any Error) -> Status,
        afterRun: @escaping @MainActor () -> Void = {},
        run: @escaping @MainActor () async throws -> Void
    ) {
        self.run = run
        self.classify = classify
        self.isStopped = isStopped
        self.afterRun = afterRun
        self.sleep = sleep
        logger = Logger(subsystem: "app.crosstune.Crosstune", category: name)
    }

    /// Runs now, or once more after the run in flight, and returns when that run is done.
    func trigger() async {
        guard !isStopped() else { return }
        if let running {
            again = true
            await running.value
            return
        }
        cancelRetry()
        // Cleared here rather than at the top of the task body, which starts only after the
        // callers that coalesced into this run have already set it.
        again = false
        let task = Task {
            while true {
                await runOnce()
                afterRun()
                guard again, !isStopped() else { break }
                again = false
            }
            running = nil
        }
        running = task
        await task.value
    }

    /// Returns once the run in flight, if any, is done.
    func finishRunning() async {
        await running?.value
    }

    func cancelRetry() {
        retry?.cancel()
        retry = nil
    }

    private func runOnce() async {
        let before = status
        status = .busy
        do {
            try await run()
            failures = 0
            cancelRetry()
            status = .idle
        } catch is RunStopped {
            // The run neither landed nor failed, so what showed before it still holds.
            status = before
        } catch {
            let next = classify(error)
            // Once per streak: a retry that fails the same way adds nothing.
            if next != .offline && failures == 0 {
                logger.error("Run failed: \(String(describing: error), privacy: .public)")
            }
            status = next
            if !isStopped() { scheduleRetry() }
        }
    }

    private func scheduleRetry() {
        cancelRetry()
        let delay = retryBackoff[min(failures, retryBackoff.count - 1)]
        failures += 1
        let sleep = self.sleep
        retry = Task { [weak self] in
            do {
                try await sleep(delay)
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            retry = nil
            await trigger()
        }
    }
}
