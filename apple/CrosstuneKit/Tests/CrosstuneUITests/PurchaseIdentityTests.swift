import CrosstuneTestSupport
import Testing

@testable import CrosstuneUI

/// A purchase lands on whichever account RevenueCat holds, so each store names its user before
/// anything for that store can buy.
@MainActor
@Suite struct PurchaseIdentityTests {
    @Test func eachStoreIdentifiesItsUserBeforeBindReturns() throws {
        let root = TemporaryRoot()
        let player = PlayerModel()
        let purchases = FakePurchaseClient()

        _ = StorePlan.bind(try root.open("user_a"), player: player, purchases: purchases)
        #expect(purchases.identified == ["user_a"])

        _ = StorePlan.bind(try root.open("user_b"), player: player, purchases: purchases)
        #expect(purchases.identified == ["user_a", "user_b"])
    }

    @Test func noStoreIdentifiesNoOne() {
        let purchases = FakePurchaseClient()

        _ = StorePlan.bind(nil, player: PlayerModel(), purchases: purchases)

        #expect(purchases.identified.isEmpty)
    }
}
