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
    public static func bind(_ store: CrosstuneStore?, player: PlayerModel) -> StorePlan {
        let plan = store.map { PlanModel(store: $0) }
        player.plan = plan
        return StorePlan(plan: plan, noticeClaim: store.map { _ in NoticeClaim() })
    }
}
