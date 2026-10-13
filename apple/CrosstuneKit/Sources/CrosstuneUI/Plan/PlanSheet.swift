import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import SwiftUI

/// The account's plan: what Free and Premium each hold, sold to a free or trial account, or
/// confirmed to a Premium one. A locked tap opens it naming what was tapped.
struct PlanSheet: View {
    nonisolated static let close = "Close"

    let reason: PremiumReason
    /// Where the sheet was opened from, which a purchase reports.
    let entry: PremiumEntry
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    /// The instant the trial card counts from, nil to follow the clock.
    let now: Date?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.plan) private var plan
    @Environment(\.store) private var store
    @Environment(\.purchases) private var purchases
    @Environment(\.stripePortalURL) private var portalURL
    @State private var scanTuneTitle: String?
    @State private var storefront: StorefrontRead = .unread

    init(reason: PremiumReason, entry: PremiumEntry, purchase: PurchaseModel?, now: Date? = nil) {
        self.reason = reason
        self.entry = entry
        self.purchase = purchase
        self.now = now
    }

    /// Whether the sheet sells or confirms the plan.
    enum Mode: Equatable {
        case selling
        case member
    }

    /// A paid or comped plan is confirmed; every other plan, unknown included, is sold to.
    nonisolated static func mode(_ plan: Plan) -> Mode {
        plan.kind == .premium && !plan.isTrial ? .member : .selling
    }

    /// What the sheet offers to buy.
    enum Sale: Equatable {
        /// No choice and no Subscribe.
        case notSelling
        /// Asking the store: a disabled Subscribe holds its place, so nothing moves under a tap.
        case loading
        /// As `notSelling`, saying the store could not be reached.
        case offline
        /// Annual or Monthly, at the store's prices, and Subscribe.
        case choice([PurchaseOffer])
        /// A purchase or restore went through; its line and Close stand in for the choice.
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

    /// The sheet's opening title and line: the product and its pitch from the plan, or what was
    /// tapped from a locked control. The scans body is nil until the scan tune's title is read.
    nonisolated static func headline(_ reason: PremiumReason, scanTuneTitle: String?) -> (
        title: String, body: String?
    ) {
        switch reason {
        case .plan: (PlanText.premiumPlanTitle, PlanText.premiumPitch)
        case .recordings: (PlanText.premiumRecordingsTitle, PlanText.premiumRecordingsBody)
        case .scans: (PlanText.premiumScansTitle, scanTuneTitle.map { PlanText.premiumScansBody(tuneTitle: $0) })
        }
    }

    /// Sells only to an account that can subscribe, once the store has answered with a price.
    /// `offers` is nil without a purchase model.
    nonisolated static func sale(plan: Plan, offers: PurchaseModel.Offers?, line: PurchaseModel.Line?) -> Sale {
        guard let offers else { return .notSelling }
        // The plan turns Premium only once the sync lands, and may before the sheet closes; the
        // outcome stays either way.
        if line == .subscribed || line == .restored { return .subscribed }
        guard plan.canSubscribe else { return .notSelling }
        switch offers {
        case .loading: return .loading
        case .unavailable: return .offline
        case .ready(let found):
            let offered = choices(found)
            return offered.isEmpty ? .notSelling : .choice(offered)
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
        PlanText.line(line == .restored ? .restored : .subscribed)
    }

    /// The line by the actions: the settled line once subscribed, otherwise the outcome of a
    /// try in this sheet, and failing that the offline line while the store cannot be reached.
    nonisolated static func outcomeLine(_ sale: Sale, line: PurchaseModel.Line?) -> String? {
        switch sale {
        case .choice, .loading, .notSelling: line.map(PlanText.line)
        case .subscribed: settledLine(line)
        case .offline: line.map(PlanText.line) ?? PlanText.subscribeOffline
        }
    }

    /// Whether the sheet asks the store for offers: only where it may sell them.
    nonisolated static func asksForOffers(_ plan: Plan) -> Bool {
        mode(plan) == .selling && plan.canSubscribe
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

    /// `period` when the store sells it, otherwise the first period it does sell.
    nonisolated static func chosen(_ period: PurchasePeriod, in offers: [PurchaseOffer]) -> PurchasePeriod {
        offers.contains { $0.period == period } ? period : (choices(offers).first?.period ?? period)
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
        let sale = Self.sale(plan: currentPlan, offers: purchase?.offers, line: purchase?.line)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch mode {
                    case .selling:
                        selling(currentPlan)
                        inlineActions(sale)
                    case .member:
                        member(currentPlan)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .planGround()
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(Self.close) { dismiss() }
                }
            }
        }
        .task(id: plan?.scanTune) { await readScanTuneTitle() }
        .task(id: currentPlan.source) {
            storefront = .unread
            storefront = .read(await Self.storefront(for: currentPlan, client: purchases))
        }
        // Asks only where the sheet sells, and again when the connection comes back.
        .task(id: OfferAsk(sells: Self.asksForOffers(currentPlan), offline: purchase?.isOffline)) {
            guard Self.asksForOffers(currentPlan) else { return }
            await purchase?.loadOffers()
        }
        .macSheetFrame(.longForm)
        .presentationDetents(Self.detents)
        .shellSheet()
    }

    /// The mark over the headline, a trial's card, and the comparison.
    @ViewBuilder
    private func selling(_ plan: Plan) -> some View {
        let (title, message) = Self.headline(reason, scanTuneTitle: scanTuneTitle)
        VStack(spacing: 6) {
            PlanMark()
                .padding(.bottom, 6)
            Text(title)
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let message {
                // The scans body names a tune.
                Text(message)
                    .foregroundStyle(.secondary)
                    .contentMask()
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        if plan.isTrial {
            TrialCard(startsAt: plan.trialStartsAt, endsAt: plan.trialEndsAt ?? plan.premiumEndsAt, now: now)
        }
        PlanComparison()
    }

    /// A Premium account's plan: the mark and thanks, the membership, what Premium includes,
    /// and Restore purchases.
    @ViewBuilder
    private func member(_ plan: Plan) -> some View {
        VStack(spacing: 6) {
            PlanMark()
                .padding(.bottom, 6)
            Text(PlanText.onPremium)
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text(PlanText.thanks)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        let membership = Self.membership(plan)
        let manage = Self.manage(plan, storefront: storefront, portalURL: portalURL)
        if membership != nil || manage != nil {
            MembershipCard(membership: membership, manage: manage)
        }
        IncludedList()
        if let purchase {
            VStack(spacing: 4) {
                restoreButton(purchase)
                if let line = Self.restoreLine(purchase) {
                    Text(line)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .font(.footnote)
            .frame(maxWidth: .infinity)
        }
    }

    private func tiles(_ offers: [PurchaseOffer], purchase: PurchaseModel) -> some View {
        PeriodTiles(
            options: Self.options(offers),
            period: Binding {
                Self.chosen(purchase.period, in: offers)
            } set: {
                purchase.period = $0
            })
    }

    /// The choice, Subscribe, and disclosures, at the end of the sheet's scrolling page, where
    /// they never cover the comparison.
    private func inlineActions(_ sale: Sale) -> some View {
        let line = Self.outcomeLine(sale, line: purchase?.line)
        return VStack(alignment: Self.actionsAlignment, spacing: 16) {
            switch (sale, purchase) {
            case (.choice(let offers), let purchase?):
                tiles(offers, purchase: purchase)
                subscribeButton(purchase)
                if let line {
                    paragraph(line)
                }
                terms(sale, purchase: purchase)
            case (.loading, let purchase?):
                PrimaryAction { WaitingSubscribeButton() }
                if let line {
                    paragraph(line)
                }
                terms(sale, purchase: purchase)
            case (.subscribed, _):
                if let line {
                    paragraph(line)
                }
                #if !os(macOS)
                    // The Mac's toolbar Close reads as a button; the phone's glass xmark is easy to miss.
                    PrimaryAction { Button(Self.close) { dismiss() } }
                #endif
            case (.offline, _), (.notSelling, _), (.choice, nil), (.loading, nil):
                if let line {
                    paragraph(line).foregroundStyle(.secondary)
                }
                if let purchase {
                    terms(sale, purchase: purchase)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: Self.actionsAlignment, vertical: .center))
        #if !os(macOS)
            .padding(.top, 16)
        #endif
    }

    #if os(macOS)
        private static let actionsAlignment = HorizontalAlignment.leading
    #else
        private static let actionsAlignment = HorizontalAlignment.center
    #endif

    private func paragraph(_ text: String) -> some View {
        Text(text)
            #if !os(macOS)
                .font(.footnote)
                .multilineTextAlignment(.center)
            #endif
            .fixedSize(horizontal: false, vertical: true)
    }

    private func subscribeButton(_ purchase: PurchaseModel) -> some View {
        PrimaryAction {
            Button(PlanText.subscribe) {
                Task { await Self.subscribe(purchase, from: entry) }
            }
            .disabled(purchase.isWorking)
        }
    }

    /// The terms a sale shows, with Restore purchases beside the legal links; Restore alone
    /// while nothing is sold, and nothing once a purchase settles.
    @ViewBuilder
    private func terms(_ sale: Sale, purchase: PurchaseModel) -> some View {
        if case .choice = sale {
            RenewalTerms { restoreButton(purchase) }
        } else if Self.offersRestore(sale) {
            restoreButton(purchase).font(.footnote)
        }
    }

    private func restoreButton(_ purchase: PurchaseModel) -> some View {
        Button(PlanText.restorePurchases) {
            Task { await purchase.restore() }
        }
        .disabled(purchase.isWorking)
        #if os(macOS)
            .buttonStyle(.link)
        #else
            .buttonStyle(.borderless)
        #endif
    }

    private func readScanTuneTitle() async {
        guard reason == .scans, let store, let tuneID = plan?.scanTune else { return }
        scanTuneTitle = try? await store.read { db in
            try Tune.fetchOne(db, key: tuneID).flatMap { $0.deletedAt == nil ? $0.title : nil }
        }
    }
}

/// The sheet's one prominent button: large and slate, and full width off the Mac.
private struct PrimaryAction<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        #if os(macOS)
            content
                .buttonStyle(.slateProminent)
                .controlSize(.large)
        #else
            content
                .buttonStyle(SheetPrimaryButtonStyle())
                .fontWeight(.semibold)
                .controlSize(.large)
        #endif
    }
}

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

/// The CT mark heading the sheet: a slate C on light, a white C on dark, and the coral T on both.
private struct PlanMark: View {
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .title) private var height: CGFloat = 40

    var body: some View {
        Mark()
            .frame(height: height)
            .foregroundStyle(scheme == .dark ? Color.white : BrandStyle.accent)
            .accessibilityHidden(true)
    }
}

/// Presents the Plan sheet whenever the presenter asks for it.
struct PlanSheets: ViewModifier {
    let presenter: PremiumPresenter?
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?

    /// One showing of the sheet, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let reason: PremiumReason
        let entry: PremiumEntry
        var id: PremiumReason { reason }
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: shown) { showing in
                PlanSheet(reason: showing.reason, entry: showing.entry, purchase: purchase)
            }
    }

    private var shown: Binding<Showing?> {
        Binding {
            guard let presenter, let reason = presenter.presented, let entry = presenter.presentedFrom else {
                return nil
            }
            return Showing(reason: reason, entry: entry)
        } set: {
            presenter?.presented = $0?.reason
        }
    }
}
