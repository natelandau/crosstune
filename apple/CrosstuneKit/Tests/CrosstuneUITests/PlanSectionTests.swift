import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private let portal = URL(string: "https://billing.example.com/portal")!

@MainActor
@Suite struct PlanSectionTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private let free = Plan(kind: .free)
    private let trial = Plan(kind: .premium, source: .trial)
    private let apple = Plan(kind: .premium, source: .apple)
    private let stripe = Plan(kind: .premium, source: .stripe)
    private let comp = Plan(kind: .premium, source: .comp)

    /// The rows for a web subscriber on the fake store's storefront.
    private func stripeActions(storefront: String?, portalURL: URL?) async -> [PlanSection.Action] {
        let client = FakePurchaseClient()
        client.storefront = storefront
        let read = await PlanSection.storefront(for: stripe, client: client)
        return PlanSection.actions(stripe, sells: true, storefront: .read(read), portalURL: portalURL)
    }

    @Test func aBuildWithoutPurchasesAddsNoRows() {
        for plan in [free, trial, apple, stripe, comp] {
            #expect(PlanSection.actions(plan, sells: false, storefront: .read("USA"), portalURL: portal) == [])
        }
    }

    @Test func aFreeOrTrialAccountCanSubscribeAndRestore() {
        #expect(
            PlanSection.actions(free, sells: true, storefront: .read(nil), portalURL: nil) == [.subscribe, .restore])
        #expect(
            PlanSection.actions(trial, sells: true, storefront: .read(nil), portalURL: nil) == [.subscribe, .restore])
    }

    @Test func anAppStoreSubscriberManagesInAppStoreSettings() {
        #expect(
            PlanSection.actions(apple, sells: true, storefront: .read("USA"), portalURL: portal) == [
                .manageAppStore, .restore,
            ])
    }

    @Test func aWebSubscriberInTheUSGetsTheLink() async {
        #expect(await stripeActions(storefront: "USA", portalURL: portal) == [.manageOnTheWeb(portal), .restore])
    }

    @Test func aWebSubscriberOutsideTheUSGetsNoLink() async {
        #expect(await stripeActions(storefront: "GBR", portalURL: portal) == [.manageAtWebsite, .restore])
    }

    @Test func aWebSubscriberGetsNoLinkWithoutAPortalOrAStorefront() async {
        #expect(await stripeActions(storefront: "USA", portalURL: nil) == [.manageAtWebsite, .restore])
        #expect(await stripeActions(storefront: nil, portalURL: portal) == [.manageAtWebsite, .restore])
    }

    @Test func aWebSubscriberGetsNoManageRowUntilTheStorefrontIsRead() {
        #expect(PlanSection.actions(stripe, sells: true, storefront: .unread, portalURL: portal) == [.restore])
        #expect(
            PlanSection.actions(free, sells: true, storefront: .unread, portalURL: portal) == [.subscribe, .restore])
        #expect(
            PlanSection.actions(apple, sells: true, storefront: .unread, portalURL: portal) == [
                .manageAppStore, .restore,
            ])
    }

    @Test func onlyAWebSubscriberReadsTheStorefront() async {
        let client = FakePurchaseClient()
        #expect(await PlanSection.storefront(for: stripe, client: client) == "USA")
        for plan in [free, trial, apple, comp] {
            #expect(await PlanSection.storefront(for: plan, client: client) == nil)
        }
        #expect(await PlanSection.storefront(for: stripe, client: nil) == nil)
    }

    @Test func aCompAccountOnlyRestores() {
        #expect(PlanSection.actions(comp, sells: true, storefront: .read("USA"), portalURL: portal) == [.restore])
    }

    @Test func subscribeOpensThePremiumSheetForThePlan() async throws {
        let store = try root.open()
        let presenter = PremiumPresenter(plan: PlanModel(store: store), analytics: sink.client)

        PlanSection.subscribe(presenter)

        #expect(presenter.presented == .plan)
        #expect(presenter.presentedFrom == .planGroup)
    }

    @Test func manageOpensAppleSubscriptionSettings() async {
        let client = FakePurchaseClient()

        await PlanSection.manage(client)

        #expect(client.manageShown == 1)
    }

    @Test func restoreShowsItsLineUnderIt() async {
        let client = FakePurchaseClient()
        client.restoreResult = .nothing
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)

        await model.restore()

        #expect(client.restores == 1)
        #expect(PlanSection.restoreLine(model) == PlanText.nothingToRestore)
    }

    @Test func aLaterPurchaseLineIsNotShownUnderRestore() async {
        let client = FakePurchaseClient()
        client.restoreResult = .nothing
        client.purchaseResult = .failed
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.restore()

        await model.buy(from: .record)

        #expect(model.line == .failed)
        #expect(PlanSection.restoreLine(model) == nil)
    }
}
