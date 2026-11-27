import Synchronization

/// What the upload session reports to the main actor, in the order it reported it.
enum UploadSessionMessage: Sendable {
    case finished(UploadEvent)
    /// The session delivered every event of the current batch.
    case finishedEvents
}

/// Carries the upload session's reports from its delegate queue to the main actor, and lists the
/// tasks that finished but have not reached the router yet. Without that list, a task that
/// finishes while an earlier event is handled is neither running nor waiting, and the upload
/// pass would start it again.
final class UploadSessionReports: Sendable {
    private let messages: AsyncStream<UploadSessionMessage>
    private let continuation: AsyncStream<UploadSessionMessage>.Continuation
    /// How many reports of each tag are on their way to the router. A count, since a step
    /// started again under the same tag can finish twice before the first report is delivered.
    private let undelivered = Mutex<[UploadTaskTag: Int]>([:])

    init() {
        (messages, continuation) = AsyncStream<UploadSessionMessage>.makeStream()
    }

    /// Report a finished task. Call it from any thread, the moment the session reports the task.
    func finished(_ event: UploadEvent) {
        undelivered.withLock { $0[event.tag, default: 0] += 1 }
        continuation.yield(.finished(event))
    }

    /// Report that the session delivered every event of its current batch.
    func finishedEvents() {
        continuation.yield(.finishedEvents)
    }

    /// List the recordings of `userID` with a finished task on its way to the router.
    func undeliveredRecordingIDs(userID: String) -> Set<String> {
        undelivered.withLock { counts in
            Set(counts.keys.filter { $0.userID == userID }.map(\.recordingID))
        }
    }

    /// Hand every report to `wake`, in order, for as long as the reports last. Each finished
    /// event leaves the undelivered list only once the router holds it.
    @MainActor
    func deliver(to wake: BackgroundWake) async {
        for await message in messages {
            wake.receive(message)
            guard case .finished(let event) = message else { continue }
            undelivered.withLock { counts in
                let left = (counts[event.tag] ?? 1) - 1
                counts[event.tag] = left > 0 ? left : nil
            }
        }
    }
}

/// Holds the system's completion handler for one background wake and calls it exactly once:
/// when the session has finished its events and every one is handled, or when the time limit
/// passes, whichever is first.
@MainActor
final class BackgroundWake {
    private let router: UploadEventRouter
    private let limit: Duration
    private let sleep: Sleeper
    private var completion: (@Sendable () -> Void)?
    private var limitTask: Task<Void, Never>?
    private var sessionFinishedEvents = false
    /// Whether an event arrived since the last wake ended. A finished-events report with none
    /// belongs to a wake that already ended, such as one that ran out of time.
    private var eventSinceLastEnd = false

    init(router: UploadEventRouter, limit: Duration, sleep: @escaping Sleeper = liveSleeper) {
        self.router = router
        self.limit = limit
        self.sleep = sleep
        router.onDrained = { [weak self] in self?.endIfHandled() }
    }

    /// Start a wake. It ends at once when the session already finished a batch of events that
    /// arrived after the last wake ended and every one is handled.
    func begin(completion: @escaping @Sendable () -> Void) {
        // A new wake replaces one still open. The flag stays: the session may have finished
        // its events before the app delegate passed the new handler.
        limitTask?.cancel()
        self.completion?()
        self.completion = completion
        limitTask = Task { [weak self, sleep, limit] in
            do {
                try await sleep(limit)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self?.end()
        }
        endIfHandled()
    }

    /// Hand a session report to the router without waiting for it to be handled, so a later
    /// report is never held behind a slow handler. The wake ends once its batch is handled.
    func receive(_ message: UploadSessionMessage) {
        switch message {
        case .finished(let event):
            // An event after a finished-events report starts a new batch.
            sessionFinishedEvents = false
            eventSinceLastEnd = true
            router.enqueue(event)
        case .finishedEvents:
            sessionFinishedEvents = eventSinceLastEnd
        }
        endIfHandled()
    }

    /// End the wake once a newly attached handler has handled the events that waited for it.
    func handlerAttached() async {
        await router.waitForHandledEvents()
        endIfHandled()
    }

    private func endIfHandled() {
        guard completion != nil, sessionFinishedEvents, !router.hasUnhandledEvents else { return }
        end()
    }

    private func end() {
        limitTask?.cancel()
        limitTask = nil
        sessionFinishedEvents = false
        eventSinceLastEnd = false
        guard let completion else { return }
        self.completion = nil
        completion()
    }
}
