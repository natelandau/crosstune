import Foundation

/// A recording upload handed to a background worker: the signed slot it sends to and the
/// token that confirms it, kept on the file row so the worker and the app agree on who owns
/// the file.
public struct UploadHandoff: Codable, Hashable, Sendable {
    /// Failed runs after which the app takes the file back from the worker.
    public static let takeBackAttempts = 3

    /// The signed address the audio is sent to.
    public var url: URL
    public var confirmToken: String
    public var contentType: String
    /// When the signed slot stops accepting the upload.
    public var expiresAt: Timestamp
    public var attempts: Int
    /// The server refused the confirm for good, so the worker must not retry it.
    public var refused: Bool
    /// The status the confirm was refused with. The upload pass reads it when it takes the file
    /// back, since a size mismatch fails the file where any other refusal retries it.
    public var refusedStatus: Int?
    /// The bytes reached the server, so the next run sends only the confirm.
    public var putLanded: Bool
    /// Why the last attempt failed, nil when none has. The upload pass reports it, so a file that
    /// keeps failing shows as failing even though its tasks run outside the pass.
    public var lastFailure: AttemptFailure?

    /// The answer, or the missing answer, that failed one attempt.
    public enum AttemptFailure: Codable, Hashable, Sendable {
        /// The storage host answered the upload with this status.
        case uploadStatus(Int)
        /// The server answered the confirm with this status.
        case confirmStatus(Int)
        /// The request got no answer.
        case network
    }

    /// Whether the worker must give the file back to the app: the server refused the confirm,
    /// or the hand-off ran out of tries.
    public var shouldTakeBack: Bool { refused || attempts >= Self.takeBackAttempts }

    enum CodingKeys: String, CodingKey {
        case url
        case confirmToken = "confirm_token"
        case contentType = "content_type"
        case expiresAt = "expires_at"
        case attempts
        case refused
        case refusedStatus = "refused_status"
        case putLanded = "put_landed"
        case lastFailure = "last_failure"
    }

    public init(
        url: URL, confirmToken: String, contentType: String, expiresAt: Timestamp, attempts: Int = 0,
        refused: Bool = false, refusedStatus: Int? = nil, putLanded: Bool = false,
        lastFailure: AttemptFailure? = nil
    ) {
        self.url = url
        self.confirmToken = confirmToken
        self.contentType = contentType
        self.expiresAt = expiresAt
        self.attempts = attempts
        self.refused = refused
        self.refusedStatus = refusedStatus
        self.putLanded = putLanded
        self.lastFailure = lastFailure
    }
}
