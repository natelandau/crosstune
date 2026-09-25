import ClerkKit
import CrosstuneAPI

/// Session tokens from Clerk, which caches each one and refreshes it before it expires.
public struct ClerkTokens: TokenProvider {
    public init() {}

    public func token(refresh: Bool) async throws -> String? {
        try await Clerk.shared.auth.getToken(.init(skipCache: refresh))
    }
}
