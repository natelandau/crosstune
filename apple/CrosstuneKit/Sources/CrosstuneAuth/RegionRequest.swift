import CrosstuneAPI
import CrosstuneAnalytics
import CrosstuneSync
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

extension Region {
    /// Asks the API where the caller is. It is the one request made with no session token, since
    /// it runs before anyone signs in, so it uses a client without ``AuthMiddleware``.
    /// `transport` replaces URLSession in tests.
    public static func fetch(
        origin: URL, transport: any ClientTransport = URLSessionTransport()
    ) async throws -> Region {
        let client = CrosstuneAPI.Client(
            serverURL: origin, configuration: .crosstune, transport: transport,
            middlewares: [GatewayRetryMiddleware()])
        switch try await client.getRegionV1RegionGet(.init()) {
        case .ok(let response):
            return Region(consentRequired: try response.body.json.consentRequired)
        case .undocumented(let status, _):
            throw APIStatusError(status: status)
        }
    }
}
