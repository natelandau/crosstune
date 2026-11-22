import CrosstuneAnalytics
import CrosstuneDiagnostics
import CrosstuneShare
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// The app's side of the share extension: keeps the signed-in user's tune list and file limit in
/// the shared folder, and adds what the extension saved to that user's store.
///
/// A user's shared folder goes only when that user signs out or deletes the account, or when
/// another user's sign-in is confirmed. A store closed for any other reason, such as an expired
/// session, keeps it, as the store's own folder is kept.
@MainActor
@Observable
public final class ShareHost {
    /// The shared files refused for good, until the Recordings screen takes them.
    public let refusals = Pending<[SharedFileRefusal]>([])
    /// Shared recordings were added on a plan that does not play them, until a window takes it
    /// to show the Plan sheet.
    public let plan = Pending(false)

    @ObservationIgnored private let container: ShareContainer?
    @ObservationIgnored private let intake: ShareIntake?
    @ObservationIgnored private var store: CrosstuneStore?
    @ObservationIgnored private var publishing: [Task<Void, Never>] = []
    @ObservationIgnored private var signal: InboxSignalToken?
    /// The latest intake, stop of a closed store's writers, or folder removal. Each waits for the
    /// one before it, so a removal never runs while anything can still write to a folder.
    @ObservationIgnored private var tail: Task<Void, Never>?
    nonisolated private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-host")

    /// - Parameters:
    ///   - container: Nil in a build without the App Group, which shares nothing.
    ///   - intake: Nil adds nothing the extension saved.
    public init(container: ShareContainer?, intake: ShareIntake?) {
        self.container = container
        self.intake = intake
    }

    /// A host on the App Group's folder, which shares nothing in a build without the entitlement.
    public static func appGroup(
        resolve: LinkSheetModel.Resolve?, analytics: AnalyticsClient, diagnostics: DiagnosticsClient
    ) -> ShareHost {
        let container = ShareContainer.appGroup()
        return ShareHost(
            container: container,
            intake: container.map {
                ShareIntake(container: $0, resolve: resolve, analytics: analytics, diagnostics: diagnostics)
            })
    }

    isolated deinit {
        for task in publishing { task.cancel() }
    }

    /// Follows `next`, the open store, or no one when nil, and adds what was shared for its user.
    public func storeChanged(_ next: CrosstuneStore?) {
        guard next !== store else { return }
        if next?.userID != store?.userID {
            refusals.clear()
            plan.clear()
        }
        retire(publishing)
        publishing = []
        signal = nil
        store = next
        guard let container else { return }
        do {
            try container.setCurrentUserID(next?.userID)
        } catch {
            Self.logger.warning("The signed-in user was not recorded: \(error)")
        }
        guard let next else { return }
        publishing = [Self.publishTunes(of: next, to: container), Self.publishAccount(of: next, to: container)]
        signal = InboxSignal.observe { [weak self] in
            Task { await self?.becameActive() }
        }
        // A store opens after the app became active, so what was shared before launch waits for
        // this pass.
        Task { await becameActive() }
    }

    /// Removes what is held for `userID`, who signed out or deleted the account, including items
    /// not yet added.
    public func userLeft(_ userID: String) {
        if store?.userID == userID { storeChanged(nil) }
        remove { container, signedIn in
            // The same user signed in again while this waited.
            guard signedIn != userID else { return }
            try container.removeUser(userID)
        }
    }

    /// Removes what is held for every user but `userID`, whose sign-in is confirmed. Only one
    /// user is signed in at a time, so any other folder was left by a leave that did not finish
    /// or that happened while the app was not running.
    public func signInConfirmed(_ userID: String) {
        remove { container, signedIn in
            try container.removeUsers(except: Set([userID, signedIn].compactMap(\.self)))
        }
    }

    /// Ends once every intake, writer, and folder removal started so far is done.
    func settled() async {
        await tail?.value
    }

    /// Runs `operation` once every operation queued before it has ended.
    @discardableResult
    private func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = tail
        let task = Task {
            await previous?.value
            await operation()
        }
        tail = task
        return task
    }

    /// Runs `removal` once no intake and no writer of a closed store can still write to a folder,
    /// with the user signed in by then.
    private func remove(_ removal: @escaping @Sendable (ShareContainer, _ signedIn: String?) throws -> Void) {
        guard let container else { return }
        enqueue { await Self.run(removal, in: container, signedIn: self.store?.userID) }
    }

    /// Off the main actor, since a user's folder can hold long recordings.
    @concurrent
    private static func run(
        _ removal: @Sendable (ShareContainer, _ signedIn: String?) throws -> Void, in container: ShareContainer,
        signedIn: String?
    ) async {
        do {
            try removal(container, signedIn)
        } catch {
            logger.warning("A shared folder was not removed: \(error)")
        }
    }

    /// Stops `tasks`, and keeps a way to wait for them to end.
    private func retire(_ tasks: [Task<Void, Never>]) {
        guard !tasks.isEmpty else { return }
        for task in tasks { task.cancel() }
        enqueue { for task in tasks { await task.value } }
    }

    /// Adds what the share extension saved for the open store's user.
    public func becameActive() async {
        guard let store, let intake else { return }
        await enqueue {
            // A pass queued behind another must not reach a store that has since closed.
            guard self.store === store else { return }
            await self.addPending(to: store, with: intake)
        }.value
    }

    private func addPending(to store: CrosstuneStore, with intake: ShareIntake) async {
        #if os(iOS)
            // Leaving the app mid-pass must not suspend a write half done.
            let hold = BackgroundHold(name: "Add shared items")
            defer { hold.end() }
        #endif
        let report = await intake.addPending(to: store)
        // Another user signed in during the pass.
        guard self.store === store else { return }
        refusals.value += report.refusedFiles
        if report.needsPremium { plan.value = true }
    }

    /// Every live tune with the user's row, as the extension lists it, written on each change.
    nonisolated private static func publishTunes(of store: CrosstuneStore, to container: ShareContainer) -> Task<
        Void, Never
    > {
        publish(store) { db in
            try listedTunes(db)
        } write: { entries, userID in
            try ShareTuneList.write(entries, userID: userID, in: container)
        }
    }

    /// Reads only the listed columns, since a catalog's full rows carry lyrics and notes the
    /// extension never shows. In catalog order.
    nonisolated private static func listedTunes(_ db: Database) throws -> [ShareTuneEntry] {
        let userTunes = UserTune.filter(UserTune.CodingKeys.deletedAt == nil).select(UserTune.CodingKeys.tuneID)
        let tunes = try Tune.filter(Tune.CodingKeys.deletedAt == nil && userTunes.contains(Tune.CodingKeys.id))
            .select(
                Tune.CodingKeys.id, Tune.CodingKeys.title, Tune.CodingKeys.tuneType, Tune.CodingKeys.key,
                Tune.CodingKeys.modes
            )
            .asRequest(of: ListedTune.self)
            .fetchAll(db)
        return tunes.map(entry).sorted { first, second in
            if CatalogSearch.precedes(first.title, second.title) { return true }
            if CatalogSearch.precedes(second.title, first.title) { return false }
            return first.id < second.id
        }
    }

    /// The account's file limit, written on each change once the server has sent it.
    nonisolated private static func publishAccount(of store: CrosstuneStore, to container: ShareContainer) -> Task<
        Void, Never
    > {
        publish(store) { db in
            try MetaKey.storage.value(in: db, as: StorageUsage.self)?.maxFileBytes
        } write: { limit, userID in
            guard let limit else { return }
            try ShareAccount.write(ShareAccount(maxFileBytes: limit), userID: userID, in: container)
        }
    }

    /// Writes each new value of `fetch` off the main actor, until cancelled.
    nonisolated private static func publish<Value: Equatable & Sendable>(
        _ store: CrosstuneStore,
        fetch: @escaping @Sendable (Database) throws -> Value,
        write: @escaping @Sendable (Value, String) throws -> Void
    ) -> Task<Void, Never> {
        let (database, userID) = (store.database, store.userID)
        return Task(priority: .utility) {
            await follow(database, userID: userID, fetch: fetch, write: write)
        }
    }

    @concurrent
    nonisolated private static func follow<Value: Equatable & Sendable>(
        _ database: DatabasePool, userID: String,
        fetch: @escaping @Sendable (Database) throws -> Value,
        write: @escaping @Sendable (Value, String) throws -> Void
    ) async {
        do {
            for try await value in ValueObservation.tracking(fetch).removeDuplicates().values(in: database) {
                do {
                    try write(value, userID)
                } catch {
                    logger.warning("A file for the share extension was not written: \(error)")
                }
            }
        } catch is CancellationError {
        } catch {
            logger.warning("The share extension's files stopped following the store: \(error)")
        }
    }

    nonisolated private static func entry(_ tune: ListedTune) -> ShareTuneEntry {
        let type = tune.tuneType?.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = [type?.isEmpty == false ? type : nil, KeyModeText(key: tune.key, modes: tune.modes)?.shown]
            .compactMap { $0 }
        return ShareTuneEntry(
            id: tune.id, title: tune.title, detail: parts.isEmpty ? nil : parts.joined(separator: " · "))
    }
}
