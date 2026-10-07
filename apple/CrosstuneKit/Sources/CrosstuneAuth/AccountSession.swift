import ClerkKit
import CrosstuneAPI
import CrosstuneAnalytics
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
        /// A scan's image exists only on this device.
        case unuploadedScans
        /// Deleting the account failed before the API confirmed it, so nothing changed.
        case deleteFailed
        /// No answer from the API says whether the delete went through.
        case deleteUnconfirmed

        public static let offlineMessage = "This needs a connection."
        public static let unsyncedChangesMessage = "Some changes have not synced yet. Try again once they have."
        public static let unuploadedRecordingsMessage =
            "Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload."
        public static let unuploadedScansMessage =
            "Some scans have not uploaded yet. Delete them from their tune, or wait until they upload."
        public static let deleteFailedMessage = "Your account was not deleted. Nothing was changed. Try again."
        public static let deleteUnconfirmedMessage =
            "The delete could not be confirmed, so your account may already be deleted. Check your connection and try again."

        public var errorDescription: String? {
            switch self {
            case .offline: Self.offlineMessage
            case .unsyncedChanges: Self.unsyncedChangesMessage
            case .unuploadedRecordings: Self.unuploadedRecordingsMessage
            case .unuploadedScans: Self.unuploadedScansMessage
            case .deleteFailed: Self.deleteFailedMessage
            case .deleteUnconfirmed: Self.deleteUnconfirmedMessage
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

    /// True once the account is deleted, from this device or another, until the next sign-in.
    public private(set) var showsDeletedNotice = false

    /// A deleted account's user, signed out on this device even while Clerk still holds a
    /// session for it, so a failed sign-out never reopens a store for an account that is gone.
    /// Kept across launches, since Clerk can restore that user from its cache, and a user
    /// identified again would bring back the analytics person the API deletes.
    private var signedOutUserID: String? {
        didSet { remembered.deletedUserID = signedOutUserID }
    }

    /// Keeps the open store in step with the API. Nil while no store is open.
    public var syncEngine: SyncEngine? { sync?.engine }

    /// The API client every request goes through. A request the API refuses even with a fresh
    /// token sets ``needsSignIn``.
    @ObservationIgnored public private(set) lazy var client: CrosstuneAPI.Client = .crosstune(
        origin: apiOrigin,
        tokens: ClerkTokens(),
        clientVersion: clientVersion,
        onUnauthorized: { [weak self] in await self?.sessionRejected() },
        // Not awaited: leaving waits out the sync run whose request is reporting this.
        onAccountDeleted: { [weak self] in
            Task { @MainActor in await self?.accountDeletedElsewhere() }
        }
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
    /// The user whose store is opening, once their previous one has closed.
    @ObservationIgnored private var opening: String?
    /// Opens still under way, by user ID, so a folder is never deleted or opened twice while
    /// one runs. Each carries a number so only the latest open for a user clears its entry.
    @ObservationIgnored private var opens: [String: (number: Int, task: Task<Void, Never>)] = [:]
    @ObservationIgnored private var openCount = 0
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    /// True while this device is deleting the account or forgetting a deleted one.
    @ObservationIgnored private var isLeavingDeleted = false
    /// Set through sign-out, so a change of Clerk's user meanwhile leaves the analytics reset to
    /// leaving, which sends `signed_out` first.
    @ObservationIgnored private var isSigningOut = false
    /// Whether a sync of the open store has identified the person with the API's figures.
    @ObservationIgnored private var syncedFiguresReported = false
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private var identity: AnalyticsIdentity

    /// - Parameters:
    ///   - apiOrigin: Where the API is served.
    ///   - clientVersion: The app's version, sent with every request.
    ///   - storageOrigin: Where a storage URL the API signs as a bare path resolves. Only a
    ///     local API signs those; see ``LiveSyncAPI``.
    ///   - analytics: Where sign-in, sign-out, and deletion are reported.
    public init(
        publishableKey: String, apiOrigin: URL, clientVersion: String, storageOrigin: URL? = nil,
        remembered: RememberedUser = RememberedUser(), storeRoot: URL = CrosstuneStore.defaultRoot,
        analytics: AnalyticsClient = .noop
    ) {
        self.analytics = analytics
        identity = AnalyticsIdentity(analytics: analytics)
        self.remembered = remembered
        signedOutUserID = remembered.deletedUserID
        self.storeRoot = storeRoot
        self.apiOrigin = apiOrigin
        self.clientVersion = clientVersion
        self.storageOrigin = storageOrigin
        Clerk.configure(publishableKey: publishableKey)
        // A signed-out launch never sweeps other users' folders, so a sign-out's deletion that a
        // quit interrupted is finished here.
        CrosstuneStore.removeTrash(root: storeRoot)
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
            graceElapsed: graceElapsed,
            signedOutUserID: signedOutUserID
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
        let userID = Self.follow(
            clerkUserID: clerk.user?.id, signedUpAt: clerk.user?.createdAt, isLeaving: isSigningOut || isLeavingDeleted,
            signedOutUserID: &signedOutUserID, remembered: remembered, identity: &identity)
        identifyWithStoreFigures()
        if userID == nil {
            needsSignIn = false
        } else {
            showsDeletedNotice = false
        }
    }

    /// Follows Clerk's user: drops the deleted-user mask once Clerk lets go of that user, keeps
    /// a masked user signed out and unidentified, reports the change to analytics, and remembers
    /// the result.
    ///
    /// - Returns: The user the app is open for, nil for none or a masked one.
    static func follow(
        clerkUserID: String?, signedUpAt: Date?, isLeaving: Bool, signedOutUserID: inout String?,
        remembered: RememberedUser, identity: inout AnalyticsIdentity
    ) -> String? {
        // Once Clerk has let go of the deleted user too, the local sign-out has nothing to cover.
        if clerkUserID != signedOutUserID { signedOutUserID = nil }
        let userID = clerkUserID == signedOutUserID ? nil : clerkUserID
        identity.userChanged(to: userID, from: remembered.userID, isLeaving: isLeaving, signedUpAt: signedUpAt)
        remembered.userID = userID
        return userID
    }

    /// The catalog size and storage use the user's person carries, from the open store. Both are
    /// nil until a sync has brought the API's figures: before then a new device's empty catalog
    /// is not the account's, and setting it would overwrite the person's size with nothing.
    static func storeFigures(in store: CrosstuneStore) async -> (catalogSize: Int?, storageUsed: Int64?) {
        guard let storage = try? await store.meta(.storage, as: StorageFigures.self) else { return (nil, nil) }
        let tunes = try? await store.accountCounts().tunes
        return (tunes, Int64(storage.usedBytes))
    }

    /// Sets the store's figures on the person once both Clerk's user and their store are known,
    /// whichever comes last.
    ///
    /// - Parameter carried: Called with whether the identify carried the API's figures.
    private func identifyWithStoreFigures(carried: @escaping @MainActor (Bool) -> Void = { _ in }) {
        guard case .signedIn(let userID, confirmed: true) = phase, let store, store.userID == userID else { return }
        let analytics = analytics
        Task { [weak self] in
            let sent = await Self.identify(userID: userID, withFiguresIn: store, analytics: analytics) {
                self?.mayIdentify(userID) ?? false
            }
            carried(sent)
        }
    }

    /// A sign-out that ran meanwhile has reset the person; identifying again would revive it.
    private func mayIdentify(_ userID: String) -> Bool {
        guard !isSigningOut, !isLeavingDeleted, case .signedIn(userID, confirmed: true) = phase else { return false }
        return true
    }

    /// Identifies the user with the store's figures, unless `canIdentify` refuses once they are read.
    ///
    /// - Returns: Whether the identify carried the API's figures.
    static func identify(
        userID: String, withFiguresIn store: CrosstuneStore, analytics: AnalyticsClient,
        canIdentify: @MainActor () -> Bool
    ) async -> Bool {
        let figures = await storeFigures(in: store)
        guard canIdentify() else { return false }
        analytics.identify(
            userID: userID, signedUpAt: nil, catalogSize: figures.catalogSize, storageUsed: figures.storageUsed)
        return figures.storageUsed != nil
    }

    /// Whether a sync identifies the person with the store's figures: only one that stored them,
    /// since a returning device's store still holds its last session's, until one has.
    nonisolated static func identifiesAfterSync(storedFigures: Bool, reported: Bool) -> Bool {
        storedFigures && !reported
    }

    /// The first sync of a session that stores the API's figures, which a new device lacks and a
    /// returning one holds only from its last session, identifies the person again with them.
    private func syncLanded(in synced: CrosstuneStore, storedFigures: Bool) {
        needsSignIn = false
        guard Self.identifiesAfterSync(storedFigures: storedFigures, reported: syncedFiguresReported),
            store === synced
        else { return }
        identifyWithStoreFigures { [weak self] carried in
            guard carried, let self, store === synced else { return }
            syncedFiguresReported = true
        }
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

    /// Finishes the writes the app still holds back, such as a speed change settling, before
    /// leaving checks what is unsynced and closes the store. Set by the app.
    public var settleBeforeLeaving: (@MainActor () async -> Void)?

    /// Syncs, then signs out and deletes this device's copy of the user's catalog. Refuses while
    /// any change or recording is still only on this device, since it would go with the catalog.
    public func signOut() async throws {
        let userID = try confirmedUserID()
        isSigningOut = true
        defer { isSigningOut = false }
        // Leaving checks the open store for unsent work, so it waits for one still opening.
        await opens[userID]?.task.value
        guard isStillSignedIn(userID) else { return }
        try await Self.leave(
            userID: userID, store: store, root: storeRoot, sync: sync, analytics: analytics,
            settle: { await self.settleBeforeLeaving?() },
            endSession: { try await Clerk.shared.auth.signOut() }
        )
        forget()
    }

    /// Deletes the account on the API, then this device's copy of it. Unsent changes are lost
    /// with the account. A failure throws ``LeaveError/deleteFailed`` when the API's answer
    /// proves nothing changed, and ``LeaveError/deleteUnconfirmed`` when no such answer came.
    public func deleteAccount() async throws {
        guard let userID = try? confirmedUserID() else { throw LeaveError.deleteFailed }
        isLeavingDeleted = true
        defer { isLeavingDeleted = false }
        let client = client
        await opens[userID]?.task.value
        guard isStillSignedIn(userID) else { throw LeaveError.deleteFailed }
        await settleBeforeLeaving?()
        do {
            try await Self.deleteAndLeave(
                userID: userID, store: store, root: storeRoot, sync: sync, analytics: analytics,
                deleteRemote: { try await Self.deleteRemote { try await client.deleteMeV1MeDelete() } },
                endSession: { try await Clerk.shared.auth.signOut() }
            )
        } catch LeaveError.deleteUnconfirmed {
            throw LeaveError.deleteUnconfirmed
        } catch {
            throw LeaveError.deleteFailed
        }
        finishLeaving(deleted: userID)
    }

    /// Another device deleted the account: this one drops its copy as if it had made the
    /// delete, without a request of its own.
    func accountDeletedElsewhere() async {
        let userID: String
        switch Self.deletionReport(phase: phase, isLeavingDeleted: isLeavingDeleted) {
        case .ignore:
            return
        case .afterClerkLetGo:
            if identity.accountDeletedAfterClerkLetGo() { showsDeletedNotice = true }
            return
        case .leave(let leaving):
            userID = leaving
        }
        isLeavingDeleted = true
        defer { isLeavingDeleted = false }
        await opens[userID]?.task.value
        guard isStillSignedIn(userID) else { return }
        await settleBeforeLeaving?()
        await Self.forgetDeleted(userID: userID, store: store, root: storeRoot, sync: sync, analytics: analytics) {
            try await Clerk.shared.auth.signOut()
        }
        finishLeaving(deleted: userID)
    }

    /// What a report that the account is gone asks of the session.
    enum DeletionReport: Equatable {
        /// This device is already deleting or forgetting the account.
        case ignore
        /// No user is open, so the report is for one Clerk already let go of, if any.
        case afterClerkLetGo
        /// Drop this device's copy of the open user's account.
        case leave(userID: String)
    }

    nonisolated static func deletionReport(phase: Phase, isLeavingDeleted: Bool) -> DeletionReport {
        guard !isLeavingDeleted else { return .ignore }
        guard case .signedIn(let userID, _) = phase else { return .afterClerkLetGo }
        return .leave(userID: userID)
    }

    /// Signed out whether or not Clerk ended its session, since the account it belongs to is gone.
    private func finishLeaving(deleted userID: String) {
        forget()
        signedOutUserID = userID
        showsDeletedNotice = true
    }

    /// Only the status distinguishes a refusal here; the problem body has nothing the musician
    /// needs to see. A documented answer is the API's own, raised before anything committed. A
    /// thrown request, or an undocumented server error such as a gateway's or a 500 that may
    /// follow Clerk's delete, leaves the outcome unknown.
    static func deleteRemote(_ send: () async throws -> Operations.DeleteMeV1MeDelete.Output) async throws {
        let response: Operations.DeleteMeV1MeDelete.Output
        do {
            response = try await send()
        } catch {
            throw LeaveError.deleteUnconfirmed
        }
        switch response {
        case .noContent: return
        case .unauthorized(let refused):
            // Another device deleted it first, which is the outcome this request asked for.
            if (try? refused.body.applicationProblemJson._type) == AuthMiddleware.accountDeletedProblem { return }
            throw APIStatusError(status: 401)
        case .unprocessableContent: throw APIStatusError(status: 422)
        case .badGateway: throw APIStatusError(status: 502)
        case .serviceUnavailable: throw APIStatusError(status: 503)
        case .undocumented(let status, _):
            if status >= 500 { throw LeaveError.deleteUnconfirmed }
            throw APIStatusError(status: status)
        }
    }

    /// Ends the session, then deletes the user's folder. The catalog is private data on a
    /// possibly shared device, so it goes with the session; if ending the session fails, it
    /// stays.
    ///
    /// `settle` first finishes the writes the app holds back, so none lands after the store
    /// closes. It then syncs and refuses while any edit is still only on this device, since the
    /// folder takes it along. Unsent events, such as plays and scan views, go with it: a little
    /// history is not worth blocking sign-out.
    ///
    /// The store stays writable while sync stops and the session ends, so the check runs again
    /// after each. An edit that lands while the session ends keeps the folder, signed out, for
    /// the same account to sync on its next sign-in.
    static func leave(
        userID: String, store: CrosstuneStore?, root: URL, sync: (any LeavingSync)?, analytics: AnalyticsClient,
        settle: () async -> Void = {}, endSession: () async throws -> Void
    ) async throws {
        await settle()
        if let store {
            await sync?.sync()
            try await refuseUnsent(in: store)
        }
        // Stopped, no trigger can start a sync against the folder being deleted.
        await sync?.stop()
        do {
            if let store { try await refuseUnsent(in: store) }
            try await endSession()
        } catch {
            sync?.resume()
            throw error
        }
        // Only an ended session forgets the person, so a refused sign-out keeps sending as them.
        analytics.send(.signedOut)
        analytics.reset()
        // Sealed, the store refuses any write still on its way, so the check holds until the
        // folder goes.
        var keepsFolder = false
        if let store { keepsFolder = (try? await store.sealUnlessUnsent()) != true }
        try? store?.close()
        if !keepsFolder { try CrosstuneStore.delete(userID: userID, root: root) }
    }

    /// Throws the ``LeaveError`` for the first kind of work still only on this device.
    private static func refuseUnsent(in store: CrosstuneStore) async throws {
        if try await store.pendingEditCount() > 0 { throw LeaveError.unsyncedChanges }
        if try await store.notUploadedRecordingCount() > 0 { throw LeaveError.unuploadedRecordings }
        if try await store.notUploadedScanCount() > 0 { throw LeaveError.unuploadedScans }
    }

    /// Deletes the account remotely, then this device's folder regardless of whether ending the
    /// session or the folder delete itself succeeds. Once the account is gone on the API, the
    /// app must finish leaving; a folder this leaves behind is swept on the next sign-in by
    /// ``deleteOtherFolders(keeping:)``.
    static func deleteAndLeave(
        userID: String, store: CrosstuneStore?, root: URL, sync: (any LeavingSync)?, analytics: AnalyticsClient,
        deleteRemote: () async throws -> Void, endSession: () async throws -> Void
    ) async throws {
        await sync?.stop()
        // Starts uploading the user's queued events before the request without waiting for it.
        // An event that lands after the API's first delete is caught by its delayed second pass.
        analytics.flush()
        do {
            try await deleteRemote()
        } catch {
            sync?.resume()
            throw error
        }
        await dropDeleted(userID: userID, store: store, root: root, analytics: analytics, endSession: endSession)
    }

    /// Stops syncing, then drops this device's copy of an account another device deleted. It
    /// never throws: the account is already gone, so nothing here can leave it in place.
    static func forgetDeleted(
        userID: String, store: CrosstuneStore?, root: URL, sync: (any LeavingSync)?, analytics: AnalyticsClient,
        endSession: () async throws -> Void
    ) async {
        await sync?.stop()
        await dropDeleted(userID: userID, store: store, root: root, analytics: analytics, endSession: endSession)
    }

    private static func dropDeleted(
        userID: String, store: CrosstuneStore?, root: URL, analytics: AnalyticsClient,
        endSession: () async throws -> Void
    ) async {
        try? await endSession()
        // Reset first, so the event goes out unidentified rather than recreating the person.
        analytics.reset()
        analytics.send(.accountDeleted)
        try? store?.close()
        try? CrosstuneStore.delete(userID: userID, root: root)
    }

    private func confirmedUserID() throws -> String {
        guard !isOffline, case .signedIn(let userID, _) = phase else { throw LeaveError.offline }
        return userID
    }

    /// Whether `userID` is still the signed-in user after a wait, so leaving never acts on a
    /// store that belongs to whoever signed in meanwhile.
    private func isStillSignedIn(_ userID: String) -> Bool {
        guard case .signedIn(let current, _) = phase else { return false }
        return current == userID
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

    /// Opens the user's store off the main actor, first waiting out their previous one if it is
    /// still closing or an earlier open of it is still under way. Migrations and the folder scan
    /// can take a while on a large catalog, so the main actor never waits on them.
    private func openStore(for userID: String) {
        let previous = [closing[userID], opens[userID]?.task].compactMap(\.self)
        let root = storeRoot
        opening = userID
        openCount += 1
        let number = openCount
        let task = Task { [weak self] in
            for earlier in previous { await earlier.value }
            guard self?.wantsStore(for: userID) == true else {
                self?.finishOpen(userID, number: number)
                return
            }
            let result = await Self.openStore(userID: userID, root: root)
            guard let self else {
                try? result.get().close()
                return
            }
            finishOpen(userID, number: number)
            guard wantsStore(for: userID) else {
                // Signed out or switched while it opened: nothing ever saw this store.
                try? result.get().close()
                return
            }
            closeStore()
            switch result {
            case .success(let opened): adopt(opened)
            case .failure(let error):
                storeFailure = "Could not open this device's copy of your tunes: \(error.localizedDescription)"
            }
        }
        opens[userID] = (number, task)
    }

    private func wantsStore(for userID: String) -> Bool {
        guard case .signedIn(userID, _) = phase else { return false }
        return store?.userID != userID
    }

    private func finishOpen(_ userID: String, number: Int) {
        if opens[userID]?.number == number { opens[userID] = nil }
        if opening == userID, opens[userID] == nil { opening = nil }
    }

    @concurrent
    private nonisolated static func openStore(userID: String, root: URL) async -> Result<CrosstuneStore, any Error> {
        Result { try CrosstuneStore.open(userID: userID, root: root) }
    }

    private func adopt(_ opened: CrosstuneStore) {
        store = opened
        let engine = SyncEngine(
            store: opened, api: LiveSyncAPI(client: client, storageOrigin: storageOrigin),
            isOffline: { [weak self] in self?.isOffline ?? true })
        syncedFiguresReported = false
        engine.onSynced = { [weak self] in self?.syncLanded(in: opened, storedFigures: $0) }
        sync = SessionSync(store: opened, engine: engine, isActive: isActive, isOffline: isOffline)
        // A capture a crash or kill cut short is saved now rather than waiting on the user.
        Task { await Recorder.recoverLeftoverCaptures(in: opened) }
        identifyWithStoreFigures()
    }

    /// Only one user is signed in at a time, so any other folder was left by a sign-out that did
    /// not finish, or belongs to a store still closing or opening, which is deleted once that is
    /// done. A folder whose store is about to open, once its previous store has closed, is kept.
    private func deleteOtherFolders(keeping userID: String) {
        let pending =
            closing.filter { $0.key != userID }.map(\.value) + opens.filter { $0.key != userID }.map(\.value.task)
        guard !pending.isEmpty else { return deleteFoldersNotInUse(keeping: userID) }
        Task { [weak self] in
            for close in pending { await close.value }
            guard let self, case .signedIn(userID, confirmed: true) = phase else { return }
            deleteFoldersNotInUse(keeping: userID)
        }
    }

    private func deleteFoldersNotInUse(keeping userID: String) {
        let keep = Self.foldersInUse(
            signedIn: userID, open: store?.userID, opening: opening, closing: Set(closing.keys).union(opens.keys))
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
        graceElapsed: Bool,
        signedOutUserID: String? = nil
    ) -> Phase {
        if clerkLoaded {
            guard let clerkUserID, clerkUserID != signedOutUserID else { return .signedOut }
            return .signedIn(userID: clerkUserID, confirmed: true)
        }
        guard graceElapsed else { return .loading }
        return rememberedUserID.map { .signedIn(userID: $0, confirmed: false) } ?? .signedOut
    }
}

/// The last signed-in Clerk user ID, kept so the app can open offline. It identifies the
/// user and grants nothing: the session itself stays in Clerk's storage.
public final class RememberedUser: @unchecked Sendable {
    private static let key = "lastSignedInUserID"
    private static let deletedKey = "deletedUserID"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var userID: String? {
        get { defaults.string(forKey: Self.key) }
        set { defaults.set(newValue, forKey: Self.key) }
    }

    /// A deleted account's user, kept signed out until Clerk lets go of them.
    public var deletedUserID: String? {
        get { defaults.string(forKey: Self.deletedKey) }
        set { defaults.set(newValue, forKey: Self.deletedKey) }
    }
}
