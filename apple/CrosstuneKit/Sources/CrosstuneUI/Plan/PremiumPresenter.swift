import CrosstuneAnalytics
import Observation
import SwiftUI

/// Answers a tap on something Premium holds: lets it act, or shows the Premium sheet in its
/// place. Made for one `PlanModel`, so it follows the open store's plan.
@MainActor
@Observable
final class PremiumPresenter {
    /// The reason the Premium sheet is up for, nil while it is not.
    var presented: PremiumReason?

    private let plan: PlanModel
    private let analytics: AnalyticsClient

    init(plan: PlanModel, analytics: AnalyticsClient) {
        self.plan = plan
        self.analytics = analytics
    }

    /// Whether the tapped action may go ahead. When the plan holds it back, shows the Premium
    /// sheet for `reason` and returns false. An unknown plan gates nothing.
    func gate(_ reason: PremiumReason, from entry: PremiumEntry) -> Bool {
        let current = plan.plan
        let allowed =
            switch reason {
            case .recordings: current.recordingsPlay
            case .scans: current.scansOnAnyTune
            // Nothing in this app opens the Plan reason, so there is nothing to hold back.
            case .plan: true
            }
        if allowed { return true }
        // A second tap behind the sheet already up is not another showing.
        if presented == nil {
            presented = reason
            analytics.send(.premiumSheetShown(reason: reason, from: entry))
        }
        return false
    }
}

extension EnvironmentValues {
    /// Gates the controls Premium holds. Supplied by the shell while a store's plan is open;
    /// nil gates nothing.
    @Entry var premium: PremiumPresenter?
}
