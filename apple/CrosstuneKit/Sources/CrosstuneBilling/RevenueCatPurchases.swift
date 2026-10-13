import CrosstuneAnalytics
import Foundation
import RevenueCat
import StoreKit

#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

/// The App Store through RevenueCat, signed in as the Clerk user.
///
/// RevenueCat is configured only once a user is known and only with that user's ID. An anonymous ID
/// would hold purchases no account owns, so nothing here configures without one, logs out, or syncs.
@MainActor public final class RevenueCatPurchases: PurchaseClient {
    private static let premiumEntitlement = "premium"
    /// Apple's subscription settings, for wherever the system sheet is not to hand.
    nonisolated public static let appleSubscriptionsURL = URL(string: "https://apps.apple.com/account/subscriptions")!

    private let apiKey: String
    private let identity: any PurchasesIdentity
    private var userID: String?

    public convenience init(apiKey: String) {
        self.init(apiKey: apiKey, identity: RevenueCatIdentity())
    }

    init(apiKey: String, identity: any PurchasesIdentity) {
        self.apiKey = apiKey
        self.identity = identity
    }

    public func identify(userID: String) async {
        // RevenueCat trims IDs and treats a blank one as none, which would mean an anonymous ID.
        // A blank ID forgets the user, so nothing sells on the previous account.
        let userID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userID.isEmpty else {
            self.userID = nil
            return
        }
        self.userID = userID
        _ = await signedIn()
    }

    public func offers() async throws -> [PurchaseOffer] {
        guard await signedIn() else { throw StoreUnavailable() }
        let offering = try await Purchases.shared.offerings().current
        let offers = [(PurchasePeriod.annual, offering?.annual), (.monthly, offering?.monthly)].compactMap {
            period, package in
            package.map {
                PurchaseOffer(
                    period: period, price: $0.storeProduct.localizedPriceString, amount: $0.storeProduct.price)
            }
        }
        guard !offers.isEmpty else { throw StoreUnavailable() }
        return offers
    }

    public func purchase(_ period: PurchasePeriod) async -> PurchaseResult {
        guard let buyer = userID, await signedIn() else { return .failed }
        do {
            let offering = try await Purchases.shared.offerings().current
            guard let package = period == .annual ? offering?.annual : offering?.monthly else { return .failed }
            // A sign-in can switch accounts while the offerings load.
            guard userID == buyer, identity.appUserID == buyer else { return .failed }
            let result = try await Purchases.shared.purchase(package: package)
            return result.userCancelled ? .cancelled : .completed
        } catch {
            return errorCode(of: error).map(purchaseResult(for:)) ?? .failed
        }
    }

    public func restore() async -> RestoreResult {
        guard await signedIn() else { return .failed }
        do {
            let customer = try await Purchases.shared.restorePurchases()
            return customer.entitlements.active[Self.premiumEntitlement] == nil ? .nothing : .restored
        } catch {
            return errorCode(of: error).map(restoreResult(for:)) ?? .failed
        }
    }

    /// Always Apple's own subscription settings. RevenueCat's version follows the customer's management
    /// URL, which can lead to a web billing portal instead.
    public func showManageSubscriptions() async {
        #if canImport(UIKit) && !canImport(AppKit)
            let scene =
                UIApplication.shared.connectedScenes
                .first { $0.activationState == .foregroundActive } as? UIWindowScene
            if let scene, (try? await AppStore.showManageSubscriptions(in: scene)) != nil { return }
            _ = await UIApplication.shared.open(Self.appleSubscriptionsURL)
        #elseif canImport(AppKit)
            NSWorkspace.shared.open(Self.appleSubscriptionsURL)
        #endif
    }

    public func storefrontCountryCode() async -> String? {
        await StoreKit.Storefront.current?.countryCode
    }

    /// Whether RevenueCat is configured as the identified user. Configures on the first call, and logs
    /// in again when a sign-in switched accounts or an earlier `logIn` failed, so a purchase never
    /// lands on the previous account.
    private func signedIn() async -> Bool {
        guard let userID else { return false }
        guard identity.isConfigured else {
            identity.configure(apiKey: apiKey, appUserID: userID)
            return true
        }
        if identity.appUserID == userID { return true }
        await identity.logIn(userID)
        return self.userID == userID && identity.appUserID == userID
    }
}

/// The parts of RevenueCat that decide which account a purchase lands on.
@MainActor protocol PurchasesIdentity {
    var isConfigured: Bool { get }
    /// Nil until configured.
    var appUserID: String? { get }
    func configure(apiKey: String, appUserID: String)
    /// Leaves the current user in place when it fails.
    func logIn(_ appUserID: String) async
}

private struct RevenueCatIdentity: PurchasesIdentity {
    var isConfigured: Bool { Purchases.isConfigured }

    var appUserID: String? { Purchases.isConfigured ? Purchases.shared.appUserID : nil }

    func configure(apiKey: String, appUserID: String) {
        Purchases.logLevel = .warn
        Purchases.configure(withAPIKey: apiKey, appUserID: appUserID)
    }

    func logIn(_ appUserID: String) async {
        _ = try? await Purchases.shared.logIn(appUserID)
    }
}

private struct StoreUnavailable: Error {}
