import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private struct RefreshFailed: Error {}

@MainActor
@Suite struct PurchaseModelTests {
    private let client = FakePurchaseClient()
    private let sink = RecordingAnalyticsSink()
    private let calls = Calls()

    @MainActor final class Network {
        var isOffline = false
    }

    @MainActor final class Calls {
        var order: [String] = []
        var refreshError: (any Error)?
    }

    private func model() -> PurchaseModel {
        let calls = calls
        return PurchaseModel(
            client: client,
            refresh: {
                calls.order.append("refresh")
                if let error = calls.refreshError { throw error }
            },
            sync: { calls.order.append("sync") },
            analytics: sink.client)
    }

    private func event(_ name: String, _ properties: [String: String]) -> RecordingAnalyticsSink.Capture {
        .init(name: name, properties: properties.mapValues { .string($0) })
    }

    @Test func startsOnTheAnnualPeriodWithOffersLoading() {
        let model = model()
        #expect(model.period == .annual)
        #expect(model.offers == .loading)
        #expect(model.isWorking == false)
        #expect(model.line == nil)
    }

    @Test func loadsTheOffers() async {
        let model = model()
        await model.loadOffers()
        #expect(
            model.offers
                == .ready([
                    PurchaseOffer(period: .annual, price: "A$1", amount: 49.99),
                    PurchaseOffer(period: .monthly, price: "M$1", amount: 4.99),
                ])
        )
    }

    @Test func offersThatThrowAreUnavailable() async {
        client.offersResult = .failure(RefreshFailed())
        let model = model()
        await model.loadOffers()
        #expect(model.offers == .unavailable)
    }

    @Test func offersTheStoreAnswersOfflineAreUnavailable() async {
        let network = Network()
        network.isOffline = true
        let model = PurchaseModel(
            client: client, refresh: {}, sync: {}, isOffline: { network.isOffline }, analytics: sink.client)
        await model.loadOffers()
        #expect(model.offers == .unavailable)
    }

    @Test func loadedOffersAreUnavailableOnceOffline() async {
        let network = Network()
        let model = PurchaseModel(
            client: client, refresh: {}, sync: {}, isOffline: { network.isOffline }, analytics: sink.client)
        await model.loadOffers()
        network.isOffline = true
        #expect(model.isOffline)
        #expect(model.offers == .unavailable)
    }

    @Test func goingOnlineAgainLoadsTheOffers() async {
        let network = Network()
        network.isOffline = true
        let model = PurchaseModel(
            client: client, refresh: {}, sync: {}, isOffline: { network.isOffline }, analytics: sink.client)
        await model.loadOffers()
        #expect(model.offers == .unavailable)

        network.isOffline = false
        #expect(model.offers == .loading)
        await model.loadOffers()
        #expect(
            model.offers
                == .ready([
                    PurchaseOffer(period: .annual, price: "A$1", amount: 49.99),
                    PurchaseOffer(period: .monthly, price: "M$1", amount: 4.99),
                ])
        )
    }

    @Test func aCompletedPurchaseRefreshesThenSyncs() async {
        let model = model()
        await model.buy(from: .planGroup)
        #expect(client.purchased == [.annual])
        #expect(calls.order == ["refresh", "sync"])
        #expect(model.line == .subscribed)
        #expect(model.isWorking == false)
        #expect(
            sink.captures == [
                event("purchase_started", ["period": "annual", "from": "plan_group"]),
                event("purchase_completed", ["period": "annual"]),
            ])
    }

    @Test func buysTheChosenPeriod() async {
        let model = model()
        model.period = .monthly
        await model.buy(from: .record)
        #expect(client.purchased == [.monthly])
        #expect(sink.captures.first == event("purchase_started", ["period": "monthly", "from": "record"]))
    }

    @Test func aCompletedPurchaseIsKeptWhenTheRefreshFails() async {
        calls.refreshError = RefreshFailed()
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.line == .subscribed)
        #expect(calls.order == ["refresh", "sync"])
        #expect(sink.captures.last == event("purchase_completed", ["period": "annual"]))
    }

    @Test func aCancelledPurchaseSaysNothing() async {
        client.purchaseResult = .cancelled
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.line == nil)
        #expect(calls.order.isEmpty)
        #expect(sink.captures.last == event("purchase_failed", ["period": "annual", "reason": "cancelled"]))
    }

    @Test func aPendingPurchaseWaits() async {
        client.purchaseResult = .pending
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.line == .pending)
        #expect(calls.order.isEmpty)
        #expect(sink.captures.last == event("purchase_failed", ["period": "annual", "reason": "pending"]))
    }

    @Test func aPurchaseOfAnotherAccountIsAnError() async {
        client.purchaseResult = .otherAccount
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.line == .otherAccount)
        #expect(calls.order.isEmpty)
        #expect(sink.captures.last == event("purchase_failed", ["period": "annual", "reason": "error"]))
    }

    @Test func aFailedPurchaseFails() async {
        client.purchaseResult = .failed
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.line == .failed)
        #expect(calls.order.isEmpty)
        #expect(sink.captures.last == event("purchase_failed", ["period": "annual", "reason": "error"]))
    }

    @Test func aNewActionClearsTheLine() async {
        client.purchaseResult = .failed
        let model = model()
        await model.buy(from: .planGroup)
        client.purchaseResult = .cancelled
        await model.buy(from: .planGroup)
        #expect(model.line == nil)
    }

    @Test func askingAgainAfterUnavailableLoadsAfresh() async {
        let held = HeldOffersClient()
        let model = PurchaseModel(client: held, refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()
        #expect(model.offers == .unavailable)

        held.hold()
        let retry = Task { await model.loadOffers() }
        await held.asked(times: 2)
        #expect(model.offers == .loading)
        held.finish()
        await retry.value
        #expect(model.offers == .ready([PurchaseOffer(period: .annual, price: "A$1", amount: 49.99)]))
    }

    @Test func clearingTheLineForgetsTheLastOutcome() async {
        client.purchaseResult = .failed
        let model = model()
        await model.buy(from: .planGroup)
        #expect(model.lineFrom == .purchase)
        model.clearLine()
        #expect(model.line == nil)
        #expect(model.lineFrom == nil)
    }

    @Test func aRestoredPurchaseRefreshesThenSyncs() async {
        let model = model()
        await model.restore()
        #expect(client.restores == 1)
        #expect(calls.order == ["refresh", "sync"])
        #expect(model.line == .restored)
        #expect(sink.captures == [event("purchase_restored", ["outcome": "restored"])])
    }

    @Test func aRestoreThatFindsNothingDoesNotRefresh() async {
        client.restoreResult = .nothing
        let model = model()
        await model.restore()
        #expect(model.line == .nothingToRestore)
        #expect(calls.order.isEmpty)
        #expect(sink.captures == [event("purchase_restored", ["outcome": "nothing"])])
    }

    @Test func aRestoreOfAnotherAccountDoesNotRefresh() async {
        client.restoreResult = .otherAccount
        let model = model()
        await model.restore()
        #expect(model.line == .otherAccount)
        #expect(calls.order.isEmpty)
        #expect(sink.captures == [event("purchase_restored", ["outcome": "other_account"])])
    }

    @Test func aFailedRestoreDoesNotRefresh() async {
        client.restoreResult = .failed
        let model = model()
        await model.restore()
        #expect(model.line == .restoreFailed)
        #expect(calls.order.isEmpty)
        #expect(sink.captures == [event("purchase_restored", ["outcome": "error"])])
    }

    @Test func aRestoreIsKeptWhenTheRefreshFails() async {
        calls.refreshError = RefreshFailed()
        let model = model()
        await model.restore()
        #expect(model.line == .restored)
        #expect(calls.order == ["refresh", "sync"])
    }

    @Test func anActionWhileWorkingDoesNothing() async {
        let held = HeldClient()
        let model = PurchaseModel(client: held, refresh: {}, sync: {}, analytics: sink.client)
        let first = Task { await model.buy(from: .planGroup) }
        await held.started()
        #expect(model.isWorking)
        await model.buy(from: .planGroup)
        await model.restore()
        held.finish()
        await first.value
        #expect(held.purchases == 1)
        #expect(held.restores == 0)
        #expect(model.isWorking == false)
    }

    @Test func aSecondModelOverTheClientSeesTheWorkInFlight() async {
        let held = HeldClient()
        let shell = PurchaseModel(client: held, refresh: {}, sync: {}, analytics: sink.client)
        let settings = PurchaseModel(client: held, refresh: {}, sync: {}, analytics: sink.client)
        let other = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        let first = Task { await shell.buy(from: .planGroup) }
        await held.started()
        #expect(settings.isWorking)
        #expect(other.isWorking == false)
        await settings.buy(from: .planGroup)
        await settings.restore()
        held.finish()
        await first.value
        #expect(held.purchases == 1)
        #expect(held.restores == 0)
        #expect(settings.isWorking == false)
        #expect(settings.line == nil)
        #expect(shell.line == .subscribed)
    }

}

/// A store whose purchase waits until a test lets it end.
@MainActor private final class HeldClient: PurchaseClient {
    private(set) var purchases = 0
    private(set) var restores = 0
    private var release: CheckedContinuation<Void, Never>?
    private var released = false
    private var began: CheckedContinuation<Void, Never>?

    func started() async {
        if purchases > 0 { return }
        await withCheckedContinuation { began = $0 }
    }

    func finish() {
        released = true
        release?.resume()
    }

    func identify(userID: String) async {}
    func offers() async throws -> [PurchaseOffer] { [] }
    func purchase(_ period: PurchasePeriod) async -> PurchaseResult {
        purchases += 1
        began?.resume()
        if !released { await withCheckedContinuation { release = $0 } }
        return .completed
    }
    func restore() async -> RestoreResult {
        restores += 1
        return .restored
    }
    func showManageSubscriptions() async {}
    func storefrontCountryCode() async -> String? { nil }
}

/// A store whose first answer fails and whose later answers wait until a test lets them end.
@MainActor private final class HeldOffersClient: PurchaseClient {
    private struct Offline: Error {}

    private var asks = 0
    private var holding = false
    private var waiting: (count: Int, continuation: CheckedContinuation<Void, Never>)?
    private var release: CheckedContinuation<Void, Never>?

    func hold() { holding = true }

    /// Returns once `offers()` has been called `count` times.
    func asked(times count: Int) async {
        if asks >= count { return }
        await withCheckedContinuation { waiting = (count, $0) }
    }

    func finish() {
        holding = false
        release?.resume()
        release = nil
    }

    func identify(userID: String) async {}
    func offers() async throws -> [PurchaseOffer] {
        asks += 1
        if let waiting, asks >= waiting.count {
            self.waiting = nil
            waiting.continuation.resume()
        }
        if asks == 1 { throw Offline() }
        if holding { await withCheckedContinuation { release = $0 } }
        return [PurchaseOffer(period: .annual, price: "A$1", amount: 49.99)]
    }
    func purchase(_ period: PurchasePeriod) async -> PurchaseResult { .cancelled }
    func restore() async -> RestoreResult { .nothing }
    func showManageSubscriptions() async {}
    func storefrontCountryCode() async -> String? { nil }
}
