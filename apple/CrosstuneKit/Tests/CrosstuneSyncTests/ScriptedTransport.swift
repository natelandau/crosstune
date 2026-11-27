import CrosstuneStore
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization

/// A response the scripted server returns, in order, whatever the request.
struct ScriptedResponse: Decodable, Sendable {
    let route: String
    let status: Int
    let body: JSONValue
}

/// A request the client sent, as its method and path with query, and its parsed JSON body.
struct SentRequest: Decodable, Equatable, Sendable, CustomStringConvertible {
    let route: String
    let body: JSONValue

    var description: String { "\(route) \(body)" }

    /// The request with every ISO 8601 timestamp in its body rewritten to one precision, so two
    /// requests that name the same instants compare equal.
    var withCanonicalTimestamps: SentRequest {
        SentRequest(route: route, body: Self.canonical(body))
    }

    private static func canonical(_ value: JSONValue) -> JSONValue {
        switch value {
        case .string(let text): Timestamp(iso: text).map { .string($0.iso) } ?? value
        case .array(let items): .array(items.map(canonical))
        case .object(let object): .object(object.mapValues(canonical))
        default: value
        }
    }
}

/// A transport for the generated API client, as the fixtures/sync-engine cases script it.
/// Answers each request with the next scripted response and records what was sent. A request
/// with no response left is recorded in `unexpected` and answered 500, and one whose route differs
/// from the next response's is recorded there too, so the case that sent it fails.
final class ScriptedTransport: ClientTransport {
    private struct State {
        var queue: [ScriptedResponse]
        var sent: [SentRequest] = []
        var unexpected: [String] = []
        var beforeRespond: (@Sendable () async -> Void)?
    }

    private let state: Mutex<State>

    init(responses: [ScriptedResponse]) {
        state = Mutex(State(queue: responses))
    }

    var sent: [SentRequest] { state.withLock { $0.sent } }
    var unexpected: [String] { state.withLock { $0.unexpected } }
    /// How many scripted responses no request has taken yet.
    var remaining: Int { state.withLock { $0.queue.count } }

    /// Runs `hook` once, as the next request is answered, while that request is still in flight.
    func onNextResponse(_ hook: @escaping @Sendable () async -> Void) {
        state.withLock { $0.beforeRespond = hook }
    }

    func send(
        _ request: HTTPRequest, body requestBody: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let route = "\(request.method.rawValue) \(request.path ?? "")"
        var body = JSONValue.null
        if let requestBody {
            let data = try await Data(collecting: requestBody, upTo: 10_000_000)
            if !data.isEmpty { body = try JSONDecoder().decode(JSONValue.self, from: data) }
        }
        let hook = state.withLock { state in
            state.sent.append(SentRequest(route: route, body: body))
            defer { state.beforeRespond = nil }
            return state.beforeRespond
        }
        await hook?()
        let next = state.withLock { state -> ScriptedResponse? in
            if state.queue.isEmpty {
                state.unexpected.append("\(route): no scripted response left")
                return nil
            }
            let next = state.queue.removeFirst()
            if next.route != route {
                state.unexpected.append("\(route): the next response is for \(next.route)")
            }
            return next
        }
        guard let next else { return (HTTPResponse(status: .internalServerError), nil) }
        var response = HTTPResponse(status: .init(code: next.status))
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(try JSONEncoder().encode(next.body)))
    }
}
