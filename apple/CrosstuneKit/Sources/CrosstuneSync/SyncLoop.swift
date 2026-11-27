import Foundation
import Observation
import os

/// Waits for a duration, throwing if the waiting task is cancelled first. `Task.sleep` in the
/// app; tests pass one they release by hand.
public typealias Sleeper = @Sendable (Duration) async throws -> Void

/// The sleeper every loop and timer uses in the app.
public let liveSleeper: Sleeper = { try await Task.sleep(for: $0) }

/// A loop's states: at rest, running, and the one failure that is expected and never logged.
protocol LoopStatus: Hashable, Sendable {
    static var idle: Self { get }
    static var busy: Self { get }
    static var offline: Self { get }
}

/// A run gave up at a request boundary because its loop was stopped.
struct RunStopped: Error {}

/// How long each retry after consecutive failures waits; the last delay repeats.
let retryBackoff: [Duration] = [1, 2, 4, 8, 16, 32, 60].map { .seconds($0) }

/// A serialized run loop.
///
/// A trigger while a run is in flight coalesces into one more run after it. A failed run backs
/// off and retries, and the first of consecutive failures is logged. A persistent failure is handed
/// to `onPersistentFailure` once. A run can also ask, through ``runAgain(after:)``, for one more
/// run once a wait of its own ends.
@MainActor @Observable
final class SyncLoop<Status: LoopStatus> {
    private(set) var status = Status.idle

    private let run: @MainActor () async throws -> Void
    /// The status a failed run leaves behind.
    private let classify: @MainActor (any Error) -> Status
    private let isStopped: @MainActor () -> Bool
    private let afterRun: @MainActor () -> Void
    /// Called with true when the loop starts running and false once it stops, after the last
    /// `afterRun`, so work that must outlast every run in flight can track it.
    private let runningChanged: @MainActor (Bool) -> Void
    /// Called when a run fails into a state other than offline that the last reported failure of
    /// these consecutive failures was not in, with that state and the error.
    private let onFailure: @MainActor (Status, any Error) -> Void
    /// Whether a failure counts toward a persistent failure worth reporting. One that does not
    /// ends the consecutive failures, as offline does.
    private let isReportable: @MainActor (Status, any Error) -> Bool
    /// Called once per run of consecutive reportable failures, on the first failure at least
    /// ``persistentFailure`` after the run's first, with that state and the error.
    private let onPersistentFailure: @MainActor (Status, any Error) -> Void
    private let now: @MainActor () -> Date
    private let sleep: Sleeper
    private let logger: Logger

    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var again = false
    @ObservationIgnored private var failures = 0
    /// The failed state last reported in the current consecutive failures; a clean run ends them.
    @ObservationIgnored private var reportedFailure: Status?
    @ObservationIgnored private var retry: Task<Void, Never>?
    /// The shortest wait the run in flight asked for before the next run, nil when it asked none.
    @ObservationIgnored private var requestedDelay: Duration?
    @ObservationIgnored private var consecutiveFailures = ConsecutiveFailures(persistsFor: persistentFailure)

    init(
        name: String,
        sleep: @escaping Sleeper,
        isStopped: @escaping @MainActor () -> Bool,
        classify: @escaping @MainActor (any Error) -> Status,
        afterRun: @escaping @MainActor () -> Void = {},
        runningChanged: @escaping @MainActor (Bool) -> Void = { _ in },
        onFailure: @escaping @MainActor (Status, any Error) -> Void = { _, _ in },
        now: @escaping @MainActor () -> Date = Date.init,
        isReportable: @escaping @MainActor (Status, any Error) -> Bool = { _, _ in true },
        onPersistentFailure: @escaping @MainActor (Status, any Error) -> Void = { _, _ in },
        run: @escaping @MainActor () async throws -> Void
    ) {
        self.run = run
        self.classify = classify
        self.isStopped = isStopped
        self.afterRun = afterRun
        self.runningChanged = runningChanged
        self.onFailure = onFailure
        self.now = now
        self.isReportable = isReportable
        self.onPersistentFailure = onPersistentFailure
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
        runningChanged(true)
        let task = Task {
            while true {
                await runOnce()
                afterRun()
                guard again, !isStopped() else { break }
                again = false
            }
            running = nil
            runningChanged(false)
        }
        running = task
        await task.value
    }

    /// Returns once the run in flight, if any, is done.
    func finishRunning() async {
        await running?.value
    }

    /// Cancels the pending retry, whether a failure's backoff or a wait a run asked for.
    func cancelRetry() {
        retry?.cancel()
        retry = nil
    }

    /// Ask, from inside a run, for another run once `delay` passes, so work the run left waiting
    /// on a timer of its own is picked up without an unrelated trigger. A failed run retries at
    /// the sooner of its backoff and this delay.
    func runAgain(after delay: Duration) {
        requestedDelay = min(requestedDelay ?? delay, delay)
    }

    private func runOnce() async {
        let before = status
        status = .busy
        requestedDelay = nil
        do {
            try await run()
            failures = 0
            reportedFailure = nil
            consecutiveFailures.ended()
            cancelRetry()
            if let requestedDelay, !isStopped() { scheduleRetry(after: requestedDelay) }
            status = .idle
        } catch is RunStopped {
            // The run neither landed nor failed, so what showed before it still holds.
            status = before
        } catch {
            let next = classify(error)
            // Once per run of failures: a retry that fails the same way adds nothing.
            if next != .offline && failures == 0 {
                logger.error("Run failed: \(logDescription(of: error), privacy: .public)")
            }
            status = next
            if next != .offline, reportedFailure != next {
                reportedFailure = next
                onFailure(next, error)
            }
            // Checked before the consecutive failures, so a failure never reported cannot spend its one report.
            if next == .offline || !isReportable(next, error) {
                consecutiveFailures.ended()
            } else if consecutiveFailures.failed(at: now()) {
                onPersistentFailure(next, error)
            }
            if !isStopped() {
                let backoff = retryBackoff[min(failures, retryBackoff.count - 1)]
                failures += 1
                scheduleRetry(after: min(backoff, requestedDelay ?? backoff))
            }
        }
    }

    private func scheduleRetry(after delay: Duration) {
        cancelRetry()
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
