import CrosstuneAnalytics
import CrosstuneDiagnostics
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
    private let diagnostics: DiagnosticsClient
    private var userID: String?
    /// Purchases and restores in flight, each holding the logged-in account until it ends.
    private var accountHolds = 0
    private var holdWaiters: [CheckedContinuation<Void, Never>] = []

    public convenience init(apiKey: String, diagnostics: DiagnosticsClient = .noop) {
        self.init(apiKey: apiKey, identity: RevenueCatIdentity(), diagnostics: diagnostics)
    }

    init(apiKey: String, identity: any PurchasesIdentity, diagnostics: DiagnosticsClient = .noop) {
        self.apiKey = apiKey
        self.identity = identity
        self.diagnostics = diagnostics
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
        holdAccount()
        defer { releaseAccount() }
        do {
            guard let package = try await identity.package(for: period) else { return .failed }
            // A sign-in can switch accounts while the offerings load.
            guard userID == buyer, identity.appUserID == buyer else { return .failed }
            return try await identity.purchase(package) ? .completed : .cancelled
        } catch {
            return failedPurchase(error, diagnostics: diagnostics)
        }
    }

    public func restore() async -> RestoreResult {
        guard await signedIn() else { return .failed }
        holdAccount()
        defer { releaseAccount() }
        do {
            let active = try await identity.restorePurchases()
            return active.contains(Self.premiumEntitlement) ? .restored : .nothing
        } catch {
            return failedRestore(error, diagnostics: diagnostics)
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
        // A purchase or restore lands on whoever is logged in when it reaches RevenueCat, so
        // another account waits for every one in flight to finish.
        while identity.appUserID != userID, accountHolds > 0 {
            await withCheckedContinuation { holdWaiters.append($0) }
        }
        guard self.userID == userID else { return false }
        if identity.appUserID == userID { return true }
        await identity.logIn(userID)
        return self.userID == userID && identity.appUserID == userID
    }

    private func holdAccount() {
        accountHolds += 1
    }

    private func releaseAccount() {
        accountHolds -= 1
        guard accountHolds == 0 else { return }
        let waiters = holdWaiters
        holdWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }
}

/// The parts of RevenueCat that decide which account a purchase or restore lands on.
@MainActor protocol PurchasesIdentity {
    var isConfigured: Bool { get }
    /// Nil until configured.
    var appUserID: String? { get }
    func configure(apiKey: String, appUserID: String)
    /// Leaves the current user in place when it fails.
    func logIn(_ appUserID: String) async
    /// Attaches the device's purchases to the current user, returning the IDs of the entitlements
    /// active afterward.
    func restorePurchases() async throws -> Set<String>
    /// The current offering's package for `period`, or nil when it has none.
    func package(for period: PurchasePeriod) async throws -> (any StorePackage)?
    /// Buys `package` as the current user, returning false when the buyer cancels.
    func purchase(_ package: any StorePackage) async throws -> Bool
}

/// A package from `PurchasesIdentity.package(for:)`, bought with `PurchasesIdentity.purchase(_:)`.
protocol StorePackage: Sendable {}

extension Package: StorePackage {}

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

    func restorePurchases() async throws -> Set<String> {
        Set(try await Purchases.shared.restorePurchases().entitlements.active.keys)
    }

    func package(for period: PurchasePeriod) async throws -> (any StorePackage)? {
        let offering = try await Purchases.shared.offerings().current
        return period == .annual ? offering?.annual : offering?.monthly
    }

    func purchase(_ package: any StorePackage) async throws -> Bool {
        guard let package = package as? Package else { throw StoreUnavailable() }
        return try await !Purchases.shared.purchase(package: package).userCancelled
    }
}

private struct StoreUnavailable: Error {}
