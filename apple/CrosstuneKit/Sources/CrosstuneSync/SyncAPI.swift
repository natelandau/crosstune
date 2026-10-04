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
    /// Recordings matching `q` on each of `providers`, one group per service in the server's
    /// order. `country` is the storefront the services search, as two letters.
    func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse
    /// A signed URL to PUT one recording's file to, once the quota allows its size.
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL
    /// Confirms the file landed, so the server transcodes it.
    func uploadFinished(recordingID: String) async throws
    /// A signed URL to GET a ready recording's playback file from, tagged with the revision and
    /// start the server actually signed it for.
    func downloadURL(recordingID: String) async throws -> DownloadURL
    /// A signed URL to GET a ready recording's waveform from, tagged with the revision the
    /// server actually signed it for.
    func peaksURL(recordingID: String) async throws -> PeaksURL
    /// A signed URL to PUT one notation page's JPEG to, once the quota allows its size.
    func notationUploadSlot(pageID: String, bytes: Int64) async throws -> SignedURL
    /// Confirms a notation page's image landed, so the server marks the page ready.
    func notationUploaded(pageID: String) async throws
    /// A signed URL to GET a ready notation page's image from.
    func notationDownload(pageID: String) async throws -> SignedURL
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

/// What a recording search found, one group per service searched.
public struct SearchResponse: Hashable, Sendable {
    public var groups: [SearchGroup]

    public init(groups: [SearchGroup]) {
        self.groups = groups
    }
}

/// One service's answer to a search, and its own search page as the fallback.
public struct SearchGroup: Hashable, Sendable {
    public enum Status: Hashable, Sendable {
        /// The service answered; `results` may be empty.
        case results
        /// The service failed or timed out; its search page stands in.
        case unavailable
        /// The service cannot be searched from here; only its search page shows.
        case searchOnly

        /// A status this build does not know shows only the search page, which every group has.
        public init(wire: String) {
            switch wire {
            case "results": self = .results
            case "unavailable": self = .unavailable
            default: self = .searchOnly
            }
        }
    }

    public var provider: String
    public var status: Status
    public var results: [SearchResult]
    public var searchURL: String

    public init(provider: String, status: Status, results: [SearchResult], searchURL: String) {
        self.provider = provider
        self.status = status
        self.results = results
        self.searchURL = searchURL
    }
}

/// One recording a service found, in the form a paste of its URL would store.
public struct SearchResult: Hashable, Sendable {
    public var url: String
    public var provider: String
    public var providerRef: String?
    public var title: String
    public var subtitle: String?
    public var artworkURL: String?

    public init(
        url: String, provider: String, providerRef: String? = nil, title: String, subtitle: String? = nil,
        artworkURL: String? = nil
    ) {
        self.url = url
        self.provider = provider
        self.providerRef = providerRef
        self.title = title
        self.subtitle = subtitle
        self.artworkURL = artworkURL
    }
}

/// How a recording search ended, as the sheet shows it.
public enum RecordingSearchOutcome: Hashable, Sendable {
    case ok([SearchGroup])
    /// The device has no connection, so nothing was sent.
    case offline
    /// The server refused more searches for now; `retryAfter` is in seconds.
    case rateLimited(retryAfter: Int)
    case failed
}

/// A signed GET for the playback file, tagged with what the server actually signed. A pull that
/// lands mid-download can leave the row's own `playbackRev` behind this by the time the
/// download finishes, so the downloaded bytes are tagged with this, not the row's.
public struct DownloadURL: Hashable, Sendable {
    public var url: URL
    public var playbackRev: String
    public var playbackStartMs: Int64

    public init(url: URL, playbackRev: String, playbackStartMs: Int64) {
        self.url = url
        self.playbackRev = playbackRev
        self.playbackStartMs = playbackStartMs
    }
}

/// A signed PUT or GET for one object.
public struct SignedURL: Hashable, Sendable {
    public var url: URL

    public init(url: URL) {
        self.url = url
    }
}

/// A signed GET for the waveform file, tagged with what the server actually signed, for the same
/// reason ``DownloadURL`` is.
public struct PeaksURL: Hashable, Sendable {
    public var url: URL
    public var peaksRev: String

    public init(url: URL, peaksRev: String) {
        self.url = url
        self.peaksRev = peaksRev
    }
}

/// The API answered with an error status.
public struct APIStatusError: Error, Equatable {
    public let status: Int
    /// The problem document's `type`, which names a refusal a client handles on its own.
    public let problemType: String?
    /// The problem document's `detail`, written for the musician.
    public let detail: String?
    /// The whole seconds a 429's `Retry-After` names; nil when it names none or is a date.
    public let retryAfterSeconds: Int?

    public init(status: Int, problemType: String? = nil, detail: String? = nil, retryAfterSeconds: Int? = nil) {
        self.status = status
        self.problemType = problemType
        self.detail = detail
        self.retryAfterSeconds = retryAfterSeconds
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
