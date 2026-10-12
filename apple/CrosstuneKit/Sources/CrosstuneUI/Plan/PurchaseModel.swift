import CrosstuneAnalytics
import CrosstuneBilling
import Observation

/// Buys and restores Premium through the App Store. The synced entitlement stays the only gate:
/// a purchase here asks the server to look again, and the plan follows once it has.
@MainActor
@Observable
public final class PurchaseModel {
    public enum Offers: Equatable {
        case loading
        case ready([PurchaseOffer])
        case unavailable
    }

    /// The outcome the sheet or plan group shows beneath the buttons.
    public enum Line: Equatable {
        case subscribed, pending, failed, restored, nothingToRestore, otherAccount, restoreFailed
    }

    /// The store's answer, which reads as unavailable while the device is offline: RevenueCat
    /// answers from its cache then, and a purchase would only fail.
    public var offers: Offers { offline() ? .unavailable : loaded }
    public var isOffline: Bool { offline() }
    public var period: PurchasePeriod = .annual
    /// Whether a purchase or restore is under way on this model's client, from any model.
    public var isWorking: Bool { work.isWorking }
    public private(set) var line: Line?
    /// The kind of attempt `line` answers, so a view shows only the outcomes of its own button.
    public private(set) var lineFrom: Attempt?

    public enum Attempt: Equatable { case purchase, restore }

    private var loaded: Offers = .loading
    private let client: any PurchaseClient
    private let work: PurchaseWork
    private let offline: @MainActor () -> Bool
    private let refresh: () async throws -> Void
    private let sync: () -> Void
    private let analytics: AnalyticsClient

    public init(
        client: any PurchaseClient, refresh: @escaping () async throws -> Void, sync: @escaping () -> Void,
        isOffline: @escaping @MainActor () -> Bool = { false }, analytics: AnalyticsClient
    ) {
        self.client = client
        self.work = PurchaseWork.shared(for: client)
        self.offline = isOffline
        self.refresh = refresh
        self.sync = sync
        self.analytics = analytics
    }

    /// Asks the store, unless the device is offline. Call again once it is back online.
    public func loadOffers() async {
        guard !offline() else { return }
        // A retry after a failure must not keep showing the failure while it waits.
        if loaded == .unavailable { loaded = .loading }
        do {
            loaded = .ready(try await client.offers())
        } catch {
            loaded = .unavailable
        }
    }

    /// Forgets the last outcome, so a sheet opened later starts without it.
    public func clearLine() {
        line = nil
        lineFrom = nil
    }

    public func buy(from entry: PremiumEntry) async {
        guard begin() else { return }
        defer { end() }
        line = nil
        lineFrom = .purchase
        let period = period
        analytics.send(.purchaseStarted(period: period, from: entry))
        switch await client.purchase(period) {
        case .completed:
            analytics.send(.purchaseCompleted(period: period))
            await grant()
            line = .subscribed
        case .cancelled:
            analytics.send(.purchaseFailed(period: period, reason: .cancelled))
        case .pending:
            analytics.send(.purchaseFailed(period: period, reason: .pending))
            line = .pending
        case .otherAccount:
            analytics.send(.purchaseFailed(period: period, reason: .error))
            line = .otherAccount
        case .failed:
            analytics.send(.purchaseFailed(period: period, reason: .error))
            line = .failed
        }
    }

    public func restore() async {
        guard begin() else { return }
        defer { end() }
        line = nil
        lineFrom = .restore
        switch await client.restore() {
        case .restored:
            analytics.send(.purchaseRestored(outcome: .restored))
            await grant()
            line = .restored
        case .nothing:
            analytics.send(.purchaseRestored(outcome: .nothing))
            line = .nothingToRestore
        case .otherAccount:
            analytics.send(.purchaseRestored(outcome: .otherAccount))
            line = .otherAccount
        case .failed:
            analytics.send(.purchaseRestored(outcome: .error))
            line = .restoreFailed
        }
    }

    /// Takes the client's one action, or false when any model's action holds it.
    private func begin() -> Bool {
        guard !work.isWorking else { return false }
        work.isWorking = true
        return true
    }

    private func end() {
        work.isWorking = false
    }

    /// Asks the server to look again, then requests a sync. A failed refresh is not the buyer's
    /// to fix: the store's webhook grants Premium either way and the next sync brings it.
    private func grant() async {
        try? await refresh()
        sync()
    }
}

/// Whether a purchase or restore is under way on one client. Every model over the client shares
/// it, so an action started in one window holds Subscribe and Restore in every other: the store
/// shows one purchase at a time, and a restore during a purchase could report on either.
@MainActor
@Observable
final class PurchaseWork {
    fileprivate(set) var isWorking = false

    private struct Entry {
        weak var work: PurchaseWork?
    }

    /// Keyed by the client's identity. A live entry's models hold the client, so its identity is
    /// never reused while the entry stands.
    private static var all: [ObjectIdentifier: Entry] = [:]

    private init() {}

    static func shared(for client: any PurchaseClient) -> PurchaseWork {
        let id = ObjectIdentifier(client)
        if let work = all[id]?.work { return work }
        all = all.filter { $0.value.work != nil }
        let work = PurchaseWork()
        all[id] = Entry(work: work)
        return work
    }
}
