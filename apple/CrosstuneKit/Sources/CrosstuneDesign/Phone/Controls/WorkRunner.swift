import Observation

/// Where an action button is in a press: `pending` has started but shows nothing yet.
package enum WorkPhase: Equatable, Sendable {
    case idle, pending, working, done
}

/// Runs a button's action and walks its phase: work that ends inside `Motion.workingDelay`
/// never flashes a spinner, and a success holds a check for `Motion.doneHold`.
@MainActor @Observable
package final class WorkRunner {
    package private(set) var phase: WorkPhase = .idle
    /// Counts the runs that failed, so a view can react to each one, including a failure the
    /// screen already reports.
    package private(set) var failureCount = 0

    @ObservationIgnored private let sleep: (Duration) async throws -> Void
    @ObservationIgnored private var delayTask: Task<Void, Never>?
    @ObservationIgnored private var holdTask: Task<Void, Never>?
    /// Changes on every run and cancel, so a stale run can tell it no longer owns the phase.
    @ObservationIgnored private var generation = 0
    /// True from a run's start until its action ends, so a cancelled action still blocks a new run.
    @ObservationIgnored private var actionInFlight = false

    package init(sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.sleep = sleep
    }

    package func run(closesOnSuccess: Bool, _ action: @escaping () async throws -> Void) async throws {
        guard phase == .idle, !actionInFlight else { return }
        generation += 1
        let mine = generation
        phase = .pending
        delayTask = Task { [weak self, sleep] in
            do { try await sleep(Motion.workingDelay) } catch { return }
            guard let self, generation == mine, phase == .pending else { return }
            phase = .working
        }

        actionInFlight = true
        do {
            try await action()
        } catch {
            actionInFlight = false
            // A cancelled run's failure has no control left to show it.
            guard generation == mine else { return }
            failureCount += 1
            finish(to: .idle)
            throw error
        }
        actionInFlight = false
        guard generation == mine else { return }
        if closesOnSuccess {
            finish(to: .idle)
        } else {
            finish(to: .done)
            holdTask = Task { [weak self, sleep] in
                do { try await sleep(Motion.doneHold) } catch { return }
                guard let self, generation == mine else { return }
                phase = .idle
            }
        }
    }

    /// Stops the timers and returns to idle, for a button that leaves the screen.
    package func cancel() {
        generation += 1
        finish(to: .idle)
        holdTask?.cancel()
        holdTask = nil
    }

    private func finish(to next: WorkPhase) {
        delayTask?.cancel()
        delayTask = nil
        phase = next
    }
}
