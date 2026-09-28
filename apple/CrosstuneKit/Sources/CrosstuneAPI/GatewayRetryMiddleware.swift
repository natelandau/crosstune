import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Resends a request the gateway answered with a 502 or 504, for about 15 seconds in all.
///
/// The API sleeps when idle, and the first request after that can reach the gateway before the
/// API is up. A 503 is never retried: the API sends it when a feature is not configured, which
/// waiting does not change. After the last delay the gateway's response is returned as is.
public struct GatewayRetryMiddleware: ClientMiddleware {
    public static let defaultDelays: [Duration] = [
        .milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8),
    ]

    let delays: [Duration]
    let sleep: @Sendable (Duration) async throws -> Void

    public init(
        delays: [Duration] = defaultDelays,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.delays = delays
        self.sleep = sleep
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var sent = try await next(request, body, baseURL)
        // A streamed body is consumed by the first attempt and cannot be sent again.
        guard body == nil || body?.iterationBehavior == .multiple else { return sent }
        for delay in delays {
            guard sent.0.status == .badGateway || sent.0.status == .gatewayTimeout else { return sent }
            try await sleep(delay)
            sent = try await next(request, body, baseURL)
        }
        return sent
    }
}
