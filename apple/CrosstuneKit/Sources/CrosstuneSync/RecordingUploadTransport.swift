import Foundation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "background-uploads")

/// Which request of a recording upload a task sends.
public enum UploadStep: String, Codable, Sendable {
    case put
    case confirm
}

/// What a finished upload task needs to find its hand-off, carried on the task itself so it
/// survives the app being suspended or relaunched.
public struct UploadTaskTag: Codable, Hashable, Sendable {
    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    public let recordingID: String
    public let userID: String
    public let step: UploadStep
    /// The hand-off's signed URL, which identifies the hand-off the task belongs to.
    public let url: URL

    public init(recordingID: String, userID: String, step: UploadStep, url: URL) {
        self.recordingID = recordingID
        self.userID = userID
        self.step = step
        self.url = url
    }

    /// Read a tag back from a task's description. Returns `nil` for a task with no description
    /// or one that does not decode.
    public init?(taskDescription: String?) {
        guard let taskDescription else { return nil }
        do {
            self = try Self.decoder.decode(Self.self, from: Data(taskDescription.utf8))
        } catch let error as DecodingError {
            // Never log the description itself: it holds a signed URL.
            logger.error("Upload task tag does not decode: \(Self.summary(of: error), privacy: .public)")
            return nil
        } catch {
            logger.error("Upload task tag does not decode: \(String(describing: type(of: error)), privacy: .public)")
            return nil
        }
    }

    /// The kind and coding path of a decoding error, which name no decoded value.
    private static func summary(of error: DecodingError) -> String {
        let (kind, context): (String, DecodingError.Context?) =
            switch error {
            case .typeMismatch(_, let context): ("typeMismatch", context)
            case .valueNotFound(_, let context): ("valueNotFound", context)
            case .keyNotFound(let key, let context): ("keyNotFound \(key.stringValue)", context)
            case .dataCorrupted(let context): ("dataCorrupted", context)
            @unknown default: ("unknown", nil)
            }
        let path = context?.codingPath.map(\.stringValue).joined(separator: ".") ?? ""
        return "\(kind) at '\(path)'"
    }

    /// Encode the tag for `URLSessionTask.taskDescription`, the one field a background task keeps
    /// across a relaunch.
    public func taskDescription() throws -> String {
        String(decoding: try Self.encoder.encode(self), as: UTF8.self)
    }
}

/// How one upload task ended. A cancelled task produces no event.
public struct UploadEvent: Hashable, Sendable {
    public let tag: UploadTaskTag
    public let outcome: StepOutcome

    public init(tag: UploadTaskTag, outcome: StepOutcome) {
        self.tag = tag
        self.outcome = outcome
    }
}

/// One attached event handler. Detaching with it removes only that handler, so an engine that
/// is released late never removes the handler of a newer engine for the same user.
public struct UploadHandlerAttachment: Hashable, Sendable {
    public let userID: String
    private let id = UUID()

    public init(userID: String) {
        self.userID = userID
    }
}

/// Sends a recording's upload and token confirm as tasks that outlive the app, and reports
/// each finished task to the handler of the user it belongs to.
@MainActor
public protocol RecordingUploadTransport: AnyObject {
    /// Start sending `file` to the hand-off's signed URL. The result arrives as an event.
    func startPut(_ tag: UploadTaskTag, file: URL, contentType: String)
    /// Start the token confirm for a hand-off whose upload landed. The result arrives as an event.
    func startConfirm(_ tag: UploadTaskTag, token: String)
    /// List the recordings of `userID` that have a task still running, or a finished one whose
    /// result is not handled yet, so the upload pass never starts a second one.
    func runningRecordingIDs(userID: String) async -> Set<String>
    /// Cancel the running tasks of the recordings in `recordingIDs`, before the upload pass takes
    /// their hand-offs back and starts new uploads. A cancelled task reports no event.
    func cancel(recordingIDs: Set<String>, userID: String) async
    /// Cancel every task of `userID`, before that user's files are deleted.
    func cancelAll(userID: String) async
    /// Cancel the tasks of every user not in `userIDs`, before those users' folders are deleted.
    func cancelAll(exceptUserIDs userIDs: Set<String>) async
    /// Receive the events of `userID`, including those that finished before this call. Keep
    /// the attachment to detach this handler later.
    func attach(userID: String, handler: @escaping @MainActor (UploadEvent) async -> Void) -> UploadHandlerAttachment
    /// Stop receiving events through `attachment`. Does nothing when another handler replaced it.
    /// Later events wait for the next handler.
    func detach(_ attachment: UploadHandlerAttachment)
}

/// A transport for builds with no server. Every call does nothing.
@MainActor
public final class UploadsDisabled: RecordingUploadTransport {
    public init() {}

    public func startPut(_ tag: UploadTaskTag, file: URL, contentType: String) {}
    public func startConfirm(_ tag: UploadTaskTag, token: String) {}
    public func runningRecordingIDs(userID: String) async -> Set<String> { [] }
    public func cancel(recordingIDs: Set<String>, userID: String) async {}
    public func cancelAll(userID: String) async {}
    public func cancelAll(exceptUserIDs userIDs: Set<String>) async {}
    public func attach(
        userID: String, handler: @escaping @MainActor (UploadEvent) async -> Void
    ) -> UploadHandlerAttachment {
        UploadHandlerAttachment(userID: userID)
    }
    public func detach(_ attachment: UploadHandlerAttachment) {}
}
