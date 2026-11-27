import CrosstuneTestSupport
import Foundation
import Synchronization
import Testing

@testable import CrosstuneSync

@MainActor
@Suite(.timeLimit(.minutes(1))) final class BackgroundWakeTests {
    let router = UploadEventRouter()
    let sleeper = UncancellableSleeper()
    let wake: BackgroundWake

    init() {
        wake = BackgroundWake(router: router, limit: .seconds(20), sleep: sleeper.sleep)
    }

    isolated deinit {
        sleeper.releaseAll()
    }

    func event(_ recordingID: String = "r1") -> UploadEvent {
        UploadEvent(
            tag: UploadTaskTag(
                recordingID: recordingID, userID: "a", step: .put,
                url: URL(string: "https://storage.example.test/\(recordingID)")!),
            outcome: .status(200))
    }

    /// Let main-actor tasks run until `condition` holds.
    func settle(until condition: () -> Bool) async {
        for _ in 0..<1_000 where !condition() { await Task.yield() }
    }

    /// Begin a wake, let it run out of time, then report the session finished, as a late
    /// report after a timed-out wake arrives.
    func timeOutAWakeThenReportFinished() async {
        let timedOut = CallCount()
        wake.begin { timedOut.record() }
        await settle { sleeper.pendingCount == 1 }
        sleeper.fire()
        await settle { timedOut.value == 1 }
        wake.receive(.finishedEvents)
    }

    @Test func aLateFinishedEventsReportDoesNotEndTheNextWake() async {
        router.attach(userID: "a") { _ in }
        wake.receive(.finished(event()))
        await router.waitForHandledEvents()
        await timeOutAWakeThenReportFinished()

        let next = CallCount()
        wake.begin { next.record() }
        wake.receive(.finished(event("r2")))
        await router.waitForHandledEvents()
        #expect(next.value == 0)

        wake.receive(.finishedEvents)
        #expect(next.value == 1)
    }

    @Test func aLateFinishedEventsReportDoesNotEndTheNextWakeWhenAHandlerAttaches() async {
        wake.receive(.finished(event()))
        await timeOutAWakeThenReportFinished()

        let next = CallCount()
        wake.begin { next.record() }
        router.attach(userID: "a") { _ in }
        await wake.handlerAttached()

        #expect(next.value == 0)
    }

    @Test func aWakeAfterTheSessionFinishedEndsOnceTheEventsAreHandled() async {
        let handled = EventLog()
        wake.receive(.finished(event()))
        wake.receive(.finishedEvents)
        let completion = CallCount()
        wake.begin { completion.record() }
        #expect(completion.value == 0)

        router.attach(userID: "a") { handled.events.append($0) }
        await wake.handlerAttached()

        #expect(handled.events == [event()])
        #expect(completion.value == 1)
    }

    @Test func aWakeWhoseEventsWereAllHandledEndsAtOnce() async {
        router.attach(userID: "a") { _ in }
        wake.receive(.finished(event()))
        wake.receive(.finishedEvents)
        await router.waitForHandledEvents()

        let completion = CallCount()
        wake.begin { completion.record() }

        #expect(completion.value == 1)
    }

    @Test func aWakeCallsItsHandlerOnce() async {
        router.attach(userID: "a") { _ in }
        let completion = CallCount()
        wake.begin { completion.record() }
        await settle { sleeper.pendingCount == 1 }

        wake.receive(.finished(event()))
        wake.receive(.finishedEvents)
        wake.receive(.finishedEvents)
        await wake.handlerAttached()
        sleeper.fire()
        await settle { sleeper.returnedCount == 1 }
        // Give the timer's task every chance to call the handler a second time.
        await settle { completion.value > 1 }

        #expect(completion.value == 1)
    }

    @Test func aReplacedWakesTimeLimitDoesNotEndTheNewWake() async {
        let replaced = CallCount()
        wake.begin { replaced.record() }
        await settle { sleeper.pendingCount == 1 }
        let next = CallCount()
        wake.begin { next.record() }
        #expect(replaced.value == 1)

        // The replaced wake's sleep returns normally although its task is cancelled.
        sleeper.fire()
        await settle { sleeper.returnedCount == 1 }
        // Give the replaced timer's task every chance to end the new wake.
        await settle { next.value > 0 }

        #expect(next.value == 0)
    }

    @Test func aWakeEndsOnceItsLastEventIsHandled() async throws {
        let slow = Gate()
        router.attach(userID: "a") { _ in await slow.wait() }
        let completion = CallCount()
        wake.begin { completion.record() }

        wake.receive(.finished(event()))
        wake.receive(.finishedEvents)
        try await eventually { slow.isWaiting }
        #expect(completion.value == 0)
        slow.open()

        try await eventually { completion.value == 1 }
    }

    @Test func aTaskFinishedWhileAnotherIsHandledReachesTheRouterAtOnce() async throws {
        let reports = UploadSessionReports()
        let slow = Gate()
        router.attach(userID: "a") { event in
            if event.tag.recordingID == "r1" { await slow.wait() }
        }
        let delivering = Task { await reports.deliver(to: wake) }

        reports.finished(event("r1"))
        try await eventually { slow.isWaiting }
        reports.finished(event("r2"))

        // Listed from the moment the session reports it, so a pass never starts it again.
        #expect(
            reports.undeliveredRecordingIDs(userID: "a").union(router.unhandledRecordingIDs(userID: "a")) == [
                "r1", "r2",
            ])
        try await eventually { router.unhandledRecordingIDs(userID: "a") == ["r1", "r2"] }
        #expect(reports.undeliveredRecordingIDs(userID: "a").isEmpty)
        slow.open()
        await router.waitForHandledEvents()
        delivering.cancel()
    }
}

/// A sleeper the test releases by hand that ignores cancellation, so only the caller's own
/// cancellation check can stop what follows the sleep.
@MainActor
final class UncancellableSleeper {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    /// How many sleeps have returned, counted once the sleeping task runs again.
    private(set) var returnedCount = 0

    var pendingCount: Int { waiting.count }

    nonisolated var sleep: Sleeper {
        { [self] _ in await wait() }
    }

    /// End every pending sleep, so no sleeping task is left suspended once a test ends.
    func releaseAll() {
        let released = waiting
        waiting.removeAll()
        for continuation in released { continuation.resume() }
    }

    /// End the oldest pending sleep.
    func fire() {
        guard !waiting.isEmpty else { return }
        waiting.removeFirst().resume()
    }

    private func wait() async {
        await withCheckedContinuation { waiting.append($0) }
        returnedCount += 1
    }
}

/// Counts calls to a `@Sendable` completion handler.
final class CallCount: Sendable {
    private let count = Mutex(0)

    var value: Int { count.withLock { $0 } }

    func record() {
        count.withLock { $0 += 1 }
    }
}
