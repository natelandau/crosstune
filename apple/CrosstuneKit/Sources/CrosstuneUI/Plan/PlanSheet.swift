import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneBilling
import CrosstuneDesign
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// The account's plan: what Free and Premium each hold, purchasable for a free or trial account,
/// or confirmed to a Premium one. A locked tap opens it naming what was tapped.
struct PlanSheet: View {

    let reason: PremiumReason
    /// Where the sheet was opened from, which a purchase reports.
    let entry: PremiumEntry
    /// The recording the sheet was opened from, if one was.
    let subject: PremiumSubject?
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    /// The instant the trial card counts from, nil to follow the clock.
    let now: Date?
    /// The context's export action. The host closes the sheet before it acts.
    let onAction: (PlanContextAction) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.plan) private var plan
    @Environment(\.purchases) private var purchases
    @Environment(\.stripePortalURL) private var portalURL
    @State private var storefront: StorefrontRead = .unread

    init(
        reason: PremiumReason, entry: PremiumEntry, subject: PremiumSubject? = nil, purchase: PurchaseModel?,
        now: Date? = nil, onAction: @escaping (PlanContextAction) -> Void
    ) {
        self.reason = reason
        self.entry = entry
        self.subject = subject
        self.purchase = purchase
        self.now = now
        self.onAction = onAction
    }

    /// Whether the sheet shows purchase options or confirms the plan.
    enum Mode: Equatable {
        case purchasable
        case member
    }

    /// A paid or comped plan is confirmed; every other plan, unknown included, is purchasable.
    nonisolated static func mode(_ plan: Plan) -> Mode {
        plan.kind == .premium && !plan.isTrial ? .member : .purchasable
    }

    /// What the sheet offers to buy.
    enum Sale: Equatable {
        /// No choice and no Subscribe.
        case notPurchasable
        /// Asking the store: a disabled Subscribe holds its place, so nothing moves under a tap.
        case loading
        /// As `notPurchasable`, saying the device is offline.
        case offline
        /// As `notPurchasable`, saying the store could not answer: in an alert, or in the
        /// outcome line where the host raises no alert.
        case unavailable
        /// Annual or Monthly, at the store's prices, and Subscribe.
        case choice([PurchaseOffer])
        /// A purchase or restore went through; its line and Close replace the choice.
        case subscribed
    }

    /// One of the legal pages the sheet links to.
    struct Disclosure: Equatable {
        let label: String
        let url: URL
    }

    nonisolated static let links: [Disclosure] = [
        Disclosure(label: PlanText.termsOfUse, url: URL(string: PlanText.termsURL)!),
        Disclosure(label: PlanText.privacyPolicy, url: URL(string: PlanText.privacyURL)!),
    ]

    /// Purchasable only for an account that can subscribe, once the store has answered with a price.
    /// `offers` is nil without a purchase model.
    nonisolated static func sale(plan: Plan, offers: PurchaseModel.Offers?, line: PurchaseModel.Line?) -> Sale {
        guard let offers else { return .notPurchasable }
        // The plan turns Premium only once the sync lands, and may before the sheet closes; the
        // outcome stays either way.
        if line == .subscribed || line == .restored { return .subscribed }
        guard plan.canSubscribe else { return .notPurchasable }
        switch offers {
        case .loading: return .loading
        case .offline: return .offline
        case .unavailable: return .unavailable
        case .ready(let found):
            let offered = choices(found)
            return offered.isEmpty ? .notPurchasable : .choice(offered)
        }
    }

    /// The store's offers, Annual first.
    nonisolated static func choices(_ offers: [PurchaseOffer]) -> [PurchaseOffer] {
        PurchasePeriod.allCases.compactMap { period in offers.first { $0.period == period } }
    }

    /// One tile of the period choice: the period, what it costs, and Annual's saving.
    struct PeriodOption: Equatable {
        let period: PurchasePeriod
        let label: String
        /// The store's formatted price, such as "$49.99".
        let amount: String
        /// "Save 17%" on Annual when the store sells both periods, nil otherwise.
        let badge: String?

        /// "a year" or "a month".
        var per: String { PlanSheet.perPeriod(period) }

        /// The amount and its period, as one line.
        var price: String { PlanSheet.priceLine(amount, period: period) }
    }

    /// The period words `priceLine` follows the amount with.
    nonisolated static func perPeriod(_ period: PurchasePeriod) -> String {
        switch period {
        case .annual: PlanText.perYear
        case .monthly: PlanText.perMonth
        }
    }

    /// A tile for each period the store sells, Annual first, each with its price. The saving is
    /// worked out from the store's own two amounts, so it shows only when both are sold.
    nonisolated static func options(_ offers: [PurchaseOffer]) -> [PeriodOption] {
        let sold = choices(offers)
        let annual = sold.first { $0.period == .annual }
        let monthly = sold.first { $0.period == .monthly }
        let saving = annual.flatMap { annual in
            monthly.flatMap { PlanText.saving(annual: annual.amount, monthly: $0.amount) }
        }
        return sold.map { offer in
            PeriodOption(
                period: offer.period, label: periodLabel(offer.period), amount: offer.price,
                badge: offer.period == .annual ? saving.map(PlanText.save) : nil)
        }
    }

    /// The line a settled sheet shows: the restore's after a restore, otherwise the purchase's.
    nonisolated static func settledLine(_ line: PurchaseModel.Line?) -> String {
        line == .restored ? PlanText.restored : PlanText.subscribed
    }

    /// The line by the actions: the settled line once subscribed, otherwise the outcome of a
    /// try in this sheet, and failing that the offline line while the device is offline, or,
    /// where `alertsUnavailable` is false, the unavailable line while the store cannot answer.
    nonisolated static func outcomeLine(
        _ sale: Sale, line: PurchaseModel.Line?, alertsUnavailable: Bool = true
    ) -> String? {
        switch sale {
        case .choice, .loading, .notPurchasable: line.flatMap(PlanText.line)
        case .unavailable:
            line.flatMap(PlanText.line) ?? (alertsUnavailable ? nil : PlanText.subscribeUnavailableTitle)
        case .subscribed: settledLine(line)
        case .offline: line.flatMap(PlanText.line) ?? PlanText.subscribeOffline
        }
    }

    /// The alert over the sheet: a failed try in it, otherwise the store's failure to answer
    /// until it is dismissed. `alertsUnavailable` false leaves the failure to answer to the
    /// outcome line.
    nonisolated static func storeAlert(
        _ sale: Sale, line: PurchaseModel.Line?, unavailableDismissed: Bool, alertsUnavailable: Bool = true
    ) -> StoreAlert? {
        if let failure = StoreAlert.failure(line) { return failure }
        return sale == .unavailable && !unavailableDismissed && alertsUnavailable ? .unavailable : nil
    }

    /// Whether the sheet asks the store for offers: only where the plan is purchasable.
    nonisolated static func asksForOffers(_ plan: Plan) -> Bool {
        mode(plan) == .purchasable && plan.canSubscribe
    }

    /// What restarts a sheet's ask for offers when it changes.
    struct OfferAsk: Equatable {
        let sells: Bool
        let offline: Bool?
    }

    /// Whether Restore purchases shows: until a purchase or restore settles, since a restore
    /// after one could replace its line and bring Subscribe back before the sync.
    nonisolated static func offersRestore(_ sale: Sale) -> Bool {
        sale != .subscribed
    }

    /// Whether `sale` ends in a button the phone's action bar pins: Subscribe, its place while
    /// the store answers, or Close once a purchase or restore settles. Where nothing is for sale,
    /// the reason and Restore purchases stay on the page.
    nonisolated static func pinsAction(_ sale: Sale, hasPurchase: Bool) -> Bool {
        switch sale {
        case .choice, .loading: hasPurchase
        case .subscribed: true
        case .offline, .unavailable, .notPurchasable: false
        }
    }

    /// `period` when the store sells it, otherwise the first period it does sell.
    nonisolated static func chosen(_ period: PurchasePeriod, in offers: [PurchaseOffer]) -> PurchasePeriod {
        offers.contains { $0.period == period } ? period : (choices(offers).first?.period ?? period)
    }

    /// The offer the selected tile represents, whose price the renewal terms state.
    nonisolated static func chosenOffer(_ period: PurchasePeriod, in offers: [PurchaseOffer]) -> PurchaseOffer? {
        let period = chosen(period, in: offers)
        return offers.first { $0.period == period }
    }

    nonisolated static func periodLabel(_ period: PurchasePeriod) -> String {
        switch period {
        case .annual: PlanText.periodAnnual
        case .monthly: PlanText.periodMonthly
        }
    }

    nonisolated static func priceLine(_ amount: String, period: PurchasePeriod) -> String {
        switch period {
        case .annual: PlanText.annualPrice(amount)
        case .monthly: PlanText.monthlyPrice(amount)
        }
    }

    /// Buys the chosen period, or the one the store sells when it sells only one.
    static func subscribe(_ purchase: PurchaseModel, from entry: PremiumEntry) async {
        if case .ready(let offers) = purchase.offers {
            purchase.period = chosen(purchase.period, in: offers)
        }
        await purchase.buy(from: entry)
    }

    /// Full height, since the comparison and the choice below it fill a phone.
    nonisolated static let detents: Set<PresentationDetent> = [.large]

    var body: some View {
        let currentPlan = plan?.plan ?? .unknown
        let mode = Self.mode(currentPlan)
        PlanContextReader(reason: reason, subject: subject) { context in
            #if os(macOS)
                macSheet(currentPlan, mode: mode, context: context)
            #else
                NavigationStack {
                    Group {
                        switch mode {
                        case .purchasable:
                            PlanPanel(
                                context: context, purchase: purchase, entry: entry, now: now, onAction: onAction,
                                host: .sheet(onClose: { dismiss() }))
                        case .member:
                            ScrollView {
                                VStack(alignment: .leading, spacing: 16) {
                                    member(currentPlan)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding()
                            }
                            .planBackground()
                            .memberAlert(purchase)
                        }
                    }
                    #if os(iOS)
                        .navigationBarTitleDisplayMode(.inline)
                    #endif
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            SheetCloseButton { dismiss() }
                        }
                    }
                }
            #endif
        }
        .task(id: currentPlan.paidSources) {
            storefront = .unread
            storefront = .read(await Self.storefront(for: currentPlan, client: purchases))
        }
        .presentationDetents(Self.detents)
        .shellSheet()
    }

    #if !os(macOS)
        /// A Premium account's plan: the mark and thanks, the membership, what Premium includes,
        /// and Restore purchases.
        @ViewBuilder
        private func member(_ plan: Plan) -> some View {
            VStack(spacing: 6) {
                PlanMark()
                    .padding(.bottom, 6)
                Text(PlanText.onPremium)
                    .font(.platform(.title2).bold())
                    .accessibilityAddTraits(.isHeader)
                Text(PlanText.thanks)
                    .foregroundStyle(.textSecondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
            let membership = Self.membership(plan, now: now ?? .now)
            let manage = Self.manage(plan, storefront: storefront, portalURL: portalURL)
            if membership != nil || !manage.isEmpty {
                MembershipCard(membership: membership, manage: manage)
            }
            IncludedList()
            if let purchase {
                VStack(spacing: 4) {
                    RestorePurchasesButton(purchase: purchase)
                    if let line = Self.restoreLine(purchase) {
                        Text(line)
                            .foregroundStyle(.textSecondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .font(.platform(.footnote))
                .frame(maxWidth: .infinity)
            }
        }
    #endif
}

#if os(macOS)
    extension PlanSheet {
        /// A member's footer: nothing to buy, so Close is the one primary, on Return and Escape.
        nonisolated static func macMemberFooter(close: @escaping @MainActor () -> Void) -> MacSheetFooter {
            MacSheetFooter(primary: .init(SheetCloseButton.close, action: close), escape: close)
        }

        /// The plan panel in the frame it names while purchasable, or the membership and what
        /// Premium includes for a member, with Restore purchases leading the footer.
        @ViewBuilder
        func macSheet(_ plan: Plan, mode: Mode, context: PlanContext) -> some View {
            switch mode {
            case .purchasable:
                let chrome = PlanPanel.macChrome(
                    plan: plan, context: context, purchase: purchase, entry: entry, close: { dismiss() })
                MacSheet(
                    title: chrome.title, subtitle: chrome.subtitle, style: .notice, size: .fitted(.tall),
                    cancel: chrome.footer.cancel, primary: chrome.footer.primary, escape: chrome.footer.escape
                ) {
                    if let purchase, chrome.offersRestore {
                        RestorePurchasesButton(purchase: purchase)
                    }
                } content: {
                    PlanPanel(
                        context: context, purchase: purchase, entry: entry, now: now, onAction: onAction,
                        host: .sheet(onClose: nil))
                }
            case .member:
                let footer = Self.macMemberFooter { dismiss() }
                MacSheet(
                    title: PlanText.onPremium, subtitle: PlanText.thanks, style: .notice, size: .fitted(.tall),
                    cancel: footer.cancel, primary: footer.primary, escape: footer.escape
                ) {
                    if let purchase {
                        RestorePurchasesButton(purchase: purchase)
                    }
                } content: {
                    VStack(alignment: .leading, spacing: 16) {
                        macMember(plan)
                    }
                    .font(MacStyle.body)
                    .foregroundStyle(Palette.textPrimary)
                    .memberAlert(purchase)
                }
            }
        }

        @ViewBuilder
        private func macMember(_ plan: Plan) -> some View {
            let membership = Self.membership(plan, now: now ?? .now)
            let manage = Self.manage(plan, storefront: storefront, portalURL: portalURL)
            if membership != nil || !manage.isEmpty {
                MembershipCard(membership: membership, manage: manage)
            }
            IncludedList()
            if let purchase, let line = Self.restoreLine(purchase) {
                Text(line)
                    .font(MacStyle.secondary)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
#endif

#if !os(macOS)
    /// Subscribe's place while the store answers: disabled, and named Subscribe for VoiceOver.
    struct WaitingSubscribeButton: View {
        var body: some View {
            Button {
            } label: {
                ProgressView().controlSize(.small)
            }
            .disabled(true)
            .accessibilityLabel(PlanText.subscribe)
        }
    }
#endif

extension View {
    /// A member's sheet shows only a failed restore's alert, since nothing is for sale.
    fileprivate func memberAlert(_ purchase: PurchaseModel?) -> some View {
        storeAlert(StoreAlert.failure(purchase?.line)) { purchase?.clearLine() }
    }
}

/// The CT mark heading the sheet: a slate C on light, a white C on dark, and the brand-colored T on both.
struct PlanMark: View {
    @ScaledMetric(relativeTo: .title) private var height: CGFloat = 40

    var body: some View {
        Mark()
            .frame(height: height)
            .foregroundStyle(Palette.brandSecondary)
            .accessibilityHidden(true)
    }
}

/// Presents the Plan sheet whenever the presenter asks for it, and the export its context asks
/// for once the sheet has closed, so the two sheets never stack.
struct PlanSheets: ViewModifier {
    let presenter: PremiumPresenter?
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?

    @Environment(\.store) private var store
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    /// The action chosen in the sheet, run once the sheet has gone.
    @State private var pending: PlanContextAction?
    @State private var exporting: ExportSheetItem?

    func body(content: Content) -> some View {
        content
            .sheet(item: shown, onDismiss: runPending) { showing in
                PlanSheet(
                    reason: showing.reason, entry: showing.entry, subject: showing.subject, purchase: purchase
                ) { action in
                    pending = action
                    presenter?.presentation = nil
                }
            }
            .exportSheet($exporting)
    }

    private var shown: Binding<PremiumPresenter.Presentation?> {
        Binding {
            presenter?.presentation
        } set: {
            presenter?.presentation = $0
        }
    }

    private func runPending() {
        guard let action = pending else { return }
        pending = nil
        switch action {
        case .exportAll:
            exporting = .everything
        case .exportRecording(let id):
            guard let store else {
                exporting = .everything
                return
            }
            Task {
                // Deleted since the sheet closed: the account's other recordings are still there.
                guard let rows = try? await store.read({ db in try ScreenRows.fetch(db, id: id) }) else {
                    exporting = .everything
                    return
                }
                let readiness = ExportReadiness(rows.view, store: store, engine: engine, session: session)
                exporting = .recordings(RecordingExportRequest(rows, readiness: readiness, delivery: .oneRecording))
            }
        }
    }
}
