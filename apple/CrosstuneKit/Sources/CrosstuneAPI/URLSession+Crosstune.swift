import Foundation
import OpenAPIURLSession

extension URLSession {
    /// The session for API requests and recording files. They carry a user's private data, so
    /// it has no URL cache and never writes a response to disk, where it would outlive sign-out.
    public static let crosstune: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()
}

extension URLSessionTransport {
    /// The API transport, over ``Foundation/URLSession/crosstune``.
    public static let crosstune = URLSessionTransport(configuration: .init(session: .crosstune))
}
