import CrosstuneAnalytics
import CrosstuneDiagnostics
import Foundation
import RevenueCat

/// A Premium package the store sells, with its price as the store shows it.
public struct PurchaseOffer: Equatable, Sendable {
    public let period: PurchasePeriod
    /// The store's localized price, never a figure of our own.
    public let price: String
    /// The store's price as a number, for comparing offers, never for display.
    public let amount: Decimal

    public init(period: PurchasePeriod, price: String, amount: Decimal) {
        self.period = period
        self.price = price
        self.amount = amount
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

/// Whether `code` means the store could not be reached, which is the connection, not a defect.
func isOffline(_ code: ErrorCode?) -> Bool {
    code == .networkError || code == .offlineConnectionError
}

/// The result for a purchase that threw, reported unless the buyer cancelled or left it pending,
/// the receipt belongs to another account, or the store could not be reached.
func failedPurchase(_ error: any Error, diagnostics: DiagnosticsClient) -> PurchaseResult {
    let code = errorCode(of: error)
    let result = code.map(purchaseResult(for:)) ?? .failed
    if result == .failed, !isOffline(code) { diagnostics.report(error, area: .purchase) }
    return result
}

/// The result for a restore that threw, reported unless the buyer cancelled or left it pending,
/// the receipt belongs to another account, or the store could not be reached.
func failedRestore(_ error: any Error, diagnostics: DiagnosticsClient) -> RestoreResult {
    let code = errorCode(of: error)
    let result = code.map(restoreResult(for:)) ?? .failed
    // A cancelled or pending code is the buyer's choice, as it is for a purchase.
    let buyersChoice = code.map { purchaseResult(for: $0) != .failed } ?? false
    if result == .failed, !buyersChoice, !isOffline(code) { diagnostics.report(error, area: .restore) }
    return result
}
