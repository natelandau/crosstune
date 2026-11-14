import CrosstuneAnalytics
import Observation
import SwiftUI

/// Answers a tap on something Premium holds: lets it act, or shows the Plan sheet in its
/// place. Made for one `PlanModel`, so it follows the open store's plan.
@MainActor
@Observable
final class PremiumPresenter {
    /// One showing of the Plan sheet.
    struct Presentation: Identifiable, Equatable {
        let reason: PremiumReason
        /// Where it was opened from, so a purchase in it reports its entry.
        let entry: PremiumEntry
        /// The recording it was opened from, which its context names and exports.
        let subject: PremiumSubject?

        var id: PremiumReason { reason }
    }

    /// The showing sheet, nil while none is up.
    var presentation: Presentation?

    /// The reason the Plan sheet is up for, nil while it is not.
    var presented: PremiumReason? { presentation?.reason }

    private let plan: PlanModel
    private let analytics: AnalyticsClient
    /// The sheet's purchase model, nil in a build that offers no purchase.
    private let purchase: PurchaseModel?

    init(plan: PlanModel, analytics: AnalyticsClient, purchase: PurchaseModel? = nil) {
        self.plan = plan
        self.analytics = analytics
        self.purchase = purchase
    }

    /// Whether the tapped action may go ahead. When the plan holds it back, shows the Plan sheet
    /// for `reason` and returns false. An unknown plan gates nothing.
    func gate(_ reason: PremiumReason, from entry: PremiumEntry, subject: PremiumSubject? = nil) -> Bool {
        let current = plan.plan
        let allowed =
            switch reason {
            case .recordings: current.recordingsPlay
            case .scans: current.scansOpen
            // The Plan reason holds nothing back; `present` opens it.
            case .plan: true
            }
        if allowed { return true }
        present(reason, from: entry, subject: subject)
        return false
    }

    /// Shows the Plan sheet for `reason`, opened from `entry`, and from `subject` when a recording
    /// was tapped.
    func present(_ reason: PremiumReason, from entry: PremiumEntry, subject: PremiumSubject? = nil) {
        // A second tap behind the sheet already up is not another showing.
        guard presented == nil else { return }
        // Before the sheet first renders, so an earlier outcome or choice never shows in it for
        // a frame.
        purchase?.resetForShowing()
        presentation = Presentation(reason: reason, entry: entry, subject: subject)
        analytics.send(.premiumSheetShown(reason: reason, from: entry, presentation: .sheet))
    }
}

extension PurchaseModel {
    /// Readies the purchase for a new showing of the Plan sheet or a page's overlay: Annual with
    /// no earlier outcome, except while a purchase runs or waits on approval, since the two share
    /// the purchase and its line must stay.
    func resetForShowing() {
        guard !isWorking, line != .pending else { return }
        clearLine()
        period = .annual
    }
}

extension EnvironmentValues {
    /// Gates the controls Premium holds. Supplied by the shell while a store's plan is open;
    /// nil gates nothing.
    @Entry var premium: PremiumPresenter?
}
