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
/// `onUnauthorized` runs so the app can ask the user to sign in again. A 401 that says the
/// account was deleted runs `onAccountDeleted` instead, with no retry, since no token can
/// bring the account back.
public struct AuthMiddleware: ClientMiddleware {
    /// The problem type the API answers a deleted account's still-valid token with.
    public static let accountDeletedProblem = "urn:crosstune:account-deleted"

    /// Far larger than any problem document; a longer body is not one.
    static let maxProblemBytes = 64 * 1024

    let tokens: any TokenProvider
    let clientVersion: String
    let onUnauthorized: @Sendable () async -> Void
    let onAccountDeleted: @Sendable () async -> Void

    public init(
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void = {},
        onAccountDeleted: @escaping @Sendable () async -> Void = {}
    ) {
        self.tokens = tokens
        self.clientVersion = clientVersion
        self.onUnauthorized = onUnauthorized
        self.onAccountDeleted = onAccountDeleted
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let sent = try await send(request, body: body, baseURL: baseURL, refresh: false, next: next)
        guard sent.0.status == .unauthorized else { return sent }
        let first = await Self.readingProblem(sent)
        if first.accountDeleted {
            await onAccountDeleted()
            return first.response
        }

        // A streamed body is consumed by the first attempt and cannot be sent again.
        guard body == nil || body?.iterationBehavior == .multiple else {
            await onUnauthorized()
            return first.response
        }
        let resent = try await send(request, body: body, baseURL: baseURL, refresh: true, next: next)
        guard resent.0.status == .unauthorized else { return resent }
        let second = await Self.readingProblem(resent)
        if second.accountDeleted {
            await onAccountDeleted()
        } else {
            await onUnauthorized()
        }
        return second.response
    }

    /// Reads a 401's problem type, handing back a body that can still be read after it. A body
    /// too large to be a problem document, or one that fails partway, is a plain 401: never a
    /// deleted account, and never an error of its own. Such a body is handed on only as far as
    /// it was read.
    static func readingProblem(
        _ response: (HTTPResponse, HTTPBody?)
    ) async -> (response: (HTTPResponse, HTTPBody?), accountDeleted: Bool) {
        guard let body = response.1 else { return (response, false) }
        if case .known(let length) = body.length, length > maxProblemBytes { return (response, false) }
        var data = Data()
        do {
            for try await chunk in body {
                data.append(contentsOf: chunk)
                // Stops at the cap rather than buffering a body of any size; what was read is
                // handed on, as a problem document never runs this long.
                if data.count > maxProblemBytes { return ((response.0, HTTPBody(data)), false) }
            }
        } catch {
            return ((response.0, HTTPBody(data)), false)
        }
        let problem = try? JSONDecoder().decode(ProblemType.self, from: data)
        return ((response.0, HTTPBody(data)), problem?.type == accountDeletedProblem)
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

private struct ProblemType: Decodable {
    let type: String?
}

extension HTTPField.Name {
    static let clientVersion = Self("X-Client-Version")!
}
