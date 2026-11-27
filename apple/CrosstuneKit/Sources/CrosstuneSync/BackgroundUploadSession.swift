import Foundation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "background-uploads")

/// Sends recording uploads and their token confirms on a background `URLSession`, so a transfer
/// finishes while the app is suspended or after it quits, and routes each result to the user it
/// belongs to.
@MainActor
public final class BackgroundUploadSession: NSObject, RecordingUploadTransport, URLSessionTaskDelegate {
    public static let shared = BackgroundUploadSession()

    /// The identifier the system reports when it wakes the app for this session's events.
    public static let identifier = "app.crosstune.Crosstune.recording-uploads"
    /// How long a wake waits for its events before it lets the system suspend the app. The
    /// system allows about 30 seconds.
    static let wakeLimit: Duration = .seconds(20)

    /// Where the API is served. Set it at launch: a confirm task needs it to build its URL.
    public var apiOrigin: URL?

    private let router: UploadEventRouter
    private let backgroundWake: BackgroundWake
    private nonisolated let reports = UploadSessionReports()
    private lazy var session = URLSession(
        configuration: Self.configuration(), delegate: self, delegateQueue: nil)

    override private init() {
        let router = UploadEventRouter()
        self.router = router
        backgroundWake = BackgroundWake(router: router, limit: Self.wakeLimit)
        super.init()
        // Creating the session at once reconnects to tasks that finished while the app was not
        // running, which is how the Mac app receives results after a quit.
        _ = session
        Task { [reports, backgroundWake] in
            await reports.deliver(to: backgroundWake)
        }
    }

    private static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.urlCache = nil
        return configuration
    }

    // MARK: - RecordingUploadTransport

    public func startPut(_ tag: UploadTaskTag, file: URL, contentType: String) {
        var request = URLRequest(url: tag.url)
        request.httpMethod = "PUT"
        // The slot's signature covers the type, so the bucket refuses any other.
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        start(tag, request: request, body: file)
    }

    public func startConfirm(_ tag: UploadTaskTag, token: String) {
        guard let apiOrigin else {
            // A launch-order bug, not a failed attempt: report nothing, so the hand-off is not
            // charged a retry, and the pass starts the confirm again once the origin is set.
            logger.error(
                "Confirm for \(tag.recordingID, privacy: .public) has no API origin; set apiOrigin at launch")
            assertionFailure("BackgroundUploadSession.apiOrigin is nil; expected it set at launch")
            return
        }
        let body: URL
        do {
            body = try emptyBodyFile()
        } catch {
            logger.error(
                "Confirm for \(tag.recordingID, privacy: .public) has no body file: \(error, privacy: .public)")
            failWithoutSending(tag)
            return
        }
        let url = apiOrigin.appending(path: "v1/recordings/\(tag.recordingID)/uploaded-with-token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "X-Upload-Token")
        start(tag, request: request, body: body)
    }

    public func runningRecordingIDs(userID: String) async -> Set<String> {
        let running = Set(await tasks(where: { $0.userID == userID }).map(\.tag.recordingID))
        // Read after the task list, so a task that finishes meanwhile is still in one of them.
        return running.union(reports.undeliveredRecordingIDs(userID: userID))
            .union(router.unhandledRecordingIDs(userID: userID))
    }

    public func cancel(recordingIDs: Set<String>, userID: String) async {
        for (task, _) in await tasks(where: { $0.userID == userID && recordingIDs.contains($0.recordingID) }) {
            task.cancel()
        }
    }

    public func cancelAll(userID: String) async {
        for (task, _) in await tasks(where: { $0.userID == userID }) { task.cancel() }
    }

    public func cancelAll(exceptUserIDs userIDs: Set<String>) async {
        for (task, _) in await tasks(where: { !userIDs.contains($0.userID) }) { task.cancel() }
    }

    public func attach(
        userID: String, handler: @escaping @MainActor (UploadEvent) async -> Void
    ) -> UploadHandlerAttachment {
        let attachment = router.attach(userID: userID, handler: handler)
        Task { await backgroundWake.handlerAttached() }
        return attachment
    }

    public func detach(_ attachment: UploadHandlerAttachment) {
        router.detach(attachment)
    }

    // MARK: - Background wake

    /// Keep the system's completion handler for a background wake and call it once the session
    /// has delivered its events and every one is handled, or once the wake's time limit passes.
    /// Call it from the app delegate's background session hook.
    public func wake(completion: @escaping @Sendable () -> Void) {
        backgroundWake.begin(completion: completion)
    }

    // MARK: - URLSessionTaskDelegate

    public nonisolated func urlSession(
        _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
    ) {
        guard let tag = UploadTaskTag(taskDescription: task.taskDescription) else {
            logger.error("Upload task \(task.taskIdentifier) finished with no readable tag")
            return
        }
        if let error = error as? URLError, error.code == .cancelled { return }
        let outcome: StepOutcome
        if error == nil, let response = task.response as? HTTPURLResponse {
            outcome = .status(response.statusCode)
        } else {
            outcome = .networkError
        }
        reports.finished(UploadEvent(tag: tag, outcome: outcome))
    }

    public nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        reports.finishedEvents()
    }

    // MARK: - Private

    private func start(_ tag: UploadTaskTag, request: URLRequest, body: URL) {
        let description: String
        do {
            description = try tag.taskDescription()
        } catch {
            logger.error(
                "Upload task for \(tag.recordingID, privacy: .public) has no tag: \(error, privacy: .public)")
            failWithoutSending(tag)
            return
        }
        let task = session.uploadTask(with: request, fromFile: body)
        task.taskDescription = description
        task.resume()
    }

    /// Report a step that could not be sent as a network error, so the hand-off counts a retry
    /// instead of waiting on a task that never started.
    private func failWithoutSending(_ tag: UploadTaskTag) {
        reports.finished(UploadEvent(tag: tag, outcome: .networkError))
    }

    private func tasks(
        where matches: (UploadTaskTag) -> Bool
    ) async -> [(task: URLSessionTask, tag: UploadTaskTag)] {
        await session.allTasks.compactMap { task in
            guard let tag = UploadTaskTag(taskDescription: task.taskDescription), matches(tag) else { return nil }
            return (task, tag)
        }
    }

    /// The empty file a confirm task sends: a background session uploads only from a file.
    /// Checked on every call, since the system may purge Caches while the app is suspended.
    private func emptyBodyFile() throws -> URL {
        let file = URL.cachesDirectory.appending(path: "upload-confirm-body")
        if !FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) {
            try Data().write(to: file)
        }
        return file
    }
}
