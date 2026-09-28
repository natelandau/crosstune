import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing

@testable import CrosstuneAPI

/// Records every delay it is asked to sleep for, without sleeping.
final class RecordingSleep: Sendable {
    private let delays = Mutex<[Duration]>([])

    var slept: [Duration] { delays.withLock { $0 } }

    func sleep(_ delay: Duration) async throws {
        delays.withLock { $0.append(delay) }
    }
}

/// Sends every request to a scripted server, standing in for URLSession.
struct ScriptedTransport: ClientTransport {
    let server: ScriptedServer

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        try await server.next(request, body, baseURL)
    }
}

@Test func retriesABadGatewayThenSucceeds() async throws {
    let server = ScriptedServer(.badGateway, .gatewayTimeout, .ok)
    let sleep = RecordingSleep()
    let middleware = GatewayRetryMiddleware(sleep: sleep.sleep)

    let (response, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    #expect(response.status == .ok)
    #expect(server.seen.count == 3)
    #expect(sleep.slept == [.milliseconds(500), .seconds(1)])
}

@Test func givesUpAfterTheLastDelay() async throws {
    let server = ScriptedServer(.badGateway, .badGateway, .badGateway, .badGateway, .badGateway, .badGateway)
    let sleep = RecordingSleep()
    let middleware = GatewayRetryMiddleware(sleep: sleep.sleep)

    let (response, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    #expect(response.status == .badGateway)
    #expect(server.seen.count == 6)
    #expect(sleep.slept == GatewayRetryMiddleware.defaultDelays)
}

@Test func doesNotRetryServiceUnavailable() async throws {
    let server = ScriptedServer(.serviceUnavailable)
    let sleep = RecordingSleep()
    let middleware = GatewayRetryMiddleware(sleep: sleep.sleep)

    let (response, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: server.next)

    #expect(response.status == .serviceUnavailable)
    #expect(server.seen.count == 1)
    #expect(sleep.slept.isEmpty)
}

@Test func doesNotRetryASinglePassBody() async throws {
    let server = ScriptedServer(.badGateway)
    let sleep = RecordingSleep()
    let middleware = GatewayRetryMiddleware(sleep: sleep.sleep)
    let stream = AsyncStream<ArraySlice<UInt8>> { $0.finish() }
    let body = HTTPBody(stream, length: .unknown, iterationBehavior: .single)

    let (response, _) = try await middleware.intercept(
        request, body: body, baseURL: baseURL, operationID: "push", next: server.next)

    #expect(response.status == .badGateway)
    #expect(server.seen.count == 1)
    #expect(sleep.slept.isEmpty)
}

@Test func usesTheDefaultSchedule() {
    #expect(
        GatewayRetryMiddleware.defaultDelays == [
            .milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8),
        ])
}

@Test func crosstuneClientOrdersAuthBeforeRetry() async throws {
    let server = ScriptedServer(.badGateway, .noContent)
    let tokens = CountingTokens()
    let client = Client.crosstune(
        origin: baseURL, tokens: tokens, clientVersion: "0.7.0", onUnauthorized: {}, onAccountDeleted: {},
        transport: ScriptedTransport(server: server),
        gatewayRetry: GatewayRetryMiddleware(sleep: RecordingSleep().sleep))

    let output = try await client.deleteMeV1MeDelete()

    #expect(output == .noContent(.init()))
    #expect(tokens.refreshes == [false])
    #expect(server.seen.map { $0.headerFields[.authorization] } == ["Bearer token-1", "Bearer token-1"])
}

@Test func crosstuneClientStillRefreshesAnUnauthorizedRequest() async throws {
    let server = ScriptedServer(.unauthorized, .noContent)
    let tokens = CountingTokens()
    let client = Client.crosstune(
        origin: baseURL, tokens: tokens, clientVersion: "0.7.0", onUnauthorized: {}, onAccountDeleted: {},
        transport: ScriptedTransport(server: server),
        gatewayRetry: GatewayRetryMiddleware(sleep: RecordingSleep().sleep))

    _ = try await client.deleteMeV1MeDelete()

    #expect(tokens.refreshes == [false, true])
    #expect(server.seen.count == 2)
}
