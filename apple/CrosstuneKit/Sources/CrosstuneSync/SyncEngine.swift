import CrosstuneAnalytics
import CrosstuneDiagnostics
import CrosstuneStore
import Foundation
import Observation
import os

/// Keeps one user's store in step with the API: pushes the outbox, pulls what changed on the
/// server, and refreshes the storage usage, on a loop that retries with backoff.
///
/// Recording audio and scan images move on a second loop, triggered after every sync
/// run, so a long upload never holds up push and pull.
@MainActor @Observable
public final class SyncEngine {
    /// How many outbox entries one push sends.
    public static let pushBatchSize = 500
    /// How long a rate-limited search waits when the server names no wait of its own.
    public static let defaultRetryAfterSeconds = 60
    /// The name of the background time a run holds while the app is not active.
    static let backgroundTimeName = "Upload recordings"

    public var status: SyncStatus { syncLoop.status }
    public var transferStatus: TransferStatus { transferLoop.status }
    /// When the last run that finished clean ended, kept across launches; nil before the first.
    public private(set) var lastSyncedAt: Date?
    /// The recordings whose audio is being fetched now, by a play or the download pass.
    public private(set) var downloading: Set<String> = []
    /// Called after each run that finishes clean, which proves the API accepts the session, with
    /// whether the run stored fresh storage usage.
    @ObservationIgnored public var onSynced: (@MainActor (_ storedUsage: Bool) -> Void)?

    private let store: CrosstuneStore
    private let api: any SyncAPI
    private let uploads: any RecordingUploadTransport
    private let isOffline: @MainActor () -> Bool
    private let batchSize: Int
    private let analytics: AnalyticsClient
    private let diagnostics: DiagnosticsClient
    /// The clock the plan is judged by.
    private let now: @MainActor () -> Date
    private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "sync")

    private let sleep: Sleeper
    private let holdBackgroundTime: BackgroundTimeHolder
    /// Replaces the real upload and download passes in tests that only count runs.
    private let transferPass: (@MainActor () async throws -> Void)?

    @ObservationIgnored private var stopped = false
    /// The last sync run or events pull queued, which the next one waits behind.
    @ObservationIgnored private var turn: Task<Void, Never>?
    /// How many sync runs and events pulls are running or waiting their turn.
    @ObservationIgnored private(set) var queuedTurns = 0
    @ObservationIgnored private var inFlightDownloads: [String: Task<URL?, any Error>] = [:]
    @ObservationIgnored private var inFlightPeaks: [String: Task<Data?, any Error>] = [:]
    /// The finished upload task being handled, which a stop waits for before the store closes.
    @ObservationIgnored private var uploadEventInFlight: Task<Void, Never>?
    /// This engine's upload event handler, nil while stopped.
    @ObservationIgnored private var uploadAttachment: UploadHandlerAttachment?
    /// Nil until the app first reports whether it is in the foreground.
    @ObservationIgnored private var isActive: Bool?
    /// How many sync and transfer runs are running or about to start.
    @ObservationIgnored private var runsInFlight = 0
    /// Held while a run is in flight and the app is not active, so the system does not suspend
    /// the app mid-run.
    @ObservationIgnored private var backgroundHold: (any BackgroundTimeHold)?
    /// How many callers have waited on a download or peaks fetch already in flight.
    @ObservationIgnored private(set) var joinedFetches = 0

    // Lazy so their closures can capture self, which they reach only once init has finished.
    @ObservationIgnored private lazy var syncLoop = SyncLoop<SyncStatus>(
        name: "sync", sleep: sleep,
        isStopped: { [weak self] in self?.stopped ?? true },
        classify: { [weak self] error in classifyFailure(error, isOffline: self?.isOffline() ?? true) },
        // A pushed row can now take its upload, and a pulled one its download.
        afterRun: { [weak self] in self?.triggerTransfers() },
        runningChanged: { [weak self] in self?.runningChanged($0) },
        onFailure: { [weak self] _, error in
            self?.analytics.send(.syncFailed(reason: syncFailureReason(error)))
        },
        now: now,
        isReportable: { _, error in isReportableFailure(error) },
        onPersistentFailure: { [weak self] _, error in self?.diagnostics.report(error, area: .sync) },
        run: { [weak self] in try await self?.runSync() }
    )
    @ObservationIgnored private lazy var transferLoop = SyncLoop<TransferStatus>(
        name: "transfer", sleep: sleep,
        isStopped: { [weak self] in self?.stopped ?? true },
        classify: { [weak self] error in classifyTransferFailure(error, isOffline: self?.isOffline() ?? true) },
        runningChanged: { [weak self] in self?.runningChanged($0) },
        now: now,
        isReportable: { _, error in isReportableFailure(error) },
        onPersistentFailure: { [weak self] _, error in self?.diagnostics.report(error, area: .transfer) },
        run: transferPass ?? { [weak self] in try await self?.runTransfers() }
    )
    @ObservationIgnored let downloadRetries = DownloadRetries()
    @ObservationIgnored let scanRetries = DownloadRetries()
    /// The stop check every transfer request runs first; a released engine counts as stopped.
    @ObservationIgnored private lazy var transferStopCheck: @MainActor () throws -> Void = { [weak self] in
        guard let self else { throw RunStopped() }
        try checkStopped()
    }
    @ObservationIgnored private lazy var transfers = Transfers(
        store: store, api: api,
        checkStopped: transferStopCheck, uploads: uploads, now: now,
        downloadRetries: downloadRetries, analytics: analytics, diagnostics: diagnostics)
    @ObservationIgnored private lazy var scans = ScanTransfers(
        store: store, api: api,
        checkStopped: transferStopCheck, now: now)

    /// - Parameters:
    ///   - uploads: Sends recording uploads as tasks that outlive the app, and reports each
    ///     finished one to this engine.
    ///   - isOffline: Whether the device has no connection. A run while offline ends as
    ///     `offline` without a request.
    ///   - sleep: Waits out a retry's backoff.
    ///   - holdBackgroundTime: Keeps the app running while a run that is in flight when the app is
    ///     not active finishes.
    ///   - analytics: Where a sync that fails, and an upload that is refused, are reported.
    ///   - diagnostics: Where a sync or transfer that keeps failing, and an upload that fails for
    ///     good, are reported.
    ///   - now: The clock the account's plan, and how long a failure has lasted, are judged by.
    public convenience init(
        store: CrosstuneStore,
        api: any SyncAPI,
        uploads: any RecordingUploadTransport,
        isOffline: @escaping @MainActor () -> Bool,
        batchSize: Int = SyncEngine.pushBatchSize,
        sleep: @escaping Sleeper = liveSleeper,
        holdBackgroundTime: @escaping BackgroundTimeHolder = NoBackgroundTimeHold.holder,
        analytics: AnalyticsClient = .noop,
        diagnostics: DiagnosticsClient = .noop,
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.init(
            store: store, api: api, uploads: uploads, isOffline: isOffline, batchSize: batchSize, sleep: sleep,
            holdBackgroundTime: holdBackgroundTime, transferPass: nil,
            analytics: analytics, diagnostics: diagnostics, now: now)
    }

    /// - Parameter transferPass: One run of the transfer loop, in place of the upload and
    ///   download passes.
    init(
        store: CrosstuneStore,
        api: any SyncAPI,
        uploads: any RecordingUploadTransport,
        isOffline: @escaping @MainActor () -> Bool,
        batchSize: Int,
        sleep: @escaping Sleeper,
        holdBackgroundTime: @escaping BackgroundTimeHolder = NoBackgroundTimeHold.holder,
        transferPass: (@MainActor () async throws -> Void)?,
        analytics: AnalyticsClient = .noop,
        diagnostics: DiagnosticsClient = .noop,
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.store = store
        self.analytics = analytics
        self.diagnostics = diagnostics
        self.now = now
        self.api = api
        self.uploads = uploads
        self.isOffline = isOffline
        self.batchSize = batchSize
        self.sleep = sleep
        self.holdBackgroundTime = holdBackgroundTime
        self.transferPass = transferPass

        Task { [weak self, store] in
            let saved = try? await store.meta(.lastSyncedAt, as: Timestamp.self)
            guard let self, lastSyncedAt == nil, let saved else { return }
            lastSyncedAt = saved.date
        }
        attachUploads()
    }

    isolated deinit {
        // An engine released without a stop leaves later completions waiting for the next one.
        detachUploads()
        backgroundHold?.end()
    }

    /// Pushes, pulls, and refreshes the storage usage now, or once more after the run in
    /// flight. Returns when that run is done; a failure shows in ``status``.
    public func sync() async {
        await syncLoop.trigger()
    }

    /// Pulls every history row the server stored since the last events pull, page by page, each
    /// page landing with its cursor so a failure keeps the pages before it. Does nothing offline.
    /// Never runs beside a sync run. A failure is logged; the next call starts from the cursor.
    public func pullEvents() async {
        guard !stopped, !isOffline() else { return }
        do {
            try await inTurn { [weak self] in
                guard let self else { return }
                // A stop while waiting for the sync run means the store may be closing.
                try checkStopped()
                try await pullEventPages()
            }
        } catch is RunStopped {
            return
        } catch {
            logger.warning("Events pull failed: \(logDescription(of: error), privacy: .public)")
        }
    }

    /// Runs the scan and recording upload and download passes now, or once more after
    /// the run in flight.
    public func transfer() async {
        await transferLoop.trigger()
    }

    /// Stops both loops and cancels any pending retry. Triggers do nothing until ``resume()``.
    public func stop() {
        stopped = true
        // Later completions wait in the session for the next engine, rather than reaching a
        // store that may be closing.
        detachUploads()
        syncLoop.cancelRetry()
        transferLoop.cancelRetry()
    }

    /// Stops as ``stop()`` does, then returns once any run or download already in flight is done,
    /// so the store can be closed or deleted with nothing still writing to it.
    public func stopAndWait() async {
        stop()
        await syncLoop.finishRunning()
        await transferLoop.finishRunning()
        await turn?.value
        await uploadEventInFlight?.value
        // A download or peaks fetch that starts after this snapshot throws at its stop check
        // before its first write, so only these can still touch the store.
        for download in inFlightDownloads.values {
            _ = try? await download.value
        }
        for fetch in inFlightPeaks.values {
            _ = try? await fetch.value
        }
    }

    public func resume() {
        stopped = false
        attachUploads()
    }

    /// Reports whether the app is in the foreground. A run in flight while it is not holds
    /// background time until the run ends, so the system does not suspend the app mid-run.
    public func setActive(_ active: Bool) {
        isActive = active
        updateBackgroundHold()
    }

    private func attachUploads() {
        detachUploads()
        uploadAttachment = uploads.attach(userID: store.userID) { [weak self] event in
            await self?.handleUploadEvent(event)
        }
    }

    private func detachUploads() {
        if let uploadAttachment { uploads.detach(uploadAttachment) }
        uploadAttachment = nil
    }

    /// Starts a transfer run without waiting for it. It counts as in flight from this call, so a
    /// background hold does not lapse before the run's task starts.
    private func triggerTransfers() {
        runningChanged(true)
        Task { [weak self] in
            await self?.transferLoop.trigger()
            self?.runningChanged(false)
        }
    }

    private func runningChanged(_ running: Bool) {
        runsInFlight += running ? 1 : -1
        updateBackgroundHold()
    }

    /// Holds background time exactly while a run is in flight and the app is not active.
    private func updateBackgroundHold() {
        let needsHold = isActive == false && runsInFlight > 0
        if needsHold, backgroundHold == nil {
            backgroundHold = holdBackgroundTime(Self.backgroundTimeName)
        } else if !needsHold, let backgroundHold {
            backgroundHold.end()
            self.backgroundHold = nil
        }
    }

    /// Handle one finished upload task. The session hands over one at a time, so at most one is
    /// in flight. It counts as a run in flight, so a direct confirm it sends holds background
    /// time when the app leaves the foreground.
    private func handleUploadEvent(_ event: UploadEvent) async {
        let transfers = transfers
        let logger = logger
        runningChanged(true)
        let handling = Task { [weak self] in
            do {
                let result = try await transfers.handle(event)
                // A file handed back is the pass's to settle, without waiting for the next sync.
                if let result, result != .uploaded {
                    self?.triggerTransfers()
                }
            } catch is RunStopped {
                // The next pass after a resume starts again a hand-off whose answer was dropped.
            } catch {
                logger.error(
                    "Upload completion for \(event.tag.recordingID, privacy: .public) failed: \(logDescription(of: error), privacy: .public)"
                )
                // The hand-off may have no task left, so the pass starts its step again rather
                // than leaving it until an unrelated sync.
                self?.triggerTransfers()
            }
        }
        uploadEventInFlight = handling
        await handling.value
        uploadEventInFlight = nil
        runningChanged(false)
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

    /// Fetches a ready recording's playback file into `destination` and nowhere else: the store
    /// never learns of it, so a file the plan keeps off this device stays off it. Throws offline.
    public func fetchRecordingCopy(_ recordingID: String, to destination: URL) async throws {
        try checkStopped()
        if isOffline() { throw DeviceOffline() }
        let signed = try await api.downloadURL(recordingID: recordingID)
        try checkStopped()
        try await api.getObject(signed.url, to: destination)
    }

    /// Fetches a ready scan's image into `destination` and nowhere else, as
    /// ``fetchRecordingCopy(_:to:)`` does for a recording.
    public func fetchScanCopy(_ scanID: String, to destination: URL) async throws {
        try checkStopped()
        if isOffline() { throw DeviceOffline() }
        let signed = try await api.scanDownload(scanID: scanID)
        try checkStopped()
        try await api.getObject(signed.url, to: destination)
    }

    /// The recording's current waveform. Fetched from the server first when this device's copy
    /// does not match its current revision; offline, whatever is already on disk plays as is.
    /// Only one fetch per recording runs at a time. Nil when there is nothing to show: offline
    /// with none on disk, no waveform built yet, or the fetch failed.
    public func peaks(_ recordingID: String) async -> Data? {
        if isOffline() {
            return await store.localPeaks(recordingID: recordingID)
        }
        return try? await fetchPeaksOnce(recordingID)
    }

    /// Asks the server to transcode a failed recording again, then syncs so its new state shows.
    /// Throws offline.
    public func retry(_ recordingID: String) async throws {
        try checkStopped()
        if isOffline() { throw DeviceOffline() }
        try await api.retryRecording(recordingID: recordingID)
        Task { await sync() }
    }

    /// Asks the server to read the account's purchases now. The new plan reaches this device with
    /// the next sync. Throws offline.
    public func refreshBilling() async throws {
        try checkStopped()
        if isOffline() { throw DeviceOffline() }
        try await api.refreshBilling()
    }

    /// What the server finds at a pasted link, or nil when offline or the lookup fails.
    public func resolveLink(_ url: String) async -> ResolvedLink? {
        guard !isOffline() else { return nil }
        return try? await api.resolveLink(url: url)
    }

    /// The place at `point` as the server names it, or nil when offline, when there is none,
    /// or when the lookup fails.
    public func reversePlace(at point: Coordinate) async -> ReversedPlace? {
        guard !isOffline() else { return nil }
        return try? await api.reversePlace(lat: point.lat, lon: point.lon)
    }

    /// Searches `providers` for recordings matching `q`. Never throws: a rate limit is told
    /// apart from every other failure, so the musician learns how long to wait.
    public func searchRecordings(q: String, providers: [String], country: String) async -> RecordingSearchOutcome {
        guard !isOffline() else { return .offline }
        do {
            return .ok(try await api.searchRecordings(q: q, providers: providers, country: country).groups)
        } catch let error as APIStatusError where error.status == 429 {
            return .rateLimited(retryAfter: error.retryAfterSeconds ?? Self.defaultRetryAfterSeconds)
        } catch {
            return .failed
        }
    }

    private func runTransfers() async throws {
        if isOffline() { throw DeviceOffline() }
        // A file's own transient failure is held so the later passes still run, then the first
        // is thrown once they have. Scans go first: they are small, and the reading view needs
        // them more than any one recording.
        let scanUploadError = try await scans.uploadPass()
        var scanDownloadError: (any Error)?
        do {
            try await scans.downloadPass(retries: scanRetries)
        } catch  where endsThePass(error) {
            throw error
        } catch {
            scanDownloadError = error
        }
        let recordingUploads = try await transfers.uploadPass()
        // Nothing else may trigger a run when a file's backoff ends, so without this a failed
        // upload would wait for an unrelated sync.
        if let next = recordingUploads.nextAttemptAt {
            transferLoop.runAgain(after: .milliseconds(max(next.milliseconds - Timestamp.now.milliseconds, 0)))
        }
        try await transfers.downloadPass(
            fetch: { [weak self] id in try await self?.fetchOne(id) },
            fetchPeaksFor: { [weak self] id in try await self?.fetchPeaksOnce(id) })
        if let held = scanUploadError ?? scanDownloadError ?? recordingUploads.firstError { throw held }
    }

    private func fetchOne(_ recordingID: String) async throws -> URL? {
        if let running = inFlightDownloads[recordingID] {
            joinedFetches += 1
            return try await running.value
        }
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

    /// One fetch per recording at a time, whether the download pass or a caller asks.
    private func fetchPeaksOnce(_ recordingID: String) async throws -> Data? {
        if let running = inFlightPeaks[recordingID] {
            joinedFetches += 1
            return try await running.value
        }
        let transfers = transfers
        let task = Task { try await transfers.fetchPeaks(recordingID) }
        inFlightPeaks[recordingID] = task
        defer { inFlightPeaks[recordingID] = nil }
        return try await task.value
    }

    /// Runs `body` once the sync run or events pull queued before it is done, so the two never
    /// write at once and an events page never lands mid-push.
    private func inTurn(_ body: @escaping @MainActor () async throws -> Void) async throws {
        let previous = turn
        queuedTurns += 1
        let next = Task {
            defer { queuedTurns -= 1 }
            await previous?.value
            try await body()
        }
        turn = Task { _ = await next.result }
        try await next.value
    }

    private func runSync() async throws {
        if isOffline() { throw DeviceOffline() }
        try await inTurn { [weak self] in
            guard let self else { throw RunStopped() }
            // A stop while waiting for an events pull means the store may be closing.
            try checkStopped()
            try await syncOnce()
        }
    }

    private func syncOnce() async throws {
        try await push()
        try await postSeenNotices()
        try await pull()
        var storedUsage = false
        do {
            try checkStopped()
            let account = try await api.account()
            try checkStopped()
            try await store.setMeta(.storage, to: account.storage)
            storedUsage = true
            try await store.setMeta(.countryCenter, to: account.countryCenter)
        } catch  where endsThePass(error) {
            throw error
        } catch {
            // Storage usage is informational; only an auth failure fails a run whose push and
            // pull already landed.
        }
        // An account request that failed after a stop is swallowed above, so check again.
        try checkStopped()
        let finished = Timestamp.now
        lastSyncedAt = finished.date
        onSynced?(storedUsage)
        do {
            try await store.setMeta(.lastSyncedAt, to: finished)
        } catch {
            // Only the next launch's first reading depends on it; the run itself landed.
            logger.error("Could not save the last sync time: \(logDescription(of: error), privacy: .public)")
        }
    }

    /// Ends a stopped run before its next request. A stopped engine may be closing a store whose
    /// user has signed out, and the next request would carry the new user's token.
    private func checkStopped() throws {
        if stopped { throw RunStopped() }
    }

    private func push() async throws {
        let premium = try await store.plan(at: now()).kind != .free
        // Rows the server refused as Premium only during this push. Read past, so a device that judges Premium
        // before the server agrees neither resends them nor lets them starve the edits behind.
        var keptLocalThisPush: Set<String> = []
        while true {
            let batch = try await store.pendingChanges(limit: batchSize, premium: premium, skipping: keptLocalThisPush)
            if batch.isEmpty { return }
            try checkStopped()
            let results = try await api.push(batch.map(Change.init))
            // The outbox keeps the batch for the next push.
            try checkStopped()
            let (invalid, settled, keptLocal) = try await store.write { writer in
                try writer.applyPushResults(sent: batch, results: results)
            }
            keptLocalThisPush.formUnion(keptLocal)
            for change in invalid {
                logger.warning(
                    "Change rejected: \(change.table.rawValue, privacy: .public) \(change.id, privacy: .public) \(change.reason ?? "", privacy: .public)"
                )
            }
            // A batch that settles nothing and keeps nothing local would send the same entries forever.
            if (settled == 0 && keptLocal.isEmpty) || batch.count < batchSize { return }
        }
    }

    /// Tells the server about each notice dismissed here that the stored row does not carry yet.
    /// A failed post stays seen on this device and is sent again on the next run, unless the
    /// server refused the request itself, which a resend would only draw again. Only an auth
    /// failure fails this run, as it would the pull.
    private func postSeenNotices() async throws {
        let unposted = try await store.write { writer in try writer.unpostedNotices() }
        for notice in unposted.sorted(by: { $0.rawValue < $1.rawValue }) {
            try checkStopped()
            do {
                try await api.recordNotice(notice)
            } catch  where endsThePass(error) {
                throw error
            } catch {
                try checkStopped()
                if let refusal = underlying(error) as? APIStatusError, refusesTheRequestItself(refusal) {
                    try await store.write { writer in try writer.markNoticeRefused(notice) }
                }
                logger.warning(
                    "Notice post failed: \(notice.rawValue, privacy: .public) \(logDescription(of: error), privacy: .public)"
                )
            }
        }
    }

    private func pull() async throws {
        try await pullPages(from: .pullCursor, fetch: api.pull(since:)) { writer, page in
            try writer.applyPullPage(rows: page.rows.map { ($0.table, $0.row) }, nextSince: page.nextSince)
        }
    }

    private func pullEventPages() async throws {
        try await pullPages(from: .eventsCursor, fetch: api.events(since:)) { writer, page in
            try writer.applyEventsPage(rows: page.rows.map { ($0.table, $0.row) }, nextSince: page.nextSince)
        }
    }

    /// Fetches pages after the cursor stored under `cursor` until the server has no more,
    /// writing each page, which stores its own next cursor, before asking for the one after it.
    /// A page that arrives after a stop is dropped.
    private func pullPages<Page: CursorPage>(
        from cursor: MetaKey, fetch: (Int64) async throws -> Page,
        apply: @escaping @Sendable (StoreWriter, Page) throws -> Void
    ) async throws {
        var since = try await store.meta(cursor, as: Int64.self) ?? 0
        while true {
            try checkStopped()
            let page = try await fetch(since)
            try checkStopped()
            try await store.write { writer in try apply(writer, page) }
            since = page.nextSince
            if !page.hasMore { return }
        }
    }
}
