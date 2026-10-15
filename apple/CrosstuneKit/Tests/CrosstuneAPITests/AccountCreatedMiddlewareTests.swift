import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing

@testable import CrosstuneAPI

/// Records each value the middleware reports.
final class AccountCreatedReports: Sendable {
    private let reports = Mutex<[Bool]>([])

    var trials: [Bool] { reports.withLock { $0 } }

    func record(_ trial: Bool) async {
        reports.withLock { $0.append(trial) }
    }
}

/// Answers with the given responses in order.
final class ResponseServer: Sendable {
    private let responses: Mutex<[HTTPResponse]>

    init(_ responses: HTTPResponse...) {
        self.responses = Mutex(responses)
    }

    func next(_: HTTPRequest, _: HTTPBody?, _: URL) async throws -> (HTTPResponse, HTTPBody?) {
        (responses.withLock { $0.removeFirst() }, nil)
    }
}

private func response(_ status: HTTPResponse.Status = .ok, accountCreated: String?) -> HTTPResponse {
    var fields = HTTPFields()
    if let accountCreated { fields[HTTPField.Name("X-Account-Created")!] = accountCreated }
    return HTTPResponse(status: status, headerFields: fields)
}

private func intercept(_ sent: HTTPResponse, reports: AccountCreatedReports) async throws -> HTTPResponse {
    let middleware = AccountCreatedMiddleware(onAccountCreated: reports.record)
    let (received, _) = try await middleware.intercept(
        request, body: nil, baseURL: baseURL, operationID: "me", next: ResponseServer(sent).next)
    return received
}

@Test func reportsATrialAccount() async throws {
    let reports = AccountCreatedReports()
    _ = try await intercept(response(accountCreated: "trial"), reports: reports)
    #expect(reports.trials == [true])
}

@Test func reportsACompAccount() async throws {
    let reports = AccountCreatedReports()
    _ = try await intercept(response(accountCreated: "comp"), reports: reports)
    #expect(reports.trials == [false])
}

@Test(arguments: [nil, "", "yes", "Trial"])
func reportsNothingWithoutAKnownValue(_ value: String?) async throws {
    let reports = AccountCreatedReports()
    _ = try await intercept(response(accountCreated: value), reports: reports)
    #expect(reports.trials.isEmpty)
}

@Test func passesTheResponseThroughUnchanged() async throws {
    let sent = response(.created, accountCreated: "trial")
    let received = try await intercept(sent, reports: AccountCreatedReports())
    #expect(received == sent)
}

@Test func crosstuneClientReadsTheResponseAfterAGatewayRetry() async throws {
    let server = ResponseServer(
        response(.badGateway, accountCreated: nil), response(.noContent, accountCreated: "comp"))
    let reports = AccountCreatedReports()
    let client = Client.crosstune(
        origin: baseURL, tokens: CountingTokens(), clientVersion: "0.7.0", onUnauthorized: {},
        onAccountDeleted: {}, onAccountCreated: reports.record, transport: ResponseTransport(server: server),
        gatewayRetry: GatewayRetryMiddleware(sleep: RecordingSleep().sleep))

    _ = try await client.deleteMeV1MeDelete()

    #expect(reports.trials == [false])
}

/// Sends every request to a server of scripted responses, standing in for URLSession.
private struct ResponseTransport: ClientTransport {
    let server: ResponseServer

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        try await server.next(request, body, baseURL)
    }
}
