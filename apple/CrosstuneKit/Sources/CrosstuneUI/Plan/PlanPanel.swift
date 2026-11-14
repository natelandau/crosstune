import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// What a free or trial account can buy: the context area with its export action, a trial's
/// card, the comparison, and the period choice with Subscribe. It loads the store's offers and
/// shows the store's alerts. Closing is left to its host. On the Mac its host draws the frame
/// that ``macChrome(plan:context:purchase:entry:close:)`` names: the title, the line, and
/// Subscribe.
struct PlanPanel: View {
    let context: PlanContext
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    /// Where the panel was opened from, which a purchase reports.
    let entry: PremiumEntry
    /// The instant the trial card counts from, nil to follow the clock.
    let now: Date?
    let onAction: (PlanContextAction) -> Void
    let host: Host

    /// What the panel is drawn in.
    enum Host {
        /// The Plan sheet, which the musician opened. `onClose` is the phone's Close once a
        /// purchase settles.
        case sheet(onClose: (() -> Void)?)
        /// A page's overlay, which shows itself unasked and cannot be closed.
        case overlay

        var onClose: (() -> Void)? {
            if case .sheet(let onClose) = self { onClose } else { nil }
        }

        /// Whether the store's failure to answer raises an alert: not over a host that shows
        /// itself unasked, since the alert would cover the app.
        var alertsUnavailable: Bool {
            if case .sheet = self { true } else { false }
        }
    }

    @Environment(\.plan) private var plan
    @Environment(\.premium) private var premium
    /// Whether OK has closed the alert for the store's failure to answer, until the panel asks again.
    @State private var unavailableDismissed = false

    /// Whether the panel shows the store's alerts. An overlay leaves them to a Plan sheet shown
    /// beside it, which shares its purchase, so one failure never raises two alerts.
    private var showsAlerts: Bool {
        if case .overlay = host { return premium?.presented == nil }
        return true
    }

    init(
        context: PlanContext, purchase: PurchaseModel?, entry: PremiumEntry, now: Date? = nil,
        onAction: @escaping (PlanContextAction) -> Void, host: Host
    ) {
        self.context = context
        self.purchase = purchase
        self.entry = entry
        self.now = now
        self.onAction = onAction
        self.host = host
    }

    var body: some View {
        let currentPlan = plan?.plan ?? .unknown
        let sale = PlanSheet.sale(plan: currentPlan, offers: purchase?.offers, line: purchase?.line)
        content(currentPlan, sale: sale)
            .storeAlert(
                showsAlerts
                    ? PlanSheet.storeAlert(
                        sale, line: purchase?.line, unavailableDismissed: unavailableDismissed,
                        alertsUnavailable: host.alertsUnavailable)
                    : nil
            ) {
                if StoreAlert.failure(purchase?.line) != nil {
                    purchase?.clearLine()
                } else {
                    unavailableDismissed = true
                }
            }
            // Asks only where the plan is purchasable, and again when the connection comes back.
            .task(
                id: PlanSheet.OfferAsk(sells: PlanSheet.asksForOffers(currentPlan), offline: purchase?.isOffline)
            ) {
                guard PlanSheet.asksForOffers(currentPlan) else { return }
                unavailableDismissed = false
                await purchase?.loadOffers()
            }
    }

    nonisolated static func label(_ action: PlanContextAction) -> String {
        switch action {
        case .exportRecording: PlanText.exportThisRecording
        case .exportAll: PlanText.exportEverything
        }
    }

    #if os(macOS)
        /// The export action over a trial's card and the comparison, then the period choice and
        /// its terms.
        private func content(_ plan: Plan, sale: PlanSheet.Sale) -> some View {
            VStack(alignment: .leading, spacing: 16) {
                PlanActionButton(action: context.action, onAction: onAction)
                if plan.isTrial {
                    TrialCard(startsAt: plan.trialStartsAt, endsAt: plan.trialEndsAt ?? plan.premiumEndsAt, now: now)
                }
                PlanComparison()
                PlanMacSale(sale: sale, purchase: purchase, alertsUnavailable: host.alertsUnavailable)
            }
            .font(MacStyle.body)
            .foregroundStyle(Palette.textPrimary)
        }
    #else
        private func content(_ plan: Plan, sale: PlanSheet.Sale) -> some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PlanHeadline(context: context)
                    if plan.isTrial {
                        TrialCard(
                            startsAt: plan.trialStartsAt, endsAt: plan.trialEndsAt ?? plan.premiumEndsAt, now: now)
                    }
                    PlanComparison()
                    PlanInlineActions(
                        sale: sale, purchase: purchase, alertsUnavailable: host.alertsUnavailable,
                        export: PlanSheet.pinsAction(sale, hasPurchase: purchase != nil)
                            ? nil : exportAction(sale).map { ($0, onAction) })
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .planBackground()
            .sheetActions(
                line: PlanSheet.outcomeLine(sale, line: purchase?.line, alertsUnavailable: host.alertsUnavailable),
                isShown: PlanSheet.pinsAction(sale, hasPurchase: purchase != nil)
            ) {
                barAction(sale)
            } secondary: {
                if let action = exportAction(sale) {
                    PlanExportButton(action: action, onAction: onAction)
                }
            }
        }

        /// The export under Subscribe, which a settled purchase has no use for.
        private func exportAction(_ sale: PlanSheet.Sale) -> PlanContextAction? {
            sale == .subscribed ? nil : context.action
        }

        /// The bar's button for `sale`.
        @ViewBuilder
        private func barAction(_ sale: PlanSheet.Sale) -> some View {
            switch (sale, purchase) {
            case (.choice, let purchase?):
                subscribeButton(purchase)
            case (.loading, _?):
                WaitingSubscribeButton()
            case (.subscribed, _):
                // The phone's glass xmark is easy to miss, so Close also reads as a button.
                if let onClose = host.onClose {
                    Button(SheetCloseButton.close, action: onClose)
                }
            default:
                EmptyView()
            }
        }

        private func subscribeButton(_ purchase: PurchaseModel) -> some View {
            Button(PlanText.subscribe) {
                Task { await PlanSheet.subscribe(purchase, from: entry) }
            }
            .disabled(purchase.isWorking)
        }
    #endif
}

/// The context's export, as the text button under Subscribe.
private struct PlanExportButton: View {
    let action: PlanContextAction
    let onAction: (PlanContextAction) -> Void

    var body: some View {
        Button(PlanPanel.label(action)) { onAction(action) }
            .buttonStyle(.text)
    }
}

/// The context's export action, when it has one.
private struct PlanActionButton: View {
    let action: PlanContextAction?
    let onAction: (PlanContextAction) -> Void

    var body: some View {
        if let action {
            Button(PlanPanel.label(action)) { onAction(action) }
                .buttonStyle(.text)
        }
    }
}

/// The period choice among the store's offers.
private struct PlanPeriodTiles: View {
    let offers: [PurchaseOffer]
    @Bindable var purchase: PurchaseModel

    var body: some View {
        PeriodTiles(options: PlanSheet.options(offers), period: $purchase.chosenPeriod)
    }
}

#if os(macOS)
    /// The period choice and its terms, then the outcome of a try or why nothing is purchasable.
    private struct PlanMacSale: View {
        let sale: PlanSheet.Sale
        let purchase: PurchaseModel?
        let alertsUnavailable: Bool

        var body: some View {
            if case .choice(let offers) = sale, let purchase {
                PlanPeriodTiles(offers: offers, purchase: purchase)
            }
            if let line = PlanSheet.outcomeLine(sale, line: purchase?.line, alertsUnavailable: alertsUnavailable) {
                Text(line)
                    .foregroundStyle(
                        sale == .offline || sale == .notPurchasable || sale == .unavailable
                            ? Palette.textSecondary : Palette.textPrimary
                    )
                    .fixedSize(horizontal: false, vertical: true)
            }
            if case .choice(let offers) = sale, let purchase,
                let offer = PlanSheet.chosenOffer(purchase.period, in: offers)
            {
                RenewalTerms(price: offer.price, period: offer.period)
            }
        }
    }
#else
    /// The mark over the context's title and its line.
    private struct PlanHeadline: View {
        let context: PlanContext

        var body: some View {
            VStack(spacing: 6) {
                PlanMark()
                    .padding(.bottom, 6)
                Text(context.title)
                    .font(.platform(.title2).bold())
                    .accessibilityAddTraits(.isHeader)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentMask()
                // The line can name one of the musician's recordings.
                Text(context.body)
                    .foregroundStyle(.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentMask()
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }

    /// The choice and its terms at the end of the scrolling page, and, where nothing is for
    /// sale, why with Restore purchases. Only Subscribe or Close and the outcome pin to the
    /// bottom edge in the action bar, so the terms and links scroll at any text size.
    private struct PlanInlineActions: View {
        let sale: PlanSheet.Sale
        let purchase: PurchaseModel?
        let alertsUnavailable: Bool
        /// The export in Subscribe's place, while nothing pins to the action bar.
        let export: (action: PlanContextAction, onAction: (PlanContextAction) -> Void)?

        var body: some View {
            VStack(alignment: .center, spacing: 16) {
                if let export {
                    PlanExportButton(action: export.action, onAction: export.onAction)
                }
                switch (sale, purchase) {
                case (.choice(let offers), let purchase?):
                    PlanPeriodTiles(offers: offers, purchase: purchase)
                    PlanSaleTerms(sale: sale, purchase: purchase)
                case (.loading, let purchase?):
                    PlanSaleTerms(sale: sale, purchase: purchase)
                case (.loading, nil), (.subscribed, _), (.choice, nil):
                    EmptyView()
                case (.offline, _), (.unavailable, _), (.notPurchasable, _):
                    if let line = PlanSheet.outcomeLine(
                        sale, line: purchase?.line, alertsUnavailable: alertsUnavailable)
                    {
                        Text(line)
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .foregroundStyle(.textSecondary)
                    }
                    if let purchase {
                        PlanSaleTerms(sale: sale, purchase: purchase)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: Alignment(horizontal: .center, vertical: .center))
            .padding(.top, 16)
        }
    }

    /// The terms a sale shows, with Restore purchases beside the legal links; Restore alone
    /// while nothing is purchasable, and nothing once a purchase settles.
    private struct PlanSaleTerms: View {
        let sale: PlanSheet.Sale
        let purchase: PurchaseModel

        var body: some View {
            if case .choice(let offers) = sale {
                if let offer = PlanSheet.chosenOffer(purchase.period, in: offers) {
                    RenewalTerms(price: offer.price, period: offer.period) {
                        RestorePurchasesButton(purchase: purchase)
                    }
                }
            } else if PlanSheet.offersRestore(sale) {
                RestorePurchasesButton(purchase: purchase).font(.platform(.footnote))
            }
        }
    }
#endif

extension PurchaseModel {
    /// The period the tiles select: `period` where the store sells it, else the first period
    /// it sells.
    var chosenPeriod: PurchasePeriod {
        get {
            guard case .ready(let offers) = offers else { return period }
            return PlanSheet.chosen(period, in: offers)
        }
        set { period = newValue }
    }
}

/// Restore purchases, disabled while a purchase or restore runs.
struct RestorePurchasesButton: View {
    let purchase: PurchaseModel

    var body: some View {
        Button(PlanText.restorePurchases) {
            Task { await purchase.restore() }
        }
        .disabled(purchase.isWorking)
        .buttonStyle(.text)
    }
}

#if os(macOS)
    extension PlanPanel {
        /// The frame a Mac host draws around the panel.
        struct MacChrome {
            let title: String
            let subtitle: String
            let footer: MacSheetFooter
            /// Whether Restore purchases leads the footer.
            let offersRestore: Bool
        }

        /// The context's title and line over the panel, and Subscribe with Close before it when
        /// `close` is set.
        static func macChrome(
            plan: Plan, context: PlanContext, purchase: PurchaseModel?, entry: PremiumEntry,
            close: (@MainActor () -> Void)?
        ) -> MacChrome {
            let sale = PlanSheet.sale(plan: plan, offers: purchase?.offers, line: purchase?.line)
            let footer = macFooter(sale, isWorking: purchase?.isWorking ?? false, close: close) {
                guard let purchase else { return }
                Task { await PlanSheet.subscribe(purchase, from: entry) }
            }
            return MacChrome(
                title: context.title, subtitle: context.body, footer: footer,
                offersRestore: purchase != nil && PlanSheet.offersRestore(sale))
        }

        /// Subscribe trailing while the plan is purchasable, which never takes Return, since a
        /// locked tap opens the panel unasked, with Close before it when `close` is set.
        /// Subscribe holds its place, disabled, while the store answers, while a purchase runs,
        /// and while the store cannot be reached, when the panel's outcome line says why.
        nonisolated static func macFooter(
            _ sale: PlanSheet.Sale, isWorking: Bool, close: (@MainActor () -> Void)?,
            subscribe: @escaping @MainActor () -> Void
        ) -> MacSheetFooter {
            var footer = MacSheetFooter(cancel: close.map { .cancel(SheetCloseButton.close, action: $0) })
            switch sale {
            case .choice:
                footer.primary = .subscribe(title: PlanText.subscribe, isEnabled: !isWorking, action: subscribe)
            case .loading, .offline, .unavailable:
                footer.primary = .subscribe(title: PlanText.subscribe, isEnabled: false, action: subscribe)
            case .notPurchasable, .subscribed:
                break
            }
            return footer
        }
    }
#endif
