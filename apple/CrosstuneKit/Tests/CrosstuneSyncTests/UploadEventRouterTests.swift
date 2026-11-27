import Foundation
import Testing

@testable import CrosstuneSync

@MainActor
@Suite(.timeLimit(.minutes(1))) struct UploadEventRouterTests {
    let router = UploadEventRouter()

    func event(userID: String, recordingID: String = "r1") -> UploadEvent {
        UploadEvent(
            tag: UploadTaskTag(
                recordingID: recordingID, userID: userID, step: .put,
                url: URL(string: "https://storage.example.test/\(recordingID)?signature=abc")!),
            outcome: .status(200))
    }

    /// Attaches a handler for `userID` that records every event it receives.
    func attach(_ userID: String, into received: EventLog) {
        router.attach(userID: userID) { event in received.events.append(event) }
    }

    @Test func anEventWaitsForItsUsersHandler() async {
        let received = EventLog()
        let first = event(userID: "a", recordingID: "r1")
        let second = event(userID: "a", recordingID: "r2")
        await router.deliver(first)
        await router.deliver(second)

        attach("a", into: received)
        await router.waitForHandledEvents()

        #expect(received.events == [first, second])
    }

    @Test func listsAUsersRecordingsUntilTheirEventsAreHandled() async {
        await router.deliver(event(userID: "a", recordingID: "r1"))
        await router.deliver(event(userID: "b", recordingID: "r2"))
        #expect(router.unhandledRecordingIDs(userID: "a") == ["r1"])

        attach("a", into: EventLog())
        await router.waitForHandledEvents()

        #expect(router.unhandledRecordingIDs(userID: "a").isEmpty)
    }

    @Test func attachingAUserDropsAnotherUsersEvents() async {
        let receivedA = EventLog()
        let receivedB = EventLog()
        await router.deliver(event(userID: "b"))

        attach("a", into: receivedA)
        await router.waitForHandledEvents()
        attach("b", into: receivedB)
        await router.waitForHandledEvents()

        #expect(receivedA.events.isEmpty)
        #expect(receivedB.events.isEmpty)
    }

    @Test func anEventForAnotherUserIsDropped() async {
        let received = EventLog()
        attach("a", into: received)

        await router.deliver(event(userID: "b"))
        await router.waitForHandledEvents()

        #expect(received.events.isEmpty)
    }

    @Test func anEventWaitsAgainAfterItsUserDetaches() async {
        let received = EventLog()
        router.detach(router.attach(userID: "a") { received.events.append($0) })
        let waiting = event(userID: "a")

        await router.deliver(waiting)
        attach("a", into: received)
        await router.waitForHandledEvents()

        #expect(received.events == [waiting])
    }

    @Test func aReplacedHandlersDetachLeavesTheNewHandler() async {
        let received = EventLog()
        let replaced = router.attach(userID: "a") { _ in }
        attach("a", into: received)
        router.detach(replaced)

        await router.deliver(event(userID: "a"))

        #expect(received.events == [event(userID: "a")])
    }

    @Test func aTagSurvivesTheTaskDescription() throws {
        let tag = UploadTaskTag(
            recordingID: "r1", userID: "user-1", step: .confirm,
            url: URL(string: "https://storage.example.test/r1?X-Amz-Signature=abc&X-Amz-Expires=3600")!)

        #expect(UploadTaskTag(taskDescription: try tag.taskDescription()) == tag)
    }
}

/// The events one handler received, in order.
@MainActor
final class EventLog {
    var events: [UploadEvent] = []
}
