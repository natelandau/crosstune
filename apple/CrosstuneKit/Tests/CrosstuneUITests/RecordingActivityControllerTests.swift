import CrosstuneRecordingActivity
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneRecording
@testable import CrosstuneUI

@MainActor
private final class FakeActivityClient: RecordingActivityClient {
    enum Call: Equatable {
        case start(RecordingActivityState)
        case update(RecordingActivityState)
        case end(RecordingActivityState, dismissAfter: Duration?)
        case endAll
    }

    var calls: [Call] = []
    /// The stale date of each start and update, in order.
    var staleDates: [Date?] = []
    var allowsStart = true

    func start(_ state: RecordingActivityState, staleDate: Date?) -> Bool {
        calls.append(.start(state))
        staleDates.append(staleDate)
        return allowsStart
    }

    func update(_ state: RecordingActivityState, staleDate: Date?) {
        calls.append(.update(state))
        staleDates.append(staleDate)
    }

    func end(_ state: RecordingActivityState, dismissAfter: Duration?) {
        calls.append(.end(state, dismissAfter: dismissAfter))
    }

    func endAll() { calls.append(.endAll) }

    var ends: [(state: RecordingActivityState, dismissAfter: Duration?)] {
        calls.compactMap {
            if case .end(let state, let dismissAfter) = $0 { (state, dismissAfter) } else { nil }
        }
    }

    var updates: [RecordingActivityState] {
        calls.compactMap { if case .update(let state) = $0 { state } else { nil } }
    }
}

private func snapshot(
    _ state: Recorder.State, elapsed: TimeInterval = 0, resumeAvailable: Bool = false,
    savedRecordingID: String? = nil, errorMessage: String? = nil, levels: [Float] = [], levelCount: Int = 0
) -> RecorderSnapshot {
    RecorderSnapshot(
        state: state, elapsed: elapsed, resumeAvailable: resumeAvailable, savedRecordingID: savedRecordingID,
        errorMessage: errorMessage, levels: levels, levelCount: levelCount
    )
}

@MainActor
@Suite struct RecordingActivityControllerTests {
    private let client = FakeActivityClient()
    private let controller: RecordingActivityController
    private let now = Date(timeIntervalSinceReferenceDate: 1_000_000)

    init() {
        controller = RecordingActivityController(client: client)
    }

    /// Records, then stops after `elapsed` seconds, leaving the recorder saving.
    private func recordThenSave(elapsed: TimeInterval) {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(snapshot(.finishing, elapsed: elapsed), now: now.addingTimeInterval(elapsed))
    }

    @Test func startsWhenRecordingStarts() {
        controller.observe(snapshot(.recording, elapsed: 2), now: now)

        #expect(
            client.calls == [
                .start(
                    RecordingActivityState(
                        status: .recording, timerStart: now.addingTimeInterval(-2.5), elapsed: 2, canResume: false,
                        bars: RecordingActivityState.flatBars
                    )
                )
            ]
        )
    }

    @Test func startsWhenTheFirstStateSeenIsAnInterruption() {
        controller.observe(snapshot(.paused, elapsed: 1, resumeAvailable: true), now: now)

        #expect(
            client.calls == [
                .start(
                    RecordingActivityState(
                        status: .interrupted, timerStart: nil, elapsed: 1, canResume: true,
                        bars: RecordingActivityState.flatBars
                    )
                )
            ]
        )
    }

    @Test func resumeSendsANewTimerStart() {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(snapshot(.paused, elapsed: 5, resumeAvailable: true), now: now.addingTimeInterval(5))
        controller.observe(snapshot(.recording, elapsed: 5), now: now.addingTimeInterval(60))

        let resumed = client.updates.last
        #expect(resumed?.status == .recording)
        #expect(resumed?.timerStart == now.addingTimeInterval(54.5))
        #expect(client.calls.filter { if case .start = $0 { true } else { false } }.count == 1)
    }

    /// The running timer shows whole seconds dropped, the held time rounds them: at the moment
    /// of a pause the two must show the same second.
    @Test(arguments: [0.0, 0.4, 0.6, 2.5, 7.49], [0.0, 0.3, 0.5, 2.9, 61.2])
    func runningTimeMatchesTheHeldTimeOnPause(_ startElapsed: TimeInterval, _ recorded: TimeInterval) throws {
        controller.observe(snapshot(.recording, elapsed: startElapsed), now: now)
        let timerStart = try #require(
            client.calls.first.flatMap { call -> Date? in
                if case .start(let state) = call { state.timerStart } else { nil }
            })

        let pauseElapsed = startElapsed + recorded
        let pausedAt = now.addingTimeInterval(recorded)
        let timerSeconds = Int64(pausedAt.timeIntervalSince(timerStart).rounded(.down))
        let held = RecordingActivityText.wholeSeconds(of: Int64((pauseElapsed * 1000).rounded()))
        #expect(timerSeconds == held)
    }

    @Test(arguments: [false, true])
    func interruptionFreezesTimeAndOffersResumeOnlyWhenAvailable(_ resumeAvailable: Bool) {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(snapshot(.paused, elapsed: 7, resumeAvailable: resumeAvailable), now: now)

        #expect(
            client.updates.last
                == RecordingActivityState(
                    status: .interrupted, timerStart: nil, elapsed: 7, canResume: resumeAvailable,
                    bars: RecordingActivityState.flatBars
                )
        )
    }

    @Test func savingThenSavedEndsAfterTheSavedDelay() {
        recordThenSave(elapsed: 12)
        #expect(
            client.updates.last
                == RecordingActivityState(
                    status: .saving, timerStart: nil, elapsed: 12, canResume: false,
                    bars: RecordingActivityState.flatBars
                )
        )

        controller.observe(snapshot(.idle, elapsed: 12, savedRecordingID: "rec"), now: now)

        #expect(client.ends.count == 1)
        #expect(client.ends.first?.state.status == .saved)
        #expect(client.ends.first?.state.elapsed == 12)
        #expect(client.ends.first?.dismissAfter == RecordingActivityController.savedDismissal)
    }

    @Test func savedWithoutASeenSaveStillShowsSaved() {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(snapshot(.idle, elapsed: 9, savedRecordingID: "rec"), now: now)

        #expect(client.ends.count == 1)
        #expect(client.ends.first?.state.status == .saved)
        #expect(client.ends.first?.dismissAfter == RecordingActivityController.savedDismissal)
    }

    @Test func saveFailureEndsAsFailedAfterTheLongerDelay() {
        recordThenSave(elapsed: 3)
        controller.observe(snapshot(.idle, elapsed: 3, errorMessage: Recorder.saveFailed), now: now)

        #expect(client.ends.count == 1)
        #expect(client.ends.first?.state.status == .failed)
        #expect(client.ends.first?.dismissAfter == RecordingActivityController.failedDismissal)
    }

    enum Ending: CaseIterable {
        case discard, nothingRecorded, backOut
    }

    @Test(arguments: Ending.allCases)
    func discardBackOutAndNothingRecordedEndAtOnce(_ ending: Ending) {
        switch ending {
        case .discard:
            recordThenSave(elapsed: 3)
            controller.observe(snapshot(.idle, elapsed: 3), now: now)
        case .nothingRecorded:
            recordThenSave(elapsed: 0)
            controller.observe(snapshot(.idle, errorMessage: Recorder.nothingRecorded), now: now)
        case .backOut:
            controller.observe(snapshot(.recording), now: now)
            controller.observe(snapshot(.idle), now: now)
        }

        #expect(client.ends.count == 1)
        #expect(client.ends.first?.dismissAfter == nil)
        #expect(client.ends.allSatisfy { $0.state.status != .saved })
        #expect(client.updates.allSatisfy { $0.status != .saved })
    }

    @Test(arguments: [Recorder.sizeLimit, Recorder.partialSave])
    func endedEarlySaveShowsSaved(_ message: String) {
        recordThenSave(elapsed: 30)
        controller.observe(snapshot(.idle, elapsed: 30, savedRecordingID: "rec", errorMessage: message), now: now)

        #expect(client.ends.count == 1)
        #expect(client.ends.first?.state.status == .saved)
        #expect(client.ends.first?.dismissAfter == RecordingActivityController.savedDismissal)
    }

    @Test func repeatedIdleEndsOnce() {
        recordThenSave(elapsed: 4)
        let saved = snapshot(.idle, elapsed: 4, savedRecordingID: "rec")
        controller.observe(saved, now: now)
        controller.observe(saved, now: now)
        controller.observe(snapshot(.idle), now: now)

        #expect(client.ends.count == 1)
    }

    @Test func disabledActivitiesSendNothing() {
        client.allowsStart = false
        controller.observe(snapshot(.recording, levels: [0.5], levelCount: 1), now: now)
        let afterStart = client.calls

        controller.observe(snapshot(.recording, elapsed: 1, levels: [0.5, 0.6], levelCount: 2), now: now)
        controller.publishMeter(now: now)
        controller.observe(snapshot(.paused, elapsed: 1, resumeAvailable: true), now: now)
        controller.observe(snapshot(.finishing, elapsed: 1), now: now)
        controller.observe(snapshot(.idle, elapsed: 1, savedRecordingID: "rec"), now: now)

        #expect(afterStart.count == 1)
        #expect(client.calls == afterStart)
    }

    @Test func levelsWithNoLiveActivityAreNeverSent() {
        client.allowsStart = false
        controller.observe(snapshot(.recording, levels: [1], levelCount: 1), now: now)
        controller.observe(snapshot(.recording, elapsed: 1, levels: [1, 1], levelCount: 2), now: now)
        controller.observe(snapshot(.idle, elapsed: 1, levels: [1, 1], levelCount: 2), now: now)

        client.allowsStart = true
        controller.observe(snapshot(.recording, levels: [1, 1], levelCount: 2), now: now)
        controller.publishMeter(now: now)

        #expect(client.updates.allSatisfy { $0.bars == RecordingActivityState.flatBars })
    }

    @Test func meterSendsBarsOnlyWhileRecording() {
        controller.observe(snapshot(.recording, levels: [0.5, 1], levelCount: 2), now: now)
        controller.publishMeter(now: now)
        #expect(client.updates.last?.bars == MeterBars.reduce([0.5, 1]))
        #expect(client.updates.last?.status == .recording)

        controller.observe(snapshot(.paused, elapsed: 1, levels: [0.5, 1, 0.9], levelCount: 3), now: now)
        let whilePaused = client.calls.count
        controller.publishMeter(now: now)
        // Past the keep-alive interval too: only a recording goes stale.
        controller.publishMeter(now: now.addingTimeInterval(30))
        #expect(client.calls.count == whilePaused)
    }

    @Test func levelsWhileInterruptedStayOffTheMeterAfterResume() {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(
            snapshot(.paused, elapsed: 1, resumeAvailable: true, levels: [1, 1], levelCount: 2), now: now)
        controller.observe(snapshot(.recording, elapsed: 1, levels: [1, 1], levelCount: 2), now: now)
        let afterResume: [Float] = [0.1, 0.2]
        controller.observe(
            snapshot(.recording, elapsed: 2, levels: [1, 1] + afterResume, levelCount: 4), now: now)
        controller.publishMeter(now: now)

        #expect(client.updates.last?.bars == MeterBars.reduce(afterResume))
    }

    @Test func newRecorderRestartsTheMeter() {
        let window = [Float](repeating: 1, count: 100)
        controller.observe(snapshot(.recording, levels: window, levelCount: 500), now: now)
        let fresh: [Float] = [0.1, 0.2, 0.3]
        controller.observe(snapshot(.recording, levels: fresh, levelCount: 3), now: now)
        controller.publishMeter(now: now)

        #expect(client.updates.last?.bars == MeterBars.reduce(fresh))
    }

    @Test func onlyARecordingGoesStale() {
        controller.observe(snapshot(.recording), now: now)
        controller.observe(snapshot(.paused, elapsed: 5, resumeAvailable: true), now: now.addingTimeInterval(5))
        controller.observe(snapshot(.recording, elapsed: 5), now: now.addingTimeInterval(60))
        controller.observe(snapshot(.finishing, elapsed: 9), now: now.addingTimeInterval(64))

        #expect(
            client.staleDates == [
                now.addingTimeInterval(15), nil, now.addingTimeInterval(75), nil,
            ])
    }

    @Test func unchangedRecordingIsSentAgainOnceTheKeepAliveIntervalPasses() throws {
        controller.observe(snapshot(.recording), now: now)
        controller.publishMeter(now: now.addingTimeInterval(4.9))
        #expect(client.updates.isEmpty)

        controller.publishMeter(now: now.addingTimeInterval(5))
        #expect(client.updates.count == 1)
        let update = try #require(client.updates.first)
        #expect(update.status == .recording)
        // A stale activity holds this time.
        #expect(abs(update.elapsed - 5) < 0.001)
        #expect(client.staleDates.last == now.addingTimeInterval(20))
    }

    @Test func launchEndsLeftoverActivities() {
        controller.launch()
        #expect(client.calls == [.endAll])
    }

    @Test func hostForwardsStopAndResume() async throws {
        let root = TemporaryRoot()
        let input = ToneInput()
        let host = RecorderHost(makeInput: { input })
        let control: any RecordingControl = host
        await control.stop()
        await control.resume()
        #expect(host.current == nil)

        let store = try root.open()
        let recorder = try #require(host.claim(for: store))
        #expect(host.current === recorder)
        await recorder.start(tuneID: nil)
        try input.play(seconds: 0.5)
        input.send(.interrupted)
        input.send(.interruptionEnded)
        #expect(recorder.state == .paused)

        await control.resume()
        #expect(recorder.state == .recording)

        await control.stop()
        #expect(recorder.state == .idle)
        #expect(recorder.savedRecordingID != nil)
    }
}
