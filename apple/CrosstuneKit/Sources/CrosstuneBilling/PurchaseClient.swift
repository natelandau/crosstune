import CrosstuneAnalytics
import Foundation
import RevenueCat

/// A Premium package the store sells, with its price as the store shows it.
public struct PurchaseOffer: Equatable, Sendable {
    public let period: PurchasePeriod
    /// The store's localized price, never a figure of our own.
    public let price: String

    public init(period: PurchasePeriod, price: String) {
        self.period = period
        self.price = price
    }
}

/// How a purchase ended.
public enum PurchaseResult: Equatable, Sendable { case completed, cancelled, pending, otherAccount, failed }

/// How a restore of App Store purchases ended.
public enum RestoreResult: Equatable, Sendable { case restored, nothing, otherAccount, failed }

/// The App Store, as the app sees it. The synced `Entitlement` record is what gates Premium; a client
/// only starts purchases and reports how they ended.
@MainActor public protocol PurchaseClient: AnyObject {
    /// Configures on first call, then `logIn` when the ID differs. Never logs out. A blank ID
    /// leaves no user, so purchases, restores, and offers fail until a real one arrives.
    ///
    /// Records `userID` before its first suspension, so a call started on the main actor has
    /// already switched every later purchase to that user.
    func identify(userID: String) async
    /// Annual first. Throws when the store cannot answer.
    func offers() async throws -> [PurchaseOffer]
    func purchase(_ period: PurchasePeriod) async -> PurchaseResult
    /// `.restored` when the returned customer holds an active `premium`.
    func restore() async -> RestoreResult
    /// Apple's subscription management; on the Mac it opens the URL.
    func showManageSubscriptions() async
    /// The App Store storefront, three letters ("USA"), or nil.
    func storefrontCountryCode() async -> String?
}

/// Pure, so the mapping is tested without the SDK.
public func purchaseResult(for code: ErrorCode) -> PurchaseResult {
    switch code {
    case .purchaseCancelledError: .cancelled
    case .paymentPendingError: .pending
    case .receiptAlreadyInUseError: .otherAccount
    default: .failed
    }
}

/// Pure, so the mapping is tested without the SDK.
public func restoreResult(for code: ErrorCode) -> RestoreResult {
    switch code {
    case .receiptAlreadyInUseError: .otherAccount
    default: .failed
    }
}

/// The RevenueCat code an SDK error carries. The async API throws a bridged `NSError`, so the domain
/// is matched as well as the Swift type.
func errorCode(of error: any Error) -> ErrorCode? {
    if let code = error as? ErrorCode { return code }
    let error = error as NSError
    guard error.domain == ErrorCode.errorDomain else { return nil }
    return ErrorCode(rawValue: error.code)
}
