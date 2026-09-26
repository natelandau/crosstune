import CrosstuneAPI
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing

@testable import CrosstuneSync

/// Answers every request with one status and body, recording what the client sent.
final class RecordingTransport: ClientTransport {
    private let sent = Mutex<[(request: HTTPRequest, body: Data?)]>([])
    let status: HTTPResponse.Status
    let body: String
    let failure: (any Error & Sendable)?

    init(status: HTTPResponse.Status = .ok, body: String = "{}", failure: (any Error & Sendable)? = nil) {
        self.status = status
        self.body = body
        self.failure = failure
    }

    var requests: [(request: HTTPRequest, body: Data?)] { sent.withLock { $0 } }

    func send(
        _ request: HTTPRequest, body requestBody: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var data: Data?
        if let requestBody { data = try await Data(collecting: requestBody, upTo: 1_000_000) }
        let captured = data
        sent.withLock { $0.append((request, captured)) }
        if let failure { throw failure }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = status == .ok ? "application/json" : "application/problem+json"
        return (response, HTTPBody(body))
    }
}

struct FixedTokens: TokenProvider {
    let value: String?

    func token(refresh: Bool) async throws -> String? { value }
}

private func api(
    _ transport: RecordingTransport, token: String? = "token", session: URLSession = .shared,
    storageOrigin: URL? = nil
) -> LiveSyncAPI {
    LiveSyncAPI(
        client: Client(
            serverURL: URL(string: "https://api.example.test")!,
            configuration: .crosstune,
            transport: transport,
            middlewares: [AuthMiddleware(tokens: FixedTokens(value: token), clientVersion: "test")]
        ),
        session: session, storageOrigin: storageOrigin)
}

private func json(_ data: Data?) throws -> JSONObject {
    try JSONDecoder().decode(JSONObject.self, from: try #require(data))
}

@Suite struct LiveSyncAPITests {
    @Test func sendsChangesAndReadsTheServersRows() async throws {
        let transport = RecordingTransport(
            body: """
                {"results": [
                  {"table": "tunes", "id": "t1", "status": "stale", "reason": null, "row": {
                    "id": "t1", "created_at": "2026-09-20T18:04:11Z",
                    "updated_at": "2026-09-21T02:15:40.123999Z", "deleted_at": null, "server_seq": 9,
                    "owner_user_id": "u", "title": "Theirs", "modes": [], "field_added_later": 3
                  }},
                  {"table": "user_tunes", "id": "ut1", "status": "invalid", "reason": "not found"}
                ]}
                """)
        let updatedAt = Timestamp(iso: "2026-09-25T12:00:00.007Z")!

        let results = try await api(transport).push([
            Change(table: .tunes, op: .upsert, id: "t1", updatedAt: updatedAt, data: ["title": .string("Mine")]),
            Change(table: .userTunes, op: .delete, id: "ut1", updatedAt: updatedAt, data: nil),
        ])

        let sent = try json(transport.requests.first?.body)
        guard case .array(let changes) = sent["changes"], case .object(let first) = changes.first,
            case .object(let second) = changes.last
        else {
            Issue.record("unexpected request body: \(sent)")
            return
        }
        #expect(first["table"] == .string("tunes"))
        #expect(first["op"] == .string("upsert"))
        #expect(first["updated_at"] == .string("2026-09-25T12:00:00.007Z"))
        #expect(first["data"] == .object(["title": .string("Mine")]))
        #expect(second["op"] == .string("delete"))
        #expect(second["data"] == nil)

        #expect(results.map(\.status) == [.stale, .invalid])
        #expect(results[1].reason == "not found")
        let row = try #require(results[0].row)
        #expect(row["updated_at"] == .string("2026-09-21T02:15:40.123Z"))
        #expect(row["field_added_later"] == .integer(3))
        let tune = try Tune(wire: row)
        #expect(tune.title == "Theirs")
        #expect(tune.extra["field_added_later"] == .integer(3))
    }

    @Test func readsAPullPage() async throws {
        let transport = RecordingTransport(
            body: """
                {"rows": [
                  {"table": "lists", "row": {
                    "id": "l1", "created_at": "2026-09-19T21:30:00Z", "updated_at": "2026-09-19T21:30:00Z",
                    "deleted_at": null, "server_seq": 42, "user_id": "u", "name": "Thursday jam", "position": 0
                  }}
                ], "next_since": 42, "has_more": true}
                """)

        let page = try await api(transport).pull(since: 7)

        #expect(transport.requests.first?.request.path == "/v1/sync/pull?since=7")
        #expect(page.nextSince == 42)
        #expect(page.hasMore)
        #expect(page.rows.map(\.table) == [.lists])
        let list = try TuneList(wire: try #require(page.rows.first?.row))
        #expect(list.name == "Thursday jam")
        #expect(list.updatedAt == Timestamp(iso: "2026-09-19T21:30:00Z"))
    }

    @Test func readsTheStorageFigures() async throws {
        let transport = RecordingTransport(
            body: """
                {"id": "u", "clerk_user_id": "user_1", "email": null, "created_at": "2026-09-11T00:00:00Z",
                 "storage": {"used_bytes": 5, "quota_bytes": 100, "max_file_bytes": 50}}
                """)

        let figures = try await api(transport).storage()

        #expect(figures == StorageFigures(usedBytes: 5, quotaBytes: 100, maxFileBytes: 50))
    }

    @Test func resolvesALink() async throws {
        let transport = RecordingTransport(
            body: """
                {"provider": "youtube", "url": "https://youtu.be/x", "provider_ref": "x", "title": "Tune",
                 "artwork_url": null}
                """)

        let link = try await api(transport).resolveLink(url: "https://youtu.be/x")

        #expect(link == ResolvedLink(provider: "youtube", url: "https://youtu.be/x", providerRef: "x", title: "Tune"))
        #expect(try json(transport.requests.first?.body) == ["url": .string("https://youtu.be/x")])
    }

    @Test(arguments: [(HTTPResponse.Status.internalServerError, 500), (.unprocessableContent, 422)])
    func throwsTheStatusOfAFailedRequest(status: HTTPResponse.Status, code: Int) async throws {
        let transport = RecordingTransport(
            status: status, body: #"{"type": "about:blank", "title": "x", "status": 422, "detail": "x"}"#)

        await #expect(throws: APIStatusError(status: code)) {
            try await api(transport).pull(since: 0)
        }
    }

    @Test func classifiesAnUnreachableServerAsOffline() async throws {
        let transport = RecordingTransport(failure: URLError(.notConnectedToInternet))

        let error = await #expect(throws: (any Error).self) { try await api(transport).pull(since: 0) }

        #expect(classifyFailure(try #require(error), isOffline: false) == .offline)
    }

    @Test func classifiesAMissingSessionTokenAsOffline() async throws {
        let transport = RecordingTransport()

        let error = await #expect(throws: (any Error).self) { try await api(transport, token: nil).pull(since: 0) }

        #expect(transport.requests.isEmpty)
        #expect(classifyFailure(try #require(error), isOffline: false) == .offline)
        #expect(isAuthFailure(try #require(error)))
    }

    @Test func classifiesARefusedSessionAsUnauthorized() async throws {
        let transport = RecordingTransport(
            status: .unauthorized, body: #"{"type": "about:blank", "title": "x", "status": 422, "detail": "x"}"#)

        let error = await #expect(throws: (any Error).self) { try await api(transport).pull(since: 0) }

        #expect(transport.requests.count == 2)
        #expect(classifyFailure(try #require(error), isOffline: false) == .unauthorized)
    }

    @Test func requestsAnUploadSlot() async throws {
        let transport = RecordingTransport(
            body: #"{"url": "https://bucket.test/put/r1?sig=x", "expires_at": "2026-09-25T13:00:00Z"}"#)

        let url = try await api(transport).requestUploadSlot(recordingID: "r1", bytes: 42, contentType: "audio/mp4")

        #expect(url.absoluteString == "https://bucket.test/put/r1?sig=x")
        #expect(transport.requests.first?.request.path == "/v1/recordings/r1/upload-slot")
        #expect(
            try json(transport.requests.first?.body) == ["bytes": .integer(42), "content_type": .string("audio/mp4")])
    }

    @Test func readsTheProblemOfARefusedSlot() async throws {
        let transport = RecordingTransport(
            status: .contentTooLarge,
            body: """
                {"type": "urn:crosstune:quota-exceeded", "title": "Quota exceeded", "status": 413,
                 "detail": "This recording would pass your storage quota."}
                """)

        await #expect(
            throws: APIStatusError(
                status: 413, problemType: quotaProblem, detail: "This recording would pass your storage quota.")
        ) {
            try await api(transport).requestUploadSlot(recordingID: "r1", bytes: 42, contentType: "audio/mp4")
        }
    }

    @Test func confirmsAnUploadAndRetriesATranscode() async throws {
        let transport = RecordingTransport(status: .noContent, body: "")

        try await api(transport).uploadFinished(recordingID: "r1")
        try await api(transport).retryRecording(recordingID: "r1")

        #expect(
            transport.requests.map(\.request.path) == ["/v1/recordings/r1/uploaded", "/v1/recordings/r1/retry"])
        #expect(transport.requests.map(\.request.method) == [.post, .post])
    }

    @Test func resolvesARelativeSignedURLAgainstTheStorageOrigin() async throws {
        let transport = RecordingTransport(
            body: #"{"url": "/storage/crosstune-local/r1?sig=z", "expires_at": "2026-09-25T13:00:00Z"}"#)
        let origin = URL(string: "http://localhost:5173")!

        let put = try await api(transport, storageOrigin: origin)
            .requestUploadSlot(recordingID: "r1", bytes: 42, contentType: "audio/mp4")
        let get = try await api(transport, storageOrigin: origin).downloadURL(recordingID: "r1")

        #expect(put.absoluteString == "http://localhost:5173/storage/crosstune-local/r1?sig=z")
        #expect(get.absoluteString == "http://localhost:5173/storage/crosstune-local/r1?sig=z")
    }

    @Test func refusesARelativeSignedURLWithNoStorageOrigin() async throws {
        let transport = RecordingTransport(
            body: #"{"url": "/storage/crosstune-local/r1?sig=z", "expires_at": "2026-09-25T13:00:00Z"}"#)

        await #expect(throws: LiveSyncAPI.InvalidSignedURL.self) {
            try await api(transport).downloadURL(recordingID: "r1")
        }
    }

    @Test func readsADownloadURL() async throws {
        let transport = RecordingTransport(
            body: #"{"url": "https://bucket.test/get/r1?sig=y", "expires_at": "2026-09-25T13:00:00Z"}"#)

        let url = try await api(transport).downloadURL(recordingID: "r1")

        #expect(url.absoluteString == "https://bucket.test/get/r1?sig=y")
        #expect(transport.requests.first?.request.path == "/v1/recordings/r1/download")
    }
}

/// Answers every request a `URLSession` configured with it sends, recording each one. One
/// stub serves one test at a time, keyed by the host its URLs use.
final class StubObjectStore: URLProtocol {
    struct Sent: Sendable {
        var method: String?
        var headers: [String: String]
        var body: Data?
    }

    private static let state = Mutex<(sent: [String: [Sent]], answers: [String: (Int, Data)])>(([:], [:]))

    /// A session whose requests to `host` get `status` and `body`.
    static func session(host: String, status: Int = 200, body: Data = Data()) -> URLSession {
        state.withLock { $0.answers[host] = (status, body) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubObjectStore.self]
        return URLSession(configuration: configuration)
    }

    static func sent(to host: String) -> [Sent] {
        state.withLock { $0.sent[host] ?? [] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let host = request.url?.host() ?? ""
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let answer = Self.state.withLock { state in
            state.sent[host, default: []].append(
                Sent(method: request.httpMethod, headers: request.allHTTPHeaderFields ?? [:], body: body))
            return state.answers[host] ?? (200, Data())
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.0, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.1)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

@Suite struct ObjectTransferTests {
    let root = TemporaryRoot()
    var folder: URL { root.url }

    init() throws {
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
    }

    @Test func putsAFileWithItsTypeAndNoSessionToken() async throws {
        let host = "put-\(UUID().uuidString.lowercased()).test"
        let file = folder.appending(path: "r1.m4a")
        try Data("audio bytes".utf8).write(to: file)
        let transport = RecordingTransport()

        try await api(transport, session: StubObjectStore.session(host: host)).putObject(
            URL(string: "https://\(host)/put/r1?sig=x")!, file: file, contentType: "audio/mp4")

        let sent = try #require(StubObjectStore.sent(to: host).first)
        #expect(sent.method == "PUT")
        #expect(sent.headers["Content-Type"] == "audio/mp4")
        #expect(sent.body == Data("audio bytes".utf8))
        #expect(sent.headers["Content-Length"] == "11")
        #expect(sent.headers["Authorization"] == nil)
        #expect(transport.requests.isEmpty)
    }

    @Test func throwsTheStatusOfARefusedPut() async throws {
        let host = "refused-\(UUID().uuidString.lowercased()).test"
        let file = folder.appending(path: "r1.m4a")
        try Data("audio bytes".utf8).write(to: file)

        await #expect(throws: TransferError(status: 403)) {
            try await api(RecordingTransport(), session: StubObjectStore.session(host: host, status: 403)).putObject(
                URL(string: "https://\(host)/put/r1")!, file: file, contentType: "audio/mp4")
        }
    }

    @Test func getsAnObjectIntoItsDestination() async throws {
        let host = "get-\(UUID().uuidString.lowercased()).test"
        let destination = folder.appending(path: "d1.m4a")
        try Data("stale".utf8).write(to: destination)
        let session = StubObjectStore.session(host: host, body: Data("playback audio".utf8))

        try await api(RecordingTransport(), session: session).getObject(
            URL(string: "https://\(host)/get/d1")!, to: destination)

        #expect(try Data(contentsOf: destination) == Data("playback audio".utf8))
    }

    @Test func throwsTheStatusOfARefusedGetAndWritesNothing() async throws {
        let host = "missing-\(UUID().uuidString.lowercased()).test"
        let destination = folder.appending(path: "d1.m4a")

        await #expect(throws: TransferError(status: 404)) {
            try await api(RecordingTransport(), session: StubObjectStore.session(host: host, status: 404)).getObject(
                URL(string: "https://\(host)/get/d1")!, to: destination)
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)))
    }
}
