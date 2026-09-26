import CrosstuneStore
import Foundation

/// The API calls the sync engine makes, so tests can run it against a fake server.
public protocol SyncAPI: Sendable {
    /// Sends a batch of changes; the server answers each one.
    func push(_ changes: [Change]) async throws -> [PushResult]
    /// One page of rows the server changed after `since`.
    func pull(since: Int64) async throws -> PullPage
    /// The account's recording storage figures.
    func storage() async throws -> StorageFigures
    /// The provider, canonical URL, title, and artwork for a pasted link.
    func resolveLink(url: String) async throws -> ResolvedLink
    /// A signed URL to PUT one recording's file to, once the quota allows its size.
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL
    /// Confirms the file landed, so the server transcodes it.
    func uploadFinished(recordingID: String) async throws
    /// A signed URL to GET a ready recording's playback file from.
    func downloadURL(recordingID: String) async throws -> URL
    /// Asks the server to transcode a failed recording's upload again.
    func retryRecording(recordingID: String) async throws
    /// PUTs a file to a signed URL. The signature is the credential, so no session token goes
    /// with it.
    func putObject(_ url: URL, file: URL, contentType: String) async throws
    /// GETs a signed URL into `destination`, replacing any file there.
    func getObject(_ url: URL, to destination: URL) async throws
}

/// One pushed change: an outbox entry as the API takes it.
public struct Change: Hashable, Sendable {
    public var table: SyncTable
    public var op: OutboxEntry.Operation
    public var id: String
    public var updatedAt: Timestamp
    /// The row's change data for an upsert; nil for a delete.
    public var data: JSONObject?

    public init(table: SyncTable, op: OutboxEntry.Operation, id: String, updatedAt: Timestamp, data: JSONObject?) {
        self.table = table
        self.op = op
        self.id = id
        self.updatedAt = updatedAt
        self.data = data
    }

    public init(_ entry: OutboxEntry) {
        self.init(table: entry.tableName, op: entry.op, id: entry.rowID, updatedAt: entry.updatedAt, data: entry.data)
    }
}

/// One server row in a pull page, as the API sent it.
public struct PulledRow: Hashable, Sendable {
    public var table: SyncTable
    public var row: JSONObject

    public init(table: SyncTable, row: JSONObject) {
        self.table = table
        self.row = row
    }
}

public struct PullPage: Hashable, Sendable {
    public var rows: [PulledRow]
    /// The cursor the next page starts after.
    public var nextSince: Int64
    public var hasMore: Bool

    public init(rows: [PulledRow], nextSince: Int64, hasMore: Bool) {
        self.rows = rows
        self.nextSince = nextSince
        self.hasMore = hasMore
    }
}

/// What the server found at a pasted link.
public struct ResolvedLink: Hashable, Sendable {
    public var provider: String
    public var url: String
    public var providerRef: String?
    public var title: String?
    public var artworkURL: String?

    public init(
        provider: String, url: String, providerRef: String? = nil, title: String? = nil, artworkURL: String? = nil
    ) {
        self.provider = provider
        self.url = url
        self.providerRef = providerRef
        self.title = title
        self.artworkURL = artworkURL
    }
}

/// The API answered with an error status.
public struct APIStatusError: Error, Equatable {
    public let status: Int
    /// The problem document's `type`, which names a refusal a client handles on its own.
    public let problemType: String?
    /// The problem document's `detail`, written for the musician.
    public let detail: String?

    public init(status: Int, problemType: String? = nil, detail: String? = nil) {
        self.status = status
        self.problemType = problemType
        self.detail = detail
    }

    /// Why the request failed, as a recording's row shows it.
    public var message: String { detail ?? "API request failed with status \(status)" }
}

/// A signed object PUT or GET failed. It carries no problem document: the signature, not the
/// API, is its contract.
public struct TransferError: Error, Equatable {
    public let status: Int

    public init(status: Int) {
        self.status = status
    }

    public var message: String { "Object transfer failed with status \(status)" }
}
