import CrosstuneStore
import Foundation
import Observation
import os

/// Keeps one user's store in step with the API: pushes the outbox, pulls what changed on the
/// server, and refreshes the storage figures, on a loop that retries with backoff.
///
/// Recording audio moves on a second loop, triggered after every sync run, so a long upload
/// never holds up push and pull.
@MainActor @Observable
public final class SyncEngine {
    /// How many outbox entries one push sends.
    public static let pushBatchSize = 500

    public var status: SyncStatus { syncLoop.status }
    public var transferStatus: TransferStatus { transferLoop.status }
    /// When the last run that finished clean ended, kept across launches; nil before the first.
    public private(set) var lastSyncedAt: Date?
    /// The recordings whose audio is being fetched now, by a play or the download pass.
    public private(set) var downloading: Set<String> = []
    /// Called after each run that finishes clean, which proves the API accepts the session.
    @ObservationIgnored public var onSynced: (@MainActor () -> Void)?

    private let store: CrosstuneStore
    private let api: any SyncAPI
    private let isOffline: @MainActor () -> Bool
    private let batchSize: Int
    private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "sync")

    private let sleep: Sleeper
    /// Stands in for the real upload and download passes in tests that only count runs.
    private let transferPass: (@MainActor () async throws -> Void)?

    @ObservationIgnored private var stopped = false
    @ObservationIgnored private var inFlightDownloads: [String: Task<URL?, any Error>] = [:]

    // Lazy so their closures can capture self, which they reach only once init has finished.
    @ObservationIgnored private lazy var syncLoop = SyncLoop<SyncStatus>(
        name: "sync", sleep: sleep,
        isStopped: { [weak self] in self?.stopped ?? true },
        classify: { [weak self] error in classifyFailure(error, isOffline: self?.isOffline() ?? true) },
        // A pushed row can now take its upload, and a pulled one its download.
        afterRun: { [weak self] in
            Task { await self?.transferLoop.trigger() }
        },
        run: { [weak self] in try await self?.runSync() }
    )
    @ObservationIgnored private lazy var transferLoop = SyncLoop<TransferStatus>(
        name: "transfer", sleep: sleep,
        isStopped: { [weak self] in self?.stopped ?? true },
        classify: { [weak self] error in classifyTransferFailure(error, isOffline: self?.isOffline() ?? true) },
        run: transferPass ?? { [weak self] in try await self?.runTransfers() }
    )
    @ObservationIgnored let downloadRetries = DownloadRetries()
    @ObservationIgnored private lazy var transfers = Transfers(
        store: store, api: api,
        checkStopped: { [weak self] in
            guard let self else { throw RunStopped() }
            try checkStopped()
        },
        downloadRetries: downloadRetries)

    /// - Parameters:
    ///   - isOffline: Whether the device has no connection. A run while offline ends as
    ///     `offline` without a request.
    ///   - sleep: Waits out a retry's backoff.
    public convenience init(
        store: CrosstuneStore,
        api: any SyncAPI,
        isOffline: @escaping @MainActor () -> Bool,
        batchSize: Int = SyncEngine.pushBatchSize,
        sleep: @escaping Sleeper = { try await Task.sleep(for: $0) }
    ) {
        self.init(store: store, api: api, isOffline: isOffline, batchSize: batchSize, sleep: sleep, transferPass: nil)
    }

    /// - Parameter transferPass: One run of the transfer loop, in place of the upload and
    ///   download passes.
    init(
        store: CrosstuneStore,
        api: any SyncAPI,
        isOffline: @escaping @MainActor () -> Bool,
        batchSize: Int,
        sleep: @escaping Sleeper,
        transferPass: (@MainActor () async throws -> Void)?
    ) {
        self.store = store
        self.api = api
        self.isOffline = isOffline
        self.batchSize = batchSize
        self.sleep = sleep
        self.transferPass = transferPass

        Task { [weak self, store] in
            let saved = try? await store.meta(.lastSyncedAt, as: Timestamp.self)
            guard let self, lastSyncedAt == nil, let saved else { return }
            lastSyncedAt = saved.date
        }
    }

    /// Pushes, pulls, and refreshes the storage figures now, or once more after the run in
    /// flight. Returns when that run is done; a failure shows in ``status``.
    public func sync() async {
        await syncLoop.trigger()
    }

    /// Runs the recording upload and download passes now, or once more after the run in flight.
    public func transfer() async {
        await transferLoop.trigger()
    }

    /// Stops both loops and cancels any pending retry. Triggers do nothing until ``resume()``.
    public func stop() {
        stopped = true
        syncLoop.cancelRetry()
        transferLoop.cancelRetry()
    }

    /// Stops as ``stop()`` does, then returns once any run or download already in flight is done,
    /// so the store can be closed or deleted with nothing still writing to it.
    public func stopAndWait() async {
        stop()
        await syncLoop.finishRunning()
        await transferLoop.finishRunning()
        // A download that starts after this snapshot throws at its stop check before its first
        // write, so only these can still touch the store.
        for download in inFlightDownloads.values {
            _ = try? await download.value
        }
    }

    public func resume() {
        stopped = false
    }

    /// The recording's audio on this device, fetched first when it is not here. Only one fetch
    /// per recording runs at a time, whether a play or the download pass asks. Nil when there
    /// is nothing to play: offline with no local copy, not ready, or the fetch failed.
    public func download(_ recordingID: String) async -> URL? {
        if isOffline() {
            return await store.localAudio(recordingID: recordingID)
        }
        return try? await fetchOne(recordingID)
    }

    /// Asks the server to transcode a failed recording again, then syncs so its new state shows.
    public func retry(_ recordingID: String) async throws {
        try checkStopped()
        try await api.retryRecording(recordingID: recordingID)
        Task { await sync() }
    }

    /// What the server finds at a pasted link, or nil when offline or the lookup fails.
    public func resolveLink(_ url: String) async -> ResolvedLink? {
        guard !isOffline() else { return nil }
        return try? await api.resolveLink(url: url)
    }

    private func runTransfers() async throws {
        if isOffline() { throw DeviceOffline() }
        // A file's own transient upload failure is held so the download pass still runs, then
        // thrown once it has.
        let uploadError = try await transfers.uploadPass()
        try await transfers.downloadPass { [weak self] id in try await self?.fetchOne(id) }
        if let uploadError { throw uploadError }
    }

    private func fetchOne(_ recordingID: String) async throws -> URL? {
        if let running = inFlightDownloads[recordingID] { return try await running.value }
        let transfers = transfers
        let task = Task { try await transfers.downloadOne(recordingID) }
        inFlightDownloads[recordingID] = task
        downloading.insert(recordingID)
        defer {
            inFlightDownloads[recordingID] = nil
            downloading.remove(recordingID)
        }
        return try await task.value
    }

    private func runSync() async throws {
        if isOffline() { throw DeviceOffline() }
        try await push()
        try await pull()
        do {
            try checkStopped()
            let figures = try await api.storage()
            try await store.setMeta(.storage, to: figures)
        } catch  where error is RunStopped || isAuthFailure(error) {
            throw error
        } catch {
            // Storage figures are informational; only an auth failure fails a run whose push and
            // pull already landed.
        }
        let finished = Timestamp.now
        lastSyncedAt = finished.date
        onSynced?()
        do {
            try await store.setMeta(.lastSyncedAt, to: finished)
        } catch {
            // Only the next launch's first reading depends on it; the run itself landed.
            logger.error("Could not save the last sync time: \(String(describing: error), privacy: .public)")
        }
    }

    /// Ends a stopped run before its next request. A stopped engine may be closing a store whose
    /// user has signed out, and the next request would carry the new user's token.
    private func checkStopped() throws {
        if stopped { throw RunStopped() }
    }

    private func push() async throws {
        while true {
            let batch = try await store.pendingChanges(limit: batchSize)
            if batch.isEmpty { return }
            try checkStopped()
            let results = try await api.push(batch.map(Change.init))
            let (invalid, settled) = try await store.write { writer in
                try writer.applyPushResults(sent: batch, results: results)
            }
            for change in invalid {
                logger.warning(
                    "Change rejected: \(change.table.rawValue, privacy: .public) \(change.id, privacy: .public) \(change.reason ?? "", privacy: .public)"
                )
            }
            // A batch that settles nothing would send the same entries forever.
            if settled == 0 || batch.count < batchSize { return }
        }
    }

    private func pull() async throws {
        var since = try await store.meta(.pullCursor, as: Int64.self) ?? 0
        while true {
            try checkStopped()
            let page = try await api.pull(since: since)
            try await store.write { writer in
                try writer.applyPullPage(rows: page.rows.map { ($0.table, $0.row) }, nextSince: page.nextSince)
            }
            since = page.nextSince
            if !page.hasMore { return }
        }
    }
}
