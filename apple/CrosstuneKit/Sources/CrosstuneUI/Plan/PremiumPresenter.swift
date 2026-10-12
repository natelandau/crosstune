import CrosstuneAnalytics
import Observation
import SwiftUI

/// Answers a tap on something Premium holds: lets it act, or shows the Premium sheet in its
/// place. Made for one `PlanModel`, so it follows the open store's plan.
@MainActor
@Observable
final class PremiumPresenter {
    /// The reason the Premium sheet is up for, nil while it is not.
    var presented: PremiumReason? {
        didSet { if presented == nil { presentedFrom = nil } }
    }
    /// Where the showing sheet was opened from, so a purchase in it reports its entry.
    private(set) var presentedFrom: PremiumEntry?

    private let plan: PlanModel
    private let analytics: AnalyticsClient
    /// The sheet's purchase model, nil in a build that offers no purchase.
    private let purchase: PurchaseModel?

    init(plan: PlanModel, analytics: AnalyticsClient, purchase: PurchaseModel? = nil) {
        self.plan = plan
        self.analytics = analytics
        self.purchase = purchase
    }

    /// Whether the tapped action may go ahead. When the plan holds it back, shows the Premium
    /// sheet for `reason` and returns false. An unknown plan gates nothing.
    func gate(_ reason: PremiumReason, from entry: PremiumEntry) -> Bool {
        let current = plan.plan
        let allowed =
            switch reason {
            case .recordings: current.recordingsPlay
            case .scans: current.scansOnAnyTune
            // The Plan reason holds nothing back; `present` opens it.
            case .plan: true
            }
        if allowed { return true }
        present(reason, from: entry)
        return false
    }

    /// Shows the Premium sheet for `reason`, opened from `entry`.
    func present(_ reason: PremiumReason, from entry: PremiumEntry) {
        // A second tap behind the sheet already up is not another showing.
        guard presented == nil else { return }
        // Before the sheet first renders, so an earlier outcome never shows in it for a frame.
        purchase?.clearLine()
        presented = reason
        presentedFrom = entry
        analytics.send(.premiumSheetShown(reason: reason, from: entry))
    }
}

extension EnvironmentValues {
    /// Gates the controls Premium holds. Supplied by the shell while a store's plan is open;
    /// nil gates nothing.
    @Entry var premium: PremiumPresenter?
}
