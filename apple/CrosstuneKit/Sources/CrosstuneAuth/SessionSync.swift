import CrosstuneStore
import CrosstuneSync

/// The sync controls leaving the account needs, so tests can check the order with a fake.
@MainActor
protocol LeavingSync: AnyObject {
    /// Runs a sync and returns when it is done.
    func sync() async
    /// Stops syncing and waits out any run in flight, so nothing touches the store while it is
    /// deleted.
    func stop() async
    /// Undoes ``stop()`` when leaving fails.
    func resume()
}

/// The sync engine for one open store, and the triggers that run it.
@MainActor
final class SessionSync: LeavingSync {
    let engine: SyncEngine
    private let triggers: SyncTriggers
    private var connectivity: ConnectivityEdge

    /// - Parameter isOffline: Whether the app is offline now. The launch sync covers the
    ///   current connection, so only a later return to online syncs again.
    init(store: CrosstuneStore, engine: SyncEngine, isActive: Bool?, isOffline: Bool) {
        self.engine = engine
        triggers = SyncTriggers(engine: engine, store: store, isActive: isActive)
        connectivity = ConnectivityEdge(wasOffline: isOffline)
        triggers.start()
    }

    func sync() async {
        await engine.sync()
    }

    /// A stopped engine ignores its triggers, so they keep watching and work again on resume.
    func stop() async {
        await engine.stopAndWait()
    }

    func resume() {
        engine.resume()
    }

    /// Stops the triggers and the engine for good. A run in flight ends at its next request;
    /// ``finished()`` waits for it.
    func shutDown() {
        triggers.stop()
        engine.stop()
    }

    /// Returns once no run is in flight.
    func finished() async {
        await engine.stopAndWait()
    }

    func setActive(_ active: Bool) {
        triggers.setActive(active)
    }

    /// Syncs when the app can reach the servers again: the network returned, or Clerk loaded
    /// after an offline launch.
    func connectivityChanged(isOffline: Bool) {
        if connectivity.update(isOffline: isOffline) { triggers.cameOnline() }
    }
}

/// Spots the moment the app can reach the servers again.
struct ConnectivityEdge: Equatable {
    var wasOffline: Bool

    /// Records the current state; true only when it goes from offline to online.
    mutating func update(isOffline: Bool) -> Bool {
        defer { wasOffline = isOffline }
        return wasOffline && !isOffline
    }
}
