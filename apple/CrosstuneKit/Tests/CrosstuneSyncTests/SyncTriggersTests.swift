import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync

@MainActor
@Suite struct SyncTriggersTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let sleeper = ManualSleeper()
    let syncs = Counter()

    init() throws {
        store = try root.open()
    }

    func triggers(isActive: Bool? = true) -> SyncTriggers {
        let syncs = syncs
        return SyncTriggers(store: store, isActive: isActive, sleep: sleeper.sleep) { syncs.count += 1 }
    }

    func putRecording(id: String = "r1", state: String) async throws {
        try await store.write { writer in
            try writer.put(Recording(id: id, tuneID: nil, source: "microphone", recordedAt: noon, state: state))
        }
    }

    /// Starts the triggers and waits for the store's first answer to both watches.
    func started(_ triggers: SyncTriggers) async throws {
        triggers.start()
        try await waitUntil { triggers.outboxCount != nil && triggers.processing != nil }
    }

    @Test func syncsOnLaunchOnReturningToTheForegroundAndOnComingOnline() async throws {
        let triggers = triggers(isActive: false)
        triggers.start()
        #expect(syncs.count == 1)

        triggers.setActive(true)
        #expect(syncs.count == 2)
        triggers.setActive(true)
        #expect(syncs.count == 2)
        triggers.setActive(false)
        #expect(syncs.count == 2)

        triggers.cameOnline()
        #expect(syncs.count == 3)

        triggers.stop()
        triggers.cameOnline()
        triggers.setActive(true)
        #expect(syncs.count == 3)
    }

    @Test func launchSyncsOnceWhenTheSceneReportsItsPhaseAfterStart() async throws {
        let triggers = triggers(isActive: nil)
        triggers.start()
        triggers.setActive(true)
        #expect(syncs.count == 1)

        triggers.setActive(false)
        triggers.setActive(true)
        #expect(syncs.count == 2)
        triggers.stop()
    }

    @Test func syncsOnceAfterABurstOfEditsSettles() async throws {
        let triggers = triggers()
        triggers.start()
        try await createTune(store, title: "A")
        try await waitUntil { sleeper.requested.count == 1 }
        try await createTune(store, title: "B")
        try await waitUntil { sleeper.requested.count == 2 }
        #expect(sleeper.requested == [SyncTriggers.writeDebounce, SyncTriggers.writeDebounce])
        // The second edit cancelled the first wait.
        try await waitUntil { sleeper.pendingCount == 1 }
        #expect(syncs.count == 1)

        sleeper.fire()
        try await waitUntil { syncs.count == 2 }
        #expect(!triggers.isDebouncing)
        #expect(sleeper.pendingCount == 0)
        triggers.stop()
    }

    @Test func anEmptyOutboxStartsNoDebounce() async throws {
        let triggers = triggers()
        try await started(triggers)
        #expect(triggers.outboxCount == 0)
        #expect(!triggers.isDebouncing)
        triggers.stop()
    }

    @Test func stoppingCancelsAPendingDebounce() async throws {
        let triggers = triggers()
        triggers.start()
        try await createTune(store, title: "A")
        try await waitUntil { sleeper.pendingCount == 1 }

        triggers.stop()

        #expect(!triggers.isDebouncing)
        try await waitUntil { sleeper.pendingCount == 0 }
        #expect(syncs.count == 1)
    }

    @Test func pollsWhileARecordingIsProcessingAndStopsOnceNoneRemain() async throws {
        try await putRecording(state: "uploaded")
        let triggers = triggers()
        triggers.start()
        // The put queued a change, so the debounce waits beside the poll.
        try await waitUntil { sleeper.pendingDurations.contains(SyncTriggers.processingPoll) }

        sleeper.fire(SyncTriggers.processingPoll)
        try await waitUntil { syncs.count == 2 }
        sleeper.fire(SyncTriggers.processingPoll)
        try await waitUntil { syncs.count == 3 }
        #expect(sleeper.pendingDurations.contains(SyncTriggers.processingPoll))

        try await putRecording(state: "ready")
        try await waitUntil { !sleeper.pendingDurations.contains(SyncTriggers.processingPoll) }
        triggers.stop()
    }

    @Test func doesNotPollForADeletedRecording() async throws {
        try await putRecording(state: "processing")
        try await store.write { writer in
            try writer.tombstone(Recording.self, id: "r1")
            try OutboxEntry.deleteAll(writer.db)
        }
        let triggers = triggers()
        try await started(triggers)
        #expect(triggers.processing == false)
        #expect(!triggers.isPolling)
        triggers.stop()
    }

    @Test func pollsOnlyWhileTheAppIsActive() async throws {
        try await putRecording(state: "processing")
        try await store.write { writer in try OutboxEntry.deleteAll(writer.db) }
        let triggers = triggers(isActive: false)
        try await started(triggers)
        #expect(triggers.processing == true)
        #expect(!triggers.isPolling)

        triggers.setActive(true)
        #expect(triggers.isPolling)
        try await waitUntil { sleeper.pendingDurations == [SyncTriggers.processingPoll] }

        triggers.setActive(false)
        #expect(!triggers.isPolling)
        try await waitUntil { sleeper.pendingCount == 0 }
        triggers.stop()
    }
}
