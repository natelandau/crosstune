import Foundation
import OpenAPIURLSession

extension Client {
    /// The API client every screen uses: the API's date format, URLSession, and a session
    /// token plus the client version on every request.
    public static func crosstune(
        origin: URL,
        tokens: any TokenProvider,
        clientVersion: String,
        onUnauthorized: @escaping @Sendable () async -> Void
    ) -> Client {
        Client(
            serverURL: origin,
            configuration: .crosstune,
            transport: URLSessionTransport(),
            middlewares: [
                AuthMiddleware(tokens: tokens, clientVersion: clientVersion, onUnauthorized: onUnauthorized)
            ]
        )
    }
}
