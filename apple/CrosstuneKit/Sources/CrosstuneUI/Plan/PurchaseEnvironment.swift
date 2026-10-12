import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneBilling
import CrosstuneSync
import Foundation
import SwiftUI

extension EnvironmentValues {
    /// The App Store. The app sets it at the root of each scene when the build has a RevenueCat
    /// key; nil offers no purchase.
    @Entry public var purchases: (any PurchaseClient)?
    /// The Stripe customer portal's sign-in page, for a subscription bought on the web. Nil in a
    /// build that has none.
    @Entry public var stripePortalURL: URL?
    /// Buys and restores for the open store's plan. Supplied by the shell, and on the Mac by the
    /// Settings window; nil in a build that offers no purchase.
    @Entry var purchase: PurchaseModel?
}

extension PurchaseModel {
    /// A model over `client` whose purchases reach the plan through `engine`: the server is asked
    /// to look again, then a sync brings the entitlement here. It sells only while `session` is
    /// online, or always without one.
    static func syncing(
        client: any PurchaseClient, engine: SyncEngine?, session: AccountSession?, analytics: AnalyticsClient
    ) -> PurchaseModel {
        PurchaseModel(
            client: client,
            refresh: { try await engine?.refreshBilling() },
            sync: { if let engine { Task { await engine.sync() } } },
            isOffline: { [weak session] in session?.isOffline ?? false },
            analytics: analytics)
    }
}

extension PremiumPresenter {
    /// The presenter and purchase model for `plan`, both nil without one; the model is also nil in
    /// a build that offers no purchase.
    static func forPlan(
        _ plan: PlanModel?, purchases: (any PurchaseClient)?, engine: SyncEngine?, session: AccountSession?,
        analytics: AnalyticsClient
    ) -> (PremiumPresenter?, PurchaseModel?) {
        guard let plan else { return (nil, nil) }
        let model = purchases.map {
            PurchaseModel.syncing(client: $0, engine: engine, session: session, analytics: analytics)
        }
        return (PremiumPresenter(plan: plan, analytics: analytics, purchase: model), model)
    }
}

/// The Premium sheet and the purchase model for a window outside the shell, so its Plan group
/// can subscribe and restore. Made again for each plan, as the shell's are.
struct PlanPurchases: ViewModifier {
    @Environment(\.plan) private var plan
    @Environment(\.purchases) private var purchases
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(\.analytics) private var analytics
    @State private var premium: PremiumPresenter?
    @State private var purchase: PurchaseModel?

    func body(content: Content) -> some View {
        content
            // The Plan group is already on screen, so See your plan only closes the sheet.
            .modifier(PremiumSheets(presenter: premium, purchase: purchase, onSeePlan: { premium?.presented = nil }))
            .environment(\.premium, premium)
            .environment(\.purchase, purchase)
            .onChange(of: plan.map(ObjectIdentifier.init), initial: true) {
                (premium, purchase) = PremiumPresenter.forPlan(
                    plan, purchases: purchases, engine: engine, session: session, analytics: analytics)
            }
    }
}
