import Foundation
import OpenAPIRuntime
import Testing

@testable import CrosstuneSync

private let t0 = Date(timeIntervalSince1970: 0)

@Suite struct FailureStreakTests {
    @Test func reportsOnceTheStreakHasLasted() {
        var streak = FailureStreak(lasting: .seconds(300))

        let reported = [0, 60, 120, 180, 240, 299, 300, 360].map { streak.failed(at: t0 + TimeInterval($0)) }

        #expect(reported == [false, false, false, false, false, false, true, false])
    }

    @Test func endedStartsAgain() {
        var streak = FailureStreak(lasting: .seconds(300), gap: .seconds(300))
        let first = [0, 300].map { streak.failed(at: t0 + TimeInterval($0)) }
        #expect(first == [false, true])

        streak.ended()

        let next = [400, 700].map { streak.failed(at: t0 + TimeInterval($0)) }
        #expect(next == [false, true])
    }

    /// Two failures either side of a suspended app are not one lasting failure.
    @Test func aLongGapStartsAgain() {
        var streak = FailureStreak(lasting: .seconds(300))

        let resumed: TimeInterval = 8 * 3600
        let times: [TimeInterval] = [0, 60, resumed, resumed + 120, resumed + 240, resumed + 300]
        let reported = times.map { streak.failed(at: t0 + $0) }

        #expect(reported == [false, false, false, false, false, true])
    }
}

/// A weak connection is not a defect, however long it lasts.
@Test(arguments: [
    URLError.Code.timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost,
    .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
])
func aConnectivityFailureIsNotReportable(_ code: URLError.Code) {
    #expect(!isReportableFailure(URLError(code)))
}

@Test func otherFailuresAreReportable() {
    #expect(isReportableFailure(URLError(.badServerResponse)))
    #expect(isReportableFailure(TransferError(status: 500)))
    #expect(!isReportableFailure(APIStatusError(status: 401)))
}

/// A stopped engine, a device known to be offline, and a connection failure the API client
/// wraps are not defects either.
@Test func aStoppedOfflineOrWrappedConnectionFailureIsNotReportable() {
    #expect(!isReportableFailure(RunStopped()))
    #expect(!isReportableFailure(DeviceOffline()))
    let wrapped = ClientError(
        operationID: "downloadURL", operationInput: (), causeDescription: "", underlyingError: URLError(.timedOut))
    #expect(!isReportableFailure(wrapped))
}

/// A run loop's failing streak reports once it has lasted, whatever the backoff in between.
@MainActor
@Suite struct SyncLoopLastingFailureTests {
    enum Outcome {
        case success, failure, unreportable, offline, stopped
    }

    struct Failed: Error {}
    struct Unreportable: Error {}
    struct Offline: Error {}

    let sleeper = ManualSleeper()
    let clock = TestClock(t0)
    let state = LoopScript()
    let loop: SyncLoop<SyncStatus>

    init() {
        let (clock, state) = (clock, state)
        loop = SyncLoop<SyncStatus>(
            name: "test", sleep: sleeper.sleep,
            isStopped: { false },
            classify: { $0 is Offline ? .offline : .error },
            afterRun: { state.finished += 1 },
            now: { clock.now },
            isReportable: { _, error in !(error is Unreportable) },
            onLastingFailure: { status, _ in state.lasting.append(status) },
            run: {
                switch state.outcome {
                case .success: return
                case .failure: throw Failed()
                case .unreportable: throw Unreportable()
                case .offline: throw Offline()
                case .stopped: throw RunStopped()
                }
            })
    }

    /// Runs once at `seconds` past the start: by releasing the pending retry when there is one,
    /// or by a trigger when the last run left none.
    private func run(_ outcome: Outcome, at seconds: Int) async throws {
        clock.now = t0 + TimeInterval(seconds)
        state.outcome = outcome
        let before = state.finished
        if sleeper.pendingCount > 0 {
            sleeper.fire()
            try await waitUntil { state.finished == before + 1 }
        } else {
            await loop.trigger()
        }
        // The retry's wait starts on its own task; waiting here makes the next run release it.
        if outcome != .success && outcome != .stopped {
            try await waitUntil { sleeper.pendingCount == 1 }
        }
    }

    @Test func lastingFailureReportsOncePerStreak() async throws {
        for seconds in stride(from: 0, through: 3600, by: 60) {
            try await run(.failure, at: seconds)
        }

        #expect(state.lasting == [.error])
        loop.cancelRetry()
    }

    @Test func streakThatClearsReportsNothing() async throws {
        for seconds in stride(from: 0, through: 240, by: 60) {
            try await run(.failure, at: seconds)
        }
        try await run(.success, at: 300)

        #expect(state.lasting.isEmpty)
    }

    @Test func offlineRunEndsTheStreak() async throws {
        for seconds in stride(from: 0, through: 240, by: 60) {
            try await run(.failure, at: seconds)
        }
        try await run(.offline, at: 270)
        for seconds in stride(from: 300, through: 540, by: 60) {
            try await run(.failure, at: seconds)
        }
        #expect(state.lasting.isEmpty)

        try await run(.failure, at: 600)

        #expect(state.lasting == [.error])
        loop.cancelRetry()
    }

    @Test func unreportableFailureEndsTheStreak() async throws {
        for seconds in stride(from: 0, through: 240, by: 60) {
            try await run(.failure, at: seconds)
        }
        try await run(.unreportable, at: 270)
        for seconds in stride(from: 300, through: 540, by: 60) {
            try await run(.failure, at: seconds)
        }
        #expect(state.lasting.isEmpty)

        try await run(.failure, at: 600)

        #expect(state.lasting == [.error])
        loop.cancelRetry()
    }

    /// A stopped run neither failed nor landed, so the streak around it carries on.
    @Test func stoppedRunLeavesTheStreakRunning() async throws {
        for seconds in stride(from: 0, through: 240, by: 60) {
            try await run(.failure, at: seconds)
        }
        // Dropped, so the stopped run below comes from a trigger, as a stop's would.
        loop.cancelRetry()
        try await waitUntil { sleeper.pendingCount == 0 }
        try await run(.stopped, at: 270)

        try await run(.failure, at: 300)

        #expect(state.lasting == [.error])
        loop.cancelRetry()
    }
}

/// What a test loop's run does next, and what the loop has reported.
@MainActor
final class LoopScript {
    var outcome = SyncLoopLastingFailureTests.Outcome.success
    var finished = 0
    var lasting: [SyncStatus] = []
}
