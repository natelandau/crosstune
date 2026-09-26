import CrosstuneAPI
import CrosstuneStore
import Foundation
import OpenAPIRuntime

/// ``SyncAPI`` over the generated API client, with recording files moved by `URLSession`.
public struct LiveSyncAPI: SyncAPI {
    let client: Client
    let session: URLSession
    let storageOrigin: URL?

    /// - Parameters:
    ///   - session: Moves recording files to and from their signed URLs.
    ///   - storageOrigin: Where a signed URL that names only a path resolves, as a browser
    ///     resolves it against the page. A local API signs storage URLs as `/storage/...` for
    ///     the web dev server's proxy; a hosted API signs absolute URLs and needs none.
    public init(client: Client, session: URLSession = .shared, storageOrigin: URL? = nil) {
        self.client = client
        self.session = session
        self.storageOrigin = storageOrigin
    }

    public func push(_ changes: [Change]) async throws -> [PushResult] {
        let request = Components.Schemas.PushRequest(changes: try changes.map(WireFormat.change))
        switch try await client.pushV1SyncPushPost(.init(body: .json(request))) {
        case .ok(let response): return try WireFormat.pushResults(response.body.json)
        case .unprocessableContent: throw APIStatusError(status: 422)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func pull(since: Int64) async throws -> PullPage {
        switch try await client.pullV1SyncPullGet(.init(query: .init(since: Int(since)))) {
        case .ok(let response): return try WireFormat.pullPage(response.body.json)
        case .unprocessableContent: throw APIStatusError(status: 422)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func storage() async throws -> StorageFigures {
        switch try await client.meV1MeGet(.init()) {
        case .ok(let response):
            let storage = try response.body.json.storage
            return StorageFigures(
                usedBytes: storage.usedBytes, quotaBytes: storage.quotaBytes, maxFileBytes: storage.maxFileBytes)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func resolveLink(url: String) async throws -> ResolvedLink {
        switch try await client.resolveV1LinksResolvePost(.init(body: .json(.init(url: url)))) {
        case .ok(let response):
            let link = try response.body.json
            return ResolvedLink(
                provider: link.provider, url: link.url, providerRef: link.providerRef, title: link.title,
                artworkURL: link.artworkUrl)
        case .unprocessableContent: throw APIStatusError(status: 422)
        case .tooManyRequests: throw APIStatusError(status: 429)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        let input = Operations.UploadSlotV1RecordingsRecordingIdUploadSlotPost.Input(
            path: .init(recordingId: recordingID),
            body: .json(.init(bytes: Int(bytes), contentType: contentType)))
        switch try await client.uploadSlotV1RecordingsRecordingIdUploadSlotPost(input) {
        case .ok(let response): return try signedURL(try response.body.json.url)
        case .notFound(let response): throw Self.refusal(404, try? response.body.applicationProblemJson)
        case .conflict(let response): throw Self.refusal(409, try? response.body.applicationProblemJson)
        case .contentTooLarge(let response): throw Self.refusal(413, try? response.body.applicationProblemJson)
        case .unprocessableContent(let response):
            throw Self.refusal(422, try? response.body.applicationProblemJson)
        case .serviceUnavailable(let response):
            throw Self.refusal(503, try? response.body.applicationProblemJson)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func uploadFinished(recordingID: String) async throws {
        let input = Operations.UploadFinishedV1RecordingsRecordingIdUploadedPost.Input(
            path: .init(recordingId: recordingID))
        switch try await client.uploadFinishedV1RecordingsRecordingIdUploadedPost(input) {
        case .noContent: return
        case .notFound(let response): throw Self.refusal(404, try? response.body.applicationProblemJson)
        case .conflict(let response): throw Self.refusal(409, try? response.body.applicationProblemJson)
        case .contentTooLarge(let response): throw Self.refusal(413, try? response.body.applicationProblemJson)
        case .unprocessableContent(let response):
            throw Self.refusal(422, try? response.body.applicationProblemJson)
        case .serviceUnavailable(let response):
            throw Self.refusal(503, try? response.body.applicationProblemJson)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func downloadURL(recordingID: String) async throws -> URL {
        let input = Operations.DownloadV1RecordingsRecordingIdDownloadGet.Input(path: .init(recordingId: recordingID))
        switch try await client.downloadV1RecordingsRecordingIdDownloadGet(input) {
        case .ok(let response): return try signedURL(try response.body.json.url)
        case .notFound(let response): throw Self.refusal(404, try? response.body.applicationProblemJson)
        case .conflict(let response): throw Self.refusal(409, try? response.body.applicationProblemJson)
        case .unprocessableContent(let response):
            throw Self.refusal(422, try? response.body.applicationProblemJson)
        case .serviceUnavailable(let response):
            throw Self.refusal(503, try? response.body.applicationProblemJson)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func retryRecording(recordingID: String) async throws {
        let input = Operations.RetryV1RecordingsRecordingIdRetryPost.Input(path: .init(recordingId: recordingID))
        switch try await client.retryV1RecordingsRecordingIdRetryPost(input) {
        case .noContent: return
        case .notFound(let response): throw Self.refusal(404, try? response.body.applicationProblemJson)
        case .conflict(let response): throw Self.refusal(409, try? response.body.applicationProblemJson)
        case .unprocessableContent(let response):
            throw Self.refusal(422, try? response.body.applicationProblemJson)
        case .serviceUnavailable(let response):
            throw Self.refusal(503, try? response.body.applicationProblemJson)
        case .undocumented(let status, _): throw APIStatusError(status: status)
        }
    }

    public func putObject(_ url: URL, file: URL, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        // The slot's signature covers the type, so the bucket refuses any other.
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (_, response) = try await session.upload(for: request, fromFile: file)
        try Self.checkTransfer(response)
    }

    public func getObject(_ url: URL, to destination: URL) async throws {
        let (downloaded, response) = try await session.download(from: url)
        defer { try? FileManager.default.removeItem(at: downloaded) }
        try Self.checkTransfer(response)
        if FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: downloaded, to: destination)
    }

    /// A signed URL the server sent that does not parse.
    struct InvalidSignedURL: Error {
        let value: String
    }

    private func signedURL(_ value: String) throws -> URL {
        guard let url = URL(string: value, relativeTo: storageOrigin)?.absoluteURL, url.host() != nil else {
            throw InvalidSignedURL(value: value)
        }
        return url
    }

    private static func refusal(_ status: Int, _ problem: Components.Schemas.Problem?) -> APIStatusError {
        APIStatusError(status: status, problemType: problem?._type, detail: problem?.detail)
    }

    private static func checkTransfer(_ response: URLResponse) throws {
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
            throw TransferError(status: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }
}

/// Moves values between the generated client's types and the store's JSON rows.
///
/// The store decodes a server row with `init(wire:)` from the JSON the API sent, so a generated
/// value goes back to JSON with the API client's own date format rather than being mapped
/// field by field.
enum WireFormat {
    private struct PushResponse: Decodable {
        var results: [Result]

        struct Result: Decodable {
            var table: SyncTable
            var id: String
            var status: String
            var reason: String?
            var row: JSONObject?
        }
    }

    private struct PullResponse: Decodable {
        var rows: [Row]
        var nextSince: Int64
        var hasMore: Bool

        struct Row: Decodable {
            var table: SyncTable
            var row: JSONObject
        }

        enum CodingKeys: String, CodingKey {
            case rows
            case nextSince = "next_since"
            case hasMore = "has_more"
        }
    }

    struct UnknownPushStatus: Error {
        let status: String
    }

    static func change(_ change: Change) throws -> Components.Schemas.Change {
        Components.Schemas.Change(
            data: try change.data.map {
                try JSONDecoder().decode(Components.Schemas.Change.DataPayload.self, from: JSONEncoder().encode($0))
            },
            id: change.id,
            op: change.op.rawValue,
            table: change.table.rawValue,
            updatedAt: change.updatedAt.date
        )
    }

    static func pushResults(_ response: Components.Schemas.PushResponse) throws -> [PushResult] {
        try reencode(response, as: PushResponse.self).results.map { result in
            guard let status = PushResult.Status(rawValue: result.status) else {
                throw UnknownPushStatus(status: result.status)
            }
            return PushResult(
                table: result.table, id: result.id, status: status, reason: result.reason, row: result.row)
        }
    }

    static func pullPage(_ response: Components.Schemas.PullResponse) throws -> PullPage {
        let page = try reencode(response, as: PullResponse.self)
        return PullPage(
            rows: page.rows.map { PulledRow(table: $0.table, row: $0.row) }, nextSince: page.nextSince,
            hasMore: page.hasMore)
    }

    private static func reencode<Value: Decodable>(_ value: some Encodable, as type: Value.Type) throws -> Value {
        let transcoder = APIDateTranscoder()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(transcoder.encode(date))
        }
        return try JSONDecoder().decode(type, from: encoder.encode(value))
    }
}
