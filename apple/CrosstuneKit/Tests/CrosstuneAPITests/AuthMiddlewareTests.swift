import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing

@testable import CrosstuneAPI

/// Hands out numbered tokens and records whether each call asked for a fresh one.
final class CountingTokens: TokenProvider {
    private let calls = Mutex<[Bool]>([])
    let signedIn: Bool

    init(signedIn: Bool = true) {
        self.signedIn = signedIn
    }

    var refreshes: [Bool] { calls.withLock { $0 } }

    func token(refresh: Bool) async throws -> String? {
        let count = calls.withLock {
            $0.append(refresh)
            return $0.count
        }
        return signedIn ? "token-\(count)" : nil
    }
}

/// Answers with the given statuses in order and records every request it sees.
final class ScriptedServer: Sendable {
    private let state: Mutex<(statuses: [HTTPResponse.Status], seen: [HTTPRequest])>

    init(_ statuses: HTTPResponse.Status...) {
        state = Mutex((statuses, []))
    }

    var seen: [HTTPRequest] { state.withLock { $0.seen } }

    func next(_ request: HTTPRequest, _ body: HTTPBody?, _ url: URL) async throws -> (HTTPResponse, HTTPBody?) {
        let status = state.withLock {
            $0.seen.append(request)
            return $0.statuses.removeFirst()
        }
        return (HTTPResponse(status: status), nil)
    }
}

final class Flag: Sendable {
    private let raised = Mutex(false)
    var isRaised: Bool { raised.withLock { $0 } }
    func raise() { raised.withLock { $0 = true } }
}

let request = HTTPRequest(method: .get, scheme: "https", authority: "api.example.test", path: "/v1/me")
let baseURL = URL(string: "https://api.example.test")!

@Test func signsTheRequestWithTheTokenAndTheClientVersion() async throws {
    let server = ScriptedServer(.ok)
    let middleware = AuthMiddleware(tokens: CountingTokens(), clientVersion: "0.7.0")

    _ = try await middleware.intercept(request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    let sent = try #require(server.seen.first)
    #expect(sent.headerFields[.authorization] == "Bearer token-1")
    #expect(sent.headerFields[HTTPField.Name("X-Client-Version")!] == "0.7.0")
}

@Test func sendsNothingWithoutASignedInUser() async throws {
    let server = ScriptedServer(.ok)
    let middleware = AuthMiddleware(tokens: CountingTokens(signedIn: false), clientVersion: "0.7.0")

    await #expect(throws: NotSignedIn()) {
        _ = try await middleware.intercept(request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)
    }
    #expect(server.seen.isEmpty)
}

@Test func retriesAnUnauthorizedRequestOnceWithAFreshToken() async throws {
    let server = ScriptedServer(.unauthorized, .ok)
    let tokens = CountingTokens()
    let flag = Flag()
    let middleware = AuthMiddleware(tokens: tokens, clientVersion: "0.7.0", onUnauthorized: { flag.raise() })

    let (response, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    #expect(response.status == .ok)
    #expect(tokens.refreshes == [false, true])
    #expect(server.seen.map { $0.headerFields[.authorization] } == ["Bearer token-1", "Bearer token-2"])
    #expect(!flag.isRaised)
}

@Test func reportsASessionTheAPIKeepsRejecting() async throws {
    let server = ScriptedServer(.unauthorized, .unauthorized)
    let flag = Flag()
    let middleware = AuthMiddleware(tokens: CountingTokens(), clientVersion: "0.7.0", onUnauthorized: { flag.raise() })

    let (response, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    #expect(response.status == .unauthorized)
    #expect(server.seen.count == 2)
    #expect(flag.isRaised)
}

@Test func doesNotResendABodyThatCanBeReadOnlyOnce() async throws {
    let server = ScriptedServer(.unauthorized)
    let flag = Flag()
    let middleware = AuthMiddleware(tokens: CountingTokens(), clientVersion: "0.7.0", onUnauthorized: { flag.raise() })
    let stream = AsyncStream<ArraySlice<UInt8>> { $0.finish() }
    let body = HTTPBody(stream, length: .unknown, iterationBehavior: .single)

    let (response, _) = try await middleware.intercept(
        request, body: body, baseURL: baseURL, operationID: "push", next: server.next)

    #expect(response.status == .unauthorized)
    #expect(server.seen.count == 1)
    #expect(flag.isRaised)
}
