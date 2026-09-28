import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

extension Client {
    /// The API client every screen uses: the API's date format, URLSession, a session token
    /// plus the client version on every request, and retries while the API wakes from sleep.
    public static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void
    ) -> Client {
        crosstune(
            origin: origin, tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized,
            onAccountDeleted: onAccountDeleted, transport: URLSessionTransport(),
            gatewayRetry: GatewayRetryMiddleware())
    }

    static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void,
        transport: any ClientTransport,
        gatewayRetry: GatewayRetryMiddleware
    ) -> Client {
        Client(
            serverURL: origin,
            configuration: .crosstune,
            transport: transport,
            // The first middleware is the outermost, so every gateway retry resends the request
            // auth already signed, and a 401 passes back out to auth's refresh.
            middlewares: [
                AuthMiddleware(
                    tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized,
                    onAccountDeleted: onAccountDeleted),
                gatewayRetry,
            ]
        )
    }
}
