/// Hands finished upload tasks to the signed-in user's handler. A task can finish before that
/// user's store opens, or after another user signs in, so events wait for their handler and
/// never reach the wrong user.
@MainActor
public final class UploadEventRouter {
    private struct Attached {
        let attachment: UploadHandlerAttachment
        let handler: @MainActor (UploadEvent) async -> Void
    }

    private var attached: Attached?
    private var waiting: [UploadEvent] = []
    private var handling: UploadEvent?
    private var draining: Task<Void, Never>?
    /// Called each time the router has handed over every event it can, so a background wake can
    /// end without its caller waiting on the handler.
    var onDrained: (@MainActor () -> Void)?

    public init() {}

    /// Whether an event is still waiting for a handler or being handled.
    public var hasUnhandledEvents: Bool { !waiting.isEmpty || draining != nil }

    /// List the recordings of `userID` with an event waiting or being handled. Their task has
    /// finished, but its result has not reached the file row yet, so the upload pass must not
    /// start the step again.
    public func unhandledRecordingIDs(userID: String) -> Set<String> {
        Set((waiting + [handling].compactMap(\.self)).filter { $0.tag.userID == userID }.map(\.tag.recordingID))
    }

    /// Queue an event for its user's handler and return at once, so an event that arrives while
    /// another is handled is listed by ``unhandledRecordingIDs(userID:)`` straight away. An event
    /// for a user other than the attached one is dropped.
    public func enqueue(_ event: UploadEvent) {
        if let attached, attached.attachment.userID != event.tag.userID { return }
        waiting.append(event)
        startDrainingIfNeeded()
    }

    /// Queue an event as ``enqueue(_:)`` does and return once every event that has a handler is
    /// handled.
    func deliver(_ event: UploadEvent) async {
        enqueue(event)
        await waitForHandledEvents()
    }

    /// Start handing `userID`'s events to `handler`, the waiting ones first, in order. Every
    /// waiting event of another user is dropped. Keep the attachment to detach this handler.
    @discardableResult
    public func attach(
        userID: String, handler: @escaping @MainActor (UploadEvent) async -> Void
    ) -> UploadHandlerAttachment {
        let attachment = UploadHandlerAttachment(userID: userID)
        attached = Attached(attachment: attachment, handler: handler)
        waiting.removeAll { $0.tag.userID != userID }
        startDrainingIfNeeded()
        return attachment
    }

    /// Stop handing events to the handler `attachment` names. Does nothing when a newer handler
    /// replaced it. Events that arrive later wait for the next handler.
    public func detach(_ attachment: UploadHandlerAttachment) {
        guard attached?.attachment == attachment else { return }
        attached = nil
    }

    /// Wait until every event that has a handler is handled.
    public func waitForHandledEvents() async {
        await draining?.value
    }

    /// Keep one drain running at a time, so a handler never sees two events at once or out of
    /// order.
    private func startDrainingIfNeeded() {
        guard draining == nil, attached != nil, !waiting.isEmpty else { return }
        draining = Task { await handleWaiting() }
    }

    private func handleWaiting() async {
        while let attached, !waiting.isEmpty {
            let event = waiting.removeFirst()
            guard event.tag.userID == attached.attachment.userID else { continue }
            handling = event
            await attached.handler(event)
            handling = nil
        }
        draining = nil
        onDrained?()
    }
}
