import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Reports the response of the request that created the account, which the API marks with
/// `X-Account-Created: trial` or `comp`. The callback hears true for a trial.
struct AccountCreatedMiddleware: ClientMiddleware {
    static let header = HTTPField.Name("X-Account-Created")!

    let onAccountCreated: @Sendable (Bool) async -> Void

    init(onAccountCreated: @escaping @Sendable (Bool) async -> Void) {
        self.onAccountCreated = onAccountCreated
    }

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let sent = try await next(request, body, baseURL)
        switch sent.0.headerFields[Self.header] {
        case "trial": await onAccountCreated(true)
        case "comp": await onAccountCreated(false)
        default: break
        }
        return sent
    }
}
