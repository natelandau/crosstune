import ClerkKit
import CrosstuneAPI
import CrosstuneAudio
import CrosstuneStore
import CrosstuneSync
import Foundation
import Network
import Observation

/// Who the app is open for, their on-device store and its sync, and whether the API still
/// accepts their session.
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
        /// Clerk cannot reach its servers, so it cannot end the session.
        case offline
        /// The outbox holds changes the API has not received.
        case unsyncedChanges
        /// A recording's audio exists only on this device.
        case unuploadedRecordings

        public static let offlineMessage = "This needs a connection."
        public static let unsyncedChangesMessage = "Some changes have not synced yet. Try again once they have."
        public static let unuploadedRecordingsMessage =
            "Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload."

        public var errorDescription: String? {
            switch self {
            case .offline: Self.offlineMessage
            case .unsyncedChanges: Self.unsyncedChangesMessage
            case .unuploadedRecordings: Self.unuploadedRecordingsMessage
            }
        }
    }

    /// True once the API has refused the session even with a fresh token, until a sync run
    /// lands again.
    public private(set) var needsSignIn = false

    /// Whether the device has a network path. Clerk restores its user from its cache with no
    /// network, so a loaded Clerk alone does not mean the app can reach it.
    public private(set) var hasNetwork = true

    /// The signed-in user's catalog. Nil while no one is signed in, or when it failed to open.
    public private(set) var store: CrosstuneStore?
    /// Why the store did not open.
    public private(set) var storeFailure: String?

    /// Keeps the open store in step with the API. Nil while no store is open.
    public var syncEngine: SyncEngine? { sync?.engine }

    /// The API client every request goes through. A request the API refuses even with a fresh
    /// token sets ``needsSignIn``.
    @ObservationIgnored public private(set) lazy var client: CrosstuneAPI.Client = .crosstune(
        origin: apiOrigin,
        tokens: ClerkTokens(),
        clientVersion: clientVersion,
        onUnauthorized: { [weak self] in await self?.sessionRejected() }
    )

    private let remembered: RememberedUser
    private let storeRoot: URL
    private let apiOrigin: URL
    private let clientVersion: String
    private let storageOrigin: URL?
    private var graceElapsed = false
    private var sync: SessionSync?
    @ObservationIgnored private var isActive: Bool?
    /// Stores still closing, by user ID, so a folder never has two open at once.
    @ObservationIgnored private var closing: [String: Task<Void, Never>] = [:]
    /// The user whose store opens once their previous one has closed.
    @ObservationIgnored private var opening: String?
    @ObservationIgnored private let pathMonitor = NWPathMonitor()

    /// - Parameters:
    ///   - apiOrigin: Where the API is served.
    ///   - clientVersion: The app's version, sent with every request.
    ///   - storageOrigin: Where a storage URL the API signs as a bare path resolves. Only a
    ///     local API signs those; see ``LiveSyncAPI``.
    public init(
        publishableKey: String, apiOrigin: URL, clientVersion: String, storageOrigin: URL? = nil,
        remembered: RememberedUser = RememberedUser(), storeRoot: URL = CrosstuneStore.defaultRoot
    ) {
        self.remembered = remembered
        self.storeRoot = storeRoot
        self.apiOrigin = apiOrigin
        self.clientVersion = clientVersion
        self.storageOrigin = storageOrigin
        Clerk.configure(publishableKey: publishableKey)
        Task { [weak self] in
            try? await Task.sleep(for: Self.loadGrace)
            self?.graceElapsed = true
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let hasNetwork = path.status == .satisfied
            Task { @MainActor in
                self?.hasNetwork = hasNetwork
                self?.connectivityChanged()
            }
        }
        pathMonitor.start(queue: .main)
    }

    isolated deinit {
        pathMonitor.cancel()
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

    /// The signed-in user's email, from Clerk's cache when offline. Nil until Clerk loads.
    public var email: String? { Clerk.shared.user?.primaryEmailAddress?.emailAddress }

    /// True when Clerk cannot reach its servers: no network, or Clerk has not loaded. Requests
    /// wait, and sign-out is disabled.
    public var isOffline: Bool { Self.isOffline(phase: phase, hasNetwork: hasNetwork) }

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

    /// Reports whether the app is in the foreground, which syncs on return and gates the
    /// processing poll. Call whenever the app's scene phase changes.
    public func sceneActivityChanged(isActive: Bool) {
        self.isActive = isActive
        sync?.setActive(isActive)
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
            if store?.userID != userID, opening != userID {
                closeStore()
                openStore(for: userID)
            }
            if confirmed { deleteOtherFolders(keeping: userID) }
        }
        connectivityChanged()
    }

    /// Syncs, then signs out and deletes this device's copy of the user's catalog. Refuses while
    /// any change or recording is still only on this device, since it would go with the catalog.
    public func signOut() async throws {
        let userID = try confirmedUserID()
        try await Self.leave(userID: userID, store: store, root: storeRoot, sync: sync, keepingUnsynced: false) {
            try await Clerk.shared.auth.signOut()
        }
        forget()
    }

    /// Deletes the account on every device, then this device's copy of it. Unsent changes are
    /// lost with the account.
    public func deleteAccount() async throws {
        let userID = try confirmedUserID()
        guard let user = Clerk.shared.user else { throw LeaveError.offline }
        try await Self.leave(userID: userID, store: store, root: storeRoot, sync: sync, keepingUnsynced: true) {
            try await user.delete()
        }
        forget()
    }

    /// Ends the session, then deletes the user's folder. The catalog is private data on a
    /// possibly shared device, so it goes with the session; if ending the session fails, it
    /// stays.
    ///
    /// Unless `keepingUnsynced`, it syncs first and refuses while anything is still only on this
    /// device, since the folder takes it along.
    static func leave(
        userID: String, store: CrosstuneStore?, root: URL, sync: (any LeavingSync)?, keepingUnsynced: Bool,
        endSession: () async throws -> Void
    ) async throws {
        if !keepingUnsynced, let store {
            await sync?.sync()
            if try await store.pendingChangeCount() > 0 { throw LeaveError.unsyncedChanges }
            if try await store.notUploadedRecordingCount() > 0 { throw LeaveError.unuploadedRecordings }
        }
        // Stopped, no trigger can start a sync against the folder being deleted.
        await sync?.stop()
        do {
            try await endSession()
        } catch {
            sync?.resume()
            throw error
        }
        try? store?.close()
        try CrosstuneStore.delete(userID: userID, root: root)
    }

    private func confirmedUserID() throws -> String {
        guard !isOffline, case .signedIn(let userID, _) = phase else { throw LeaveError.offline }
        return userID
    }

    private func forget() {
        closeStore()
        remembered.userID = nil
        needsSignIn = false
    }

    /// Stops syncing at once, since the next request would carry whichever user's token Clerk
    /// holds by then, and closes the store once the run in flight has ended.
    private func closeStore() {
        let (sync, store) = (self.sync, self.store)
        sync?.shutDown()
        self.sync = nil
        self.store = nil
        storeFailure = nil
        guard let store else { return }
        let userID = store.userID
        closing[userID] = Task { [weak self] in
            await sync?.finished()
            try? store.close()
            self?.closing[userID] = nil
        }
    }

    /// Opens the user's store, first waiting out their previous one if it is still closing.
    private func openStore(for userID: String) {
        guard let previous = closing[userID] else { return openNow(userID) }
        opening = userID
        Task { [weak self] in
            await previous.value
            guard let self else { return }
            opening = nil
            guard case .signedIn(userID, _) = phase, store?.userID != userID else { return }
            closeStore()
            openNow(userID)
        }
    }

    private func openNow(_ userID: String) {
        do {
            let opened = try CrosstuneStore.open(userID: userID, root: storeRoot)
            store = opened
            let engine = SyncEngine(
                store: opened, api: LiveSyncAPI(client: client, storageOrigin: storageOrigin),
                isOffline: { [weak self] in self?.isOffline ?? true })
            engine.onSynced = { [weak self] in self?.needsSignIn = false }
            sync = SessionSync(store: opened, engine: engine, isActive: isActive, isOffline: isOffline)
            // A capture a crash or kill cut short is saved now rather than waiting on the user.
            Task { await Recorder.recoverLeftoverCaptures(in: opened) }
        } catch {
            storeFailure = "Could not open this device's copy of your tunes: \(error.localizedDescription)"
        }
    }

    /// Only one user is signed in at a time, so any other folder was left by a sign-out that did
    /// not finish, or belongs to a store still closing, which is deleted once it has closed. A
    /// folder whose store is about to open, once its previous store has closed, is kept.
    private func deleteOtherFolders(keeping userID: String) {
        let pending = closing.filter { $0.key != userID }.map(\.value)
        guard !pending.isEmpty else { return deleteFoldersNotInUse(keeping: userID) }
        Task { [weak self] in
            for close in pending { await close.value }
            guard let self, case .signedIn(userID, confirmed: true) = phase else { return }
            deleteFoldersNotInUse(keeping: userID)
        }
    }

    private func deleteFoldersNotInUse(keeping userID: String) {
        let keep = Self.foldersInUse(
            signedIn: userID, open: store?.userID, opening: opening, closing: Set(closing.keys))
        try? CrosstuneStore.deleteOthers(keeping: keep, root: storeRoot)
    }

    /// The users whose folders must survive a cleanup: the signed-in user, and any store that is
    /// open, about to open, or not yet closed.
    nonisolated static func foldersInUse(
        signedIn userID: String, open: String?, opening: String?, closing: Set<String>
    ) -> Set<String> {
        closing.union([userID, open, opening].compactMap(\.self))
    }

    private func connectivityChanged() {
        sync?.connectivityChanged(isOffline: isOffline)
    }

    nonisolated static func isOffline(phase: Phase, hasNetwork: Bool) -> Bool {
        guard hasNetwork, case .signedIn(_, confirmed: true) = phase else { return true }
        return false
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
