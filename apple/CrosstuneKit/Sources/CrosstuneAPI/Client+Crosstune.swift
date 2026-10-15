import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

extension Client {
    /// The API client every screen uses: the API's date format, URLSession, a session token
    /// plus the client version on every request, and retries while the API wakes from sleep.
    /// `onAccountCreated` hears whether the request that created the account started a trial.
    public static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void,
        onAccountCreated: @escaping @Sendable (Bool) async -> Void = { _ in }
    ) -> Client {
        crosstune(
            origin: origin, tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized,
            onAccountDeleted: onAccountDeleted, onAccountCreated: onAccountCreated, transport: URLSessionTransport(),
            gatewayRetry: GatewayRetryMiddleware())
    }

    static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void,
        onAccountCreated: @escaping @Sendable (Bool) async -> Void = { _ in },
        transport: any ClientTransport,
        gatewayRetry: GatewayRetryMiddleware
    ) -> Client {
        Client(
            serverURL: origin,
            configuration: .crosstune,
            transport: transport,
            // The first middleware is the outermost, so every gateway retry resends the request
            // auth already signed, and a 401 passes back out to auth's refresh. Account creation
            // sits outside the retries, so it reads only the response that came back last.
            middlewares: [
                AuthMiddleware(
                    tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized,
                    onAccountDeleted: onAccountDeleted),
                AccountCreatedMiddleware(onAccountCreated: onAccountCreated),
                gatewayRetry,
            ]
        )
    }
}
