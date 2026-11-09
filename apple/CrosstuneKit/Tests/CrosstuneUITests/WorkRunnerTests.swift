import Foundation
import Testing

@testable import CrosstuneDesign

@MainActor
struct WorkRunnerTests {
    private struct Failure: Error {}

    /// Holds an action open until the test releases it.
    @MainActor private final class Gate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var opened = false

        func wait() async {
            guard !opened else { return }
            await withCheckedContinuation { continuation = $0 }
        }

        func open() {
            opened = true
            continuation?.resume()
            continuation = nil
        }
    }

    private let sleeper = ManualSleep()

    private func makeRunner() -> WorkRunner {
        WorkRunner(sleep: sleeper.sleep)
    }

    /// Lets the main actor run queued work until `condition` holds.
    private func settle(until condition: () -> Bool) async {
        for _ in 0..<200 where !condition() { await Task.yield() }
    }

    @Test func fastWorkShowsOnlyTheCheck() async throws {
        let runner = makeRunner()
        var phases: [WorkPhase] = []
        try await runner.run(closesOnSuccess: false) { phases.append(runner.phase) }
        phases.append(runner.phase)
        #expect(phases == [.pending, .done])
    }

    @Test func slowWorkShowsTheSpinner() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        #expect(runner.phase == .pending)
        sleeper.wake()
        await settle { runner.phase == .working }
        #expect(runner.phase == .working)
        gate.open()
        try await task.value
        #expect(runner.phase == .done)
    }

    @Test func doneReturnsToIdleAfterOneSecond() async throws {
        let runner = makeRunner()
        try await runner.run(closesOnSuccess: false) {}
        #expect(runner.phase == .done)
        await settle { sleeper.pending.contains(Motion.doneHold) }
        #expect(sleeper.pending.contains(.seconds(1)))
        sleeper.wake()
        await settle { runner.phase == .idle }
        #expect(runner.phase == .idle)
    }

    @Test func failureReturnsAtOnceAndRethrows() async {
        let runner = makeRunner()
        await #expect(throws: Failure.self) {
            try await runner.run(closesOnSuccess: false) { throw Failure() }
        }
        #expect(runner.phase == .idle)
        await settle { false }
        #expect(!sleeper.pending.contains(.seconds(1)))
    }

    @Test func closingSkipsTheCheck() async throws {
        let runner = makeRunner()
        try await runner.run(closesOnSuccess: true) {}
        #expect(runner.phase == .idle)
        await settle { false }
        #expect(!sleeper.pending.contains(.seconds(1)))
    }

    @Test func ignoresPressWhileWorking() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        sleeper.wake()
        await settle { runner.phase == .working }
        var calls = 0
        try await runner.run(closesOnSuccess: false) { calls += 1 }
        #expect(calls == 0)
        gate.open()
        try await task.value
    }

    @Test func cancelsOnDisappear() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        sleeper.wake()
        await settle { runner.phase == .working }
        runner.cancel()
        #expect(runner.phase == .idle)
        gate.open()
        try await task.value
        #expect(runner.phase == .idle)
    }

    @Test func staleFailureAfterCancelIsSilent() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task {
            try await runner.run(closesOnSuccess: false) {
                await gate.wait()
                throw Failure()
            }
        }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        runner.cancel()
        gate.open()
        try await task.value
        #expect(runner.phase == .idle)
    }

    @Test func refusesARunWhileACancelledActionIsInFlight() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        runner.cancel()
        var calls = 0
        try await runner.run(closesOnSuccess: false) { calls += 1 }
        #expect(calls == 0)
        #expect(runner.phase == .idle)
        gate.open()
        try await task.value
        try await runner.run(closesOnSuccess: false) { calls += 1 }
        #expect(calls == 1)
    }

    @Test func cancelDuringPendingNeverShowsWorking() async throws {
        let runner = makeRunner()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        runner.cancel()
        sleeper.wake()
        await settle { false }
        #expect(runner.phase == .idle)
        gate.open()
        try await task.value
    }

    @Test func cancelDuringDoneSkipsTheHold() async throws {
        let runner = makeRunner()
        try await runner.run(closesOnSuccess: false) {}
        await settle { sleeper.pending.contains(Motion.doneHold) }
        #expect(runner.phase == .done)
        runner.cancel()
        let gate = Gate()
        let task = Task { try await runner.run(closesOnSuccess: false) { await gate.wait() } }
        await settle { sleeper.pending.contains(Motion.workingDelay) }
        #expect(!sleeper.pending.contains(Motion.doneHold))
        sleeper.wake()
        await settle { runner.phase == .working }
        #expect(runner.phase == .working)
        gate.open()
        try await task.value
    }

    @Test func eachFailureCountsOnce() async {
        let runner = makeRunner()
        #expect(runner.failureCount == 0)
        for expected in 1...2 {
            await #expect(throws: Failure.self) {
                try await runner.run(closesOnSuccess: false) { throw Failure() }
            }
            #expect(runner.failureCount == expected)
            #expect(runner.phase == .idle)
        }
    }

    @Test func successAndCancelledRunsAreNotFailures() async throws {
        let runner = makeRunner()
        try await runner.run(closesOnSuccess: true) {}
        #expect(runner.failureCount == 0)
        let gate = Gate()
        let task = Task {
            try await runner.run(closesOnSuccess: true) {
                await gate.wait()
                throw Failure()
            }
        }
        await settle { runner.phase == .pending }
        runner.cancel()
        gate.open()
        try? await task.value
        #expect(runner.failureCount == 0)
    }
}
