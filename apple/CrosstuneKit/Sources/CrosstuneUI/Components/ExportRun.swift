import CrosstuneAnalytics
import CrosstuneDiagnostics
import CrosstuneSync
import Foundation
import OSLog
import Observation

let exportLogger = Logger(subsystem: "app.crosstune.Crosstune", category: "export")

/// One export at a time and its progress. Abandoning a run stops it at any point, and an output
/// that arrives after is discarded. A finished output waits here until its hand-off takes it.
@MainActor
@Observable
final class ExportRun<Output: Sendable> {
    typealias Work = @Sendable (_ progress: @escaping @Sendable (Int, Int) -> Void) async throws -> Output

    private let diagnostics: DiagnosticsClient
    private let discard: @MainActor (Output) -> Void

    private(set) var progress: ExportProgress?
    /// The finished output, while its hand-off has it.
    private(set) var output: Output?
    private(set) var isRunning = false

    private var task: Task<Void, Never>?
    /// Bumped by every start and abandon, so a run that finishes late can tell it was abandoned.
    private var generation = 0

    init(diagnostics: DiagnosticsClient, discard: @escaping @MainActor (Output) -> Void) {
        self.diagnostics = diagnostics
        self.discard = discard
    }

    /// The hand-off holds the run's owner until it closes, so an output still here once the run
    /// is gone has no one left to hand it to.
    isolated deinit {
        task?.cancel()
        if let output { discard(output) }
    }

    /// Whether a run can start: none is under way and no output waits on a hand-off.
    var canStart: Bool { !isRunning && output == nil }

    /// Runs `work` unless a run is under way or its output waits on a hand-off. `accept` says
    /// whether to keep the output for a hand-off or discard it, and `failed` hears why a run
    /// failed. Neither hears from an abandoned run. Returns the run so a test can wait on it.
    @discardableResult
    func start(
        _ work: @escaping Work, accept: @escaping @MainActor (Output) -> Bool,
        failed: @escaping @MainActor (_ error: any Error, _ reason: FailureReason) -> Void
    ) -> Task<Void, Never>? {
        guard canStart else { return nil }
        generation += 1
        let mine = generation
        progress = nil
        isRunning = true
        let (updates, continuation) = AsyncStream.makeStream(
            of: ExportProgress.self, bufferingPolicy: .bufferingNewest(1))
        let task = Task {
            // Weak, so a watcher still winding down never keeps the run, and its output, alive.
            let watcher = Task { [weak self] in
                for await update in updates {
                    guard let self, mine == generation else { return }
                    progress = update
                }
            }
            let result: Result<Output, any Error>
            do {
                result = .success(
                    try await work { done, total in continuation.yield(ExportProgress(done: done, total: total)) })
            } catch {
                result = .failure(error)
            }
            // Stops the watcher before the run's state resets, so no late update outlives the run.
            watcher.cancel()
            continuation.finish()
            finish(mine, with: result, accept: accept, failed: failed)
        }
        self.task = task
        return task
    }

    private func finish(
        _ run: Int, with result: Result<Output, any Error>, accept: @MainActor (Output) -> Bool,
        failed: @MainActor (any Error, FailureReason) -> Void
    ) {
        guard run == generation else {
            if case .success(let output) = result { discard(output) }
            return
        }
        isRunning = false
        progress = nil
        task = nil
        switch result {
        case .success(let output):
            if accept(output) { self.output = output } else { discard(output) }
        case .failure(let error):
            exportLogger.error("Could not export: \(error, privacy: .public)")
            let cause = (error as? ExportFetchFailed)?.underlying ?? error
            let reason = FailureReason(cause)
            // Offline, an expired session, a full disk, and cancellation are expected, not defects.
            let expected =
                reason == .network || reason == .storageFull || cause is CancellationError
                || !isReportableFailure(cause)
            if !expected { diagnostics.report(cause, area: .export) }
            failed(error, reason)
        }
    }

    /// Abandons a running export and discards an output not yet handed off.
    func cancel() {
        abandon()
        discardOutput()
    }

    /// Abandons a running export but leaves a finished output to the hand-off that has it.
    func abandon() {
        generation += 1
        task?.cancel()
        task = nil
        isRunning = false
        progress = nil
    }

    /// The hand-off is done with the output, so it goes.
    func discardOutput() {
        if let output { discard(output) }
        output = nil
    }

    /// Gives the output to a hand-off that discards it itself, such as one that outlives the run.
    func takeOutput() -> Output? {
        defer { output = nil }
        return output
    }
}
