import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PlanSectionTests {
    private let root = TemporaryRoot()

    /// A plan model over a store holding an entitlements row from `source`, once it has judged it.
    private func plan(source: String?) async throws -> PlanModel {
        let store = try root.open()
        let ends = noon.date.addingTimeInterval(30 * 86_400)
        let row = Entitlement(
            id: "entitlement-\(source ?? "free")", createdAt: noon, premiumSource: source,
            premiumExpiresAt: source == nil || source == "comp" ? nil : Timestamp(ends), autoRenews: source != nil,
            trialEndsAt: source == "trial" ? Timestamp(ends) : nil, premiumQuotaBytes: 10_000, freeQuotaBytes: 1_000)
        try await store.write { writer in try row.upsert(writer.db) }
        let model = PlanModel(store: store, now: { noon.date })
        #expect(try await poll { model.isLoaded && model.plan.kind != .unknown })
        return model
    }

    @Test(arguments: [nil, "trial", "comp", "apple", "stripe"] as [String?])
    func thePlanRowOpensThePlanSheetForEveryAccount(source: String?) async throws {
        let sink = RecordingAnalyticsSink()
        let presenter = PremiumPresenter(plan: try await plan(source: source), analytics: sink.client)

        PlanSection.open(presenter)

        #expect(presenter.presented == .plan)
        #expect(presenter.presentedFrom == .planGroup)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown", properties: ["reason": .string("plan"), "from": .string("plan_group")])
            ])
    }

    @Test func thePlanRowSaysItOpensThePlan() {
        #expect(PlanSection.hint == PlanText.seePlan)
    }
}
