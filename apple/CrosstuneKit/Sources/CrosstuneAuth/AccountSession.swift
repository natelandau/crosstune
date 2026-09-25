import ClerkKit
import Foundation
import Observation

/// Who the app is open for, and whether the API still accepts their session.
@MainActor
@Observable
public final class AccountSession {
    /// How long launch waits for Clerk before opening on the remembered user, as the web
    /// client's `CLERK_LOAD_GRACE_MS` does.
    public static let loadGrace: Duration = .seconds(5)

    public enum Phase: Equatable, Sendable {
        /// Clerk is loading and the grace period has not run out.
        case loading
        case signedOut
        /// Open for this user. `confirmed` is false while Clerk has not loaded, so requests
        /// wait and only local data is shown.
        case signedIn(userID: String, confirmed: Bool)
    }

    /// True once the API has refused the session even with a fresh token.
    public private(set) var needsSignIn = false

    private let remembered: RememberedUser
    private var graceElapsed = false

    public init(publishableKey: String, remembered: RememberedUser = RememberedUser()) {
        self.remembered = remembered
        Clerk.configure(publishableKey: publishableKey)
        Task { [weak self] in
            try? await Task.sleep(for: Self.loadGrace)
            self?.graceElapsed = true
        }
    }

    public var phase: Phase {
        let clerk = Clerk.shared
        return Self.phase(
            clerkLoaded: clerk.isLoaded,
            clerkUserID: clerk.user?.id,
            rememberedUserID: remembered.userID,
            graceElapsed: graceElapsed
        )
    }

    /// The signed-in Clerk user, for views that watch it change.
    public var clerkUserID: String? { Clerk.shared.user?.id }

    /// Records the signed-in user, or forgets them on sign-out. Call when Clerk's user changes.
    public func clerkUserChanged() {
        let clerk = Clerk.shared
        guard clerk.isLoaded else { return }
        remembered.userID = clerk.user?.id
        if clerk.user == nil { needsSignIn = false }
    }

    /// Called by the API client when the API refuses the session twice.
    public func sessionRejected() {
        needsSignIn = true
    }

    public func signOut() async throws {
        try await Clerk.shared.auth.signOut()
        remembered.userID = nil
        needsSignIn = false
    }

    nonisolated static func phase(
        clerkLoaded: Bool,
        clerkUserID: String?,
        rememberedUserID: String?,
        graceElapsed: Bool
    ) -> Phase {
        if clerkLoaded {
            return clerkUserID.map { .signedIn(userID: $0, confirmed: true) } ?? .signedOut
        }
        guard graceElapsed else { return .loading }
        return rememberedUserID.map { .signedIn(userID: $0, confirmed: false) } ?? .signedOut
    }
}

/// The last signed-in Clerk user ID, kept so the app can open offline. It identifies the
/// user and grants nothing: the session itself stays in Clerk's storage.
public final class RememberedUser: @unchecked Sendable {
    private static let key = "lastSignedInUserID"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var userID: String? {
        get { defaults.string(forKey: Self.key) }
        set { defaults.set(newValue, forKey: Self.key) }
    }
}
