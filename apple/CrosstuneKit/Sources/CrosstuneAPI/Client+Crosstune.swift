import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

extension Client {
    /// The API client every screen uses: the API's date format, URLSession, a session token
    /// plus the client version and platform on every request, and retries while the API wakes from sleep.
    /// `onAccountCreated` hears whether the request that created the account started a trial.
    /// `onUpdateRequired` runs when the API refuses this build as too old.
    /// `transport` stands in for URLSession in tests.
    public static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void,
        onAccountCreated: @escaping @Sendable (Bool) async -> Void = { _ in },
        onUpdateRequired: @escaping @Sendable () async -> Void = {},
        transport: any ClientTransport = URLSessionTransport()
    ) -> Client {
        crosstune(
            origin: origin, tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized,
            onAccountDeleted: onAccountDeleted, onAccountCreated: onAccountCreated,
            onUpdateRequired: onUpdateRequired, transport: transport,
            gatewayRetry: GatewayRetryMiddleware())
    }

    static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void,
        onAccountDeleted: @escaping @Sendable () async -> Void,
        onAccountCreated: @escaping @Sendable (Bool) async -> Void = { _ in },
        onUpdateRequired: @escaping @Sendable () async -> Void = {},
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
                    onAccountDeleted: onAccountDeleted, onUpdateRequired: onUpdateRequired),
                AccountCreatedMiddleware(onAccountCreated: onAccountCreated),
                gatewayRetry,
            ]
        )
    }
}
