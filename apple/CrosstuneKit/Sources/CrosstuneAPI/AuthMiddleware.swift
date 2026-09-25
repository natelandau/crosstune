import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Supplies the session token for API requests.
public protocol TokenProvider: Sendable {
    /// The current session token, or nil when no one is signed in.
    ///
    /// - Parameter refresh: True to skip any cached token and fetch a new one.
    func token(refresh: Bool) async throws -> String?
}

/// Thrown instead of sending a request when there is no session token.
public struct NotSignedIn: Error, Equatable {
    public init() {}
}

/// Signs every request with the session token and the client version.
///
/// A 401 retries once with a fresh token, because a cached token can expire between the
/// fetch and the request. A second 401 means the session itself is no longer accepted, and
/// `onUnauthorized` runs so the app can ask the user to sign in again.
public struct AuthMiddleware: ClientMiddleware {
    let tokens: any TokenProvider
    let clientVersion: String
    let onUnauthorized: @Sendable () async -> Void

    public init(
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void = {}
    ) {
        self.tokens = tokens
        self.clientVersion = clientVersion
        self.onUnauthorized = onUnauthorized
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let first = try await send(request, body: body, baseURL: baseURL, refresh: false, next: next)
        guard first.0.status == .unauthorized else { return first }

        // A streamed body is consumed by the first attempt and cannot be sent again.
        guard body == nil || body?.iterationBehavior == .multiple else {
            await onUnauthorized()
            return first
        }
        let second = try await send(request, body: body, baseURL: baseURL, refresh: true, next: next)
        if second.0.status == .unauthorized {
            await onUnauthorized()
        }
        return second
    }

    private func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        refresh: Bool,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let token = try await tokens.token(refresh: refresh) else {
            throw NotSignedIn()
        }
        var signed = request
        signed.headerFields[.authorization] = "Bearer \(token)"
        signed.headerFields[.clientVersion] = clientVersion
        return try await next(signed, body, baseURL)
    }
}

extension HTTPField.Name {
    static let clientVersion = Self("X-Client-Version")!
}
