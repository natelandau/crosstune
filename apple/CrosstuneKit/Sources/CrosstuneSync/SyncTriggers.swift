import CrosstuneStore
import GRDB
import os

/// Decides when the app syncs: at launch, on returning to the foreground, on coming back
/// online, shortly after local edits, and on a poll while a recording waits on the server.
///
/// The app reports the device events (``setActive(_:)`` and ``cameOnline()``); the store's
/// outbox and recordings are watched here.
@MainActor
public final class SyncTriggers {
    /// Long enough to fold a burst of edits into one push, short enough to feel immediate.
    public static let writeDebounce: Duration = .seconds(3)
    /// A recording usually clears processing well within this window, so the result shows soon
    /// after it lands without hammering the server while it waits.
    public static let processingPoll: Duration = .seconds(15)

    /// Recording states the server is still working on.
    static let processingStates = ["uploaded", "processing"]

    private let store: CrosstuneStore
    private let sync: @MainActor () -> Void
    private let sleep: Sleeper
    private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "sync-triggers")

    /// Nil until the app first reports its scene phase.
    private var isActive: Bool?
    /// The outbox count and whether a recording is processing, nil until the store first answers.
    private(set) var outboxCount: Int?
    private(set) var processing: Bool?
    private var started = false
    private var watches: [Task<Void, Never>] = []
    private var debounce: Task<Void, Never>?
    private var poll: Task<Void, Never>?

    var isDebouncing: Bool { debounce != nil }
    var isPolling: Bool { poll != nil }

    /// - Parameter isActive: Whether the app is in the foreground now, or nil when it has not
    ///   said yet.
    public convenience init(engine: SyncEngine, store: CrosstuneStore, isActive: Bool?) {
        self.init(store: store, isActive: isActive) { [weak engine] in
            Task { await engine?.sync() }
        }
    }

    /// - Parameters:
    ///   - sleep: Waits out the debounce and the poll interval.
    ///   - sync: Starts a sync without waiting for it.
    init(
        store: CrosstuneStore,
        isActive: Bool?,
        sleep: @escaping Sleeper = { try await Task.sleep(for: $0) },
        sync: @escaping @MainActor () -> Void
    ) {
        self.store = store
        self.isActive = isActive
        self.sleep = sleep
        self.sync = sync
    }

    isolated deinit {
        stop()
    }

    /// Syncs once for the launch, then starts watching the store.
    public func start() {
        guard !started else { return }
        started = true
        watch(OutboxEntry.all()) { [weak self] count in self?.outboxChanged(count) }
        let processing = Recording.filter(
            Recording.CodingKeys.deletedAt == nil && Self.processingStates.contains(Recording.CodingKeys.state))
        watch(processing) { [weak self] count in self?.processingChanged(count > 0) }
        sync()
    }

    /// Stops watching and cancels any pending debounce or poll until the next ``start()``.
    public func stop() {
        started = false
        for watch in watches { watch.cancel() }
        watches = []
        debounce?.cancel()
        debounce = nil
        updatePolling()
    }

    /// Reports whether the app is in the foreground. Returning to it syncs; the poll runs only
    /// while it is there. The first report only records the phase, since the launch sync
    /// already covers it.
    public func setActive(_ active: Bool) {
        let returned = active && isActive == false
        isActive = active
        guard started else { return }
        if returned { sync() }
        updatePolling()
    }

    /// Reports that the app can reach the servers again: the network returned, or Clerk loaded
    /// after an offline launch. Runs that failed meanwhile sit in backoff, which could hold the
    /// next sync for up to a minute.
    public func cameOnline() {
        guard started else { return }
        sync()
    }

    private func watch(_ request: QueryInterfaceRequest<some TableRecord>, onChange: @escaping (Int) -> Void) {
        let counts = ValueObservation.tracking { db in try request.fetchCount(db) }.values(in: store.database)
        let logger = logger
        watches.append(
            Task {
                do {
                    for try await count in counts {
                        onChange(count)
                    }
                } catch {
                    logger.error("Sync trigger watch failed: \(String(describing: error), privacy: .public)")
                }
            })
    }

    private func outboxChanged(_ count: Int) {
        outboxCount = count
        guard started, count > 0 else { return }
        debounce?.cancel()
        let sleep = sleep
        debounce = Task { [weak self] in
            do {
                try await sleep(Self.writeDebounce)
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            debounce = nil
            sync()
        }
    }

    // A recording in processing gets no pull of its own; only a poll notices it finished.
    private func processingChanged(_ processing: Bool) {
        self.processing = processing
        updatePolling()
    }

    private func updatePolling() {
        let shouldPoll = started && processing == true && isActive == true
        if shouldPoll, poll == nil {
            let sleep = sleep
            poll = Task { [weak self] in
                while true {
                    do {
                        try await sleep(Self.processingPoll)
                    } catch {
                        return
                    }
                    guard let self, !Task.isCancelled else { return }
                    sync()
                }
            }
        } else if !shouldPoll {
            poll?.cancel()
            poll = nil
        }
    }
}
