import CrosstuneAnalytics
import CrosstuneBilling

/// A store that answers with whatever a test sets and keeps every call, for a test to read back.
@MainActor public final class FakePurchaseClient: PurchaseClient {
    public var offersResult: Result<[PurchaseOffer], any Error> = .success([
        PurchaseOffer(period: .annual, price: "A$1", amount: 49.99),
        PurchaseOffer(period: .monthly, price: "M$1", amount: 4.99),
    ])
    public var purchaseResult: PurchaseResult = .completed
    public var restoreResult: RestoreResult = .restored
    public var storefront: String? = "USA"

    public private(set) var identified: [String] = []
    public private(set) var purchased: [PurchasePeriod] = []
    public private(set) var restores = 0
    public private(set) var manageShown = 0

    public init() {}

    public func identify(userID: String) async {
        identified.append(userID)
    }

    public func offers() async throws -> [PurchaseOffer] {
        try offersResult.get()
    }

    public func purchase(_ period: PurchasePeriod) async -> PurchaseResult {
        purchased.append(period)
        return purchaseResult
    }

    public func restore() async -> RestoreResult {
        restores += 1
        return restoreResult
    }

    public func showManageSubscriptions() async {
        manageShown += 1
    }

    public func storefrontCountryCode() async -> String? {
        storefront
    }
}
