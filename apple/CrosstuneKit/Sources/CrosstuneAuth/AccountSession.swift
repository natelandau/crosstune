import ClerkKit
import CrosstuneStore
import Foundation
import Observation

/// Who the app is open for, their on-device store, and whether the API still accepts their
/// session.
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

    /// Why the app cannot sign out or delete the account right now.
    public enum LeaveError: LocalizedError, Equatable {
        /// Clerk has not loaded, so it cannot end the session.
        case offline
        /// The outbox holds changes the API has not received.
        case unsyncedChanges

        public static let offlineMessage = "This needs a connection."
        public static let unsyncedChangesMessage = "Some changes have not synced yet. Try again once they have."

        public var errorDescription: String? {
            switch self {
            case .offline: Self.offlineMessage
            case .unsyncedChanges: Self.unsyncedChangesMessage
            }
        }
    }

    /// True once the API has refused the session even with a fresh token.
    public private(set) var needsSignIn = false

    /// The signed-in user's catalog. Nil while no one is signed in, or when it failed to open.
    public private(set) var store: CrosstuneStore?
    /// Why the store did not open.
    public private(set) var storeFailure: String?

    private let remembered: RememberedUser
    private let storeRoot: URL
    private var graceElapsed = false

    public init(
        publishableKey: String, remembered: RememberedUser = RememberedUser(),
        storeRoot: URL = CrosstuneStore.defaultRoot
    ) {
        self.remembered = remembered
        self.storeRoot = storeRoot
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

    /// Opens the store of the user the app is open for, including a remembered user before
    /// Clerk loads, so the catalog shows offline. Call whenever `phase` changes.
    public func phaseChanged() {
        switch phase {
        case .loading:
            break
        case .signedOut:
            closeStore()
        case .signedIn(let userID, let confirmed):
            if store?.userID != userID {
                closeStore()
                do {
                    store = try CrosstuneStore.open(userID: userID, root: storeRoot)
                } catch {
                    storeFailure = "Could not open this device's copy of your tunes: \(error.localizedDescription)"
                }
            }
            // Only one user is signed in at a time, so any other folder was left by a sign-out
            // that did not finish.
            if confirmed { try? CrosstuneStore.deleteOthers(keeping: userID, root: storeRoot) }
        }
    }

    /// Signs out and deletes this device's copy of the user's catalog. Refuses while any change
    /// is unsent, since it would go with the catalog.
    public func signOut() async throws {
        let userID = try confirmedUserID()
        try await Self.leave(userID: userID, store: store, root: storeRoot, keepingUnsynced: false) {
            try await Clerk.shared.auth.signOut()
        }
        forget()
    }

    /// Deletes the account on every device, then this device's copy of it. Unsent changes are
    /// lost with the account.
    public func deleteAccount() async throws {
        let userID = try confirmedUserID()
        guard let user = Clerk.shared.user else { throw LeaveError.offline }
        try await Self.leave(userID: userID, store: store, root: storeRoot, keepingUnsynced: true) {
            try await user.delete()
        }
        forget()
    }

    /// Ends the session, then deletes the user's folder. The catalog is private data on a
    /// possibly shared device, so it goes with the session; if ending the session fails, it
    /// stays.
    static func leave(
        userID: String, store: CrosstuneStore?, root: URL, keepingUnsynced: Bool,
        endSession: () async throws -> Void
    ) async throws {
        if !keepingUnsynced, let store, try await store.pendingChangeCount() > 0 {
            throw LeaveError.unsyncedChanges
        }
        try await endSession()
        try? store?.close()
        try CrosstuneStore.delete(userID: userID, root: root)
    }

    private func confirmedUserID() throws -> String {
        guard case .signedIn(let userID, confirmed: true) = phase else { throw LeaveError.offline }
        return userID
    }

    private func forget() {
        closeStore()
        remembered.userID = nil
        needsSignIn = false
    }

    private func closeStore() {
        try? store?.close()
        store = nil
        storeFailure = nil
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
