import CrosstuneBilling
import CrosstuneStore

/// The plan objects that belong to one open store. Another account's store gets new ones, so
/// its plan starts unknown and no notice claim carries over.
@MainActor
public struct StorePlan {
    public let plan: PlanModel?
    /// Which window shows the plan notices.
    public let noticeClaim: NoticeClaim?

    /// Makes the plan objects for `store`, nil without one, and points `player` at its plan,
    /// since the player outlives a store.
    ///
    /// First names the store's user to `purchases`, so a purchase made for this store lands on
    /// its account and never on the one signed in before.
    public static func bind(
        _ store: CrosstuneStore?, player: PlayerModel, purchases: (any PurchaseClient)?
    ) -> StorePlan {
        if let store, let purchases {
            // Runs on the main actor until its first suspension before bind returns, so the client
            // holds the new user ahead of any purchase call queued after this.
            let userID = store.userID
            Task.immediate { await purchases.identify(userID: userID) }
        }
        let plan = store.map { PlanModel(store: $0) }
        player.plan = plan
        return StorePlan(plan: plan, noticeClaim: store.map { _ in NoticeClaim() })
    }
}
