import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import SwiftUI

/// What a free account tapped that Premium holds, and the way to the Plan group. Where the
/// store can sell, it offers Annual or Monthly and Subscribe.
struct PremiumSheet: View {
    nonisolated static let close = "Close"

    let reason: PremiumReason
    /// Where the sheet was opened from, which a purchase reports.
    let entry: PremiumEntry
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    let onSeePlan: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.plan) private var plan
    @Environment(\.store) private var store
    @State private var scanTuneTitle: String?
    @State private var detent: PresentationDetent

    init(
        reason: PremiumReason, entry: PremiumEntry, purchase: PurchaseModel?, mayOfferPurchase: Bool = false,
        onSeePlan: @escaping @MainActor () -> Void
    ) {
        self.reason = reason
        self.entry = entry
        self.purchase = purchase
        self.onSeePlan = onSeePlan
        _detent = State(initialValue: Self.openingDetent(mayOfferPurchase: mayOfferPurchase))
    }

    /// What the sheet offers to buy.
    enum Sale: Equatable {
        /// No Subscribe: the Plan link is the primary action.
        case notSelling
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

    nonisolated static func title(_ reason: PremiumReason) -> String {
        switch reason {
        case .recordings: PlanText.premiumRecordingsTitle
        case .scans: PlanText.premiumScansTitle
        case .plan: PlanText.premiumPlanTitle
        }
    }

    /// The body for `reason`, nil for scans until the scan tune's title is read.
    nonisolated static func message(_ reason: PremiumReason, scanTuneTitle: String?) -> String? {
        switch reason {
        case .recordings: PlanText.premiumRecordingsBody
        case .scans: scanTuneTitle.map { PlanText.premiumScansBody(tuneTitle: $0) }
        case .plan: PlanText.premiumPlanBody
        }
    }

    /// The product's name and what it holds, which a sheet that sells adds under a gate's own
    /// title and body. Nil for the plan's sheet, which opens with them.
    nonisolated static func product(_ reason: PremiumReason) -> (title: String, body: String)? {
        reason == .plan ? nil : (PlanText.premiumPlanTitle, PlanText.premiumPlanBody)
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
        case .loading: return .notSelling
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

    /// One row of the period choice: the period and what it costs.
    struct PeriodOption: Equatable {
        let period: PurchasePeriod
        let label: String
        let price: String
    }

    /// A row for each period the store sells, Annual first, each with its price.
    nonisolated static func options(_ offers: [PurchaseOffer]) -> [PeriodOption] {
        choices(offers).map { PeriodOption(period: $0.period, label: periodLabel($0.period), price: priceLine($0)) }
    }

    /// The line a settled sheet shows: the restore's after a restore, otherwise the purchase's.
    nonisolated static func settledLine(_ line: PurchaseModel.Line?) -> String {
        PlanText.line(line == .restored ? .restored : .subscribed)
    }

    /// Whether See your plan is the primary action: whenever nothing is for sale.
    nonisolated static func seePlanLeads(_ sale: Sale) -> Bool {
        switch sale {
        case .notSelling, .offline: true
        case .choice, .subscribed: false
        }
    }

    /// Whether Restore purchases shows. After a purchase, a restore could replace its line and
    /// bring Subscribe back before the sync lands.
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

    nonisolated static func priceLine(_ offer: PurchaseOffer) -> String {
        switch offer.period {
        case .annual: PlanText.annualPrice(offer.price)
        case .monthly: PlanText.monthlyPrice(offer.price)
        }
    }

    /// The terms under the price. A trial's rest is not added on, so it says billing starts now.
    nonisolated static func terms(_ plan: Plan) -> [String] {
        return plan.isTrial
            ? [PlanText.renewsUntilCancelled, PlanText.billingStartsToday] : [PlanText.renewsUntilCancelled]
    }

    /// Buys the chosen period, or the one the store sells when it sells only one.
    static func subscribe(_ purchase: PurchaseModel, from entry: PremiumEntry) async {
        if case .ready(let offers) = purchase.offers {
            purchase.period = chosen(purchase.period, in: offers)
        }
        await purchase.buy(from: entry)
    }

    /// Room to grow, so the sheet's words never clip at the largest text sizes.
    nonisolated static let detents: Set<PresentationDetent> = [.medium, .large]

    /// Full height when the sheet can sell, since the choice and its disclosures fill a phone.
    nonisolated static func openingDetent(mayOfferPurchase: Bool) -> PresentationDetent {
        mayOfferPurchase ? .large : .medium
    }

    var body: some View {
        let currentPlan = plan?.plan ?? .unknown
        let sale = Self.sale(plan: currentPlan, offers: purchase?.offers, line: purchase?.line)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(Self.title(reason))
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                        .fixedSize(horizontal: false, vertical: true)
                    if let message = Self.message(reason, scanTuneTitle: scanTuneTitle) {
                        // The scans body names a tune.
                        Text(message)
                            .contentMask()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    switch (sale, purchase) {
                    case (.choice(let offers), let purchase?):
                        product
                        choice(offers, purchase: purchase, plan: currentPlan)
                    case (.subscribed, _):
                        product
                    case (.offline, _), (.notSelling, _), (.choice, nil):
                        if sale == .offline {
                            paragraph(PlanText.subscribeOffline).foregroundStyle(.secondary)
                        }
                    }
                    if !PageStyle.pinsSheetActions {
                        inlineActions(sale)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .sheetActions(line: Self.pinnedLine(sale, line: purchase?.line)) {
                switch (sale, purchase) {
                case (.choice, let purchase?): subscribeButton(purchase)
                case (.subscribed, _): Button(Self.close) { dismiss() }
                case (.offline, _), (.notSelling, _): seePlanButton
                case (.choice, nil): EmptyView()
                }
            } secondary: {
                if !Self.seePlanLeads(sale) {
                    seePlanButton
                }
                restoreButton(sale)
            } footer: {
                if case .choice = sale, purchase != nil {
                    links
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(Self.close) { dismiss() }
                }
            }
        }
        .task(id: plan?.scanTune) { await readScanTuneTitle() }
        // Asks again when the connection comes back.
        .task(id: purchase?.isOffline) { await purchase?.loadOffers() }
        .macSheetFrame(.form(minHeight: 220))
        .presentationDetents(Self.detents, selection: $detent)
        .shellSheet()
    }

    @ViewBuilder private var product: some View {
        if let product = Self.product(reason) {
            Text(product.title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            paragraph(product.body)
        }
    }

    private func paragraph(_ text: String) -> some View {
        Text(text).fixedSize(horizontal: false, vertical: true)
    }

    /// The period to buy and its terms.
    @ViewBuilder
    private func choice(_ offers: [PurchaseOffer], purchase: PurchaseModel, plan: Plan) -> some View {
        PeriodChoice(
            options: Self.options(offers),
            period: Binding {
                Self.chosen(purchase.period, in: offers)
            } set: {
                purchase.period = $0
            })
        ForEach(Self.terms(plan), id: \.self) { term in
            Text(term)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The actions in the sheet's own content, where they do not pin to its bottom edge.
    @ViewBuilder
    private func inlineActions(_ sale: Sale) -> some View {
        switch (sale, purchase) {
        case (.choice, let purchase?):
            subscribeButton(purchase)
                .buttonStyle(.slateProminent)
            if let line = purchase.line {
                paragraph(PlanText.line(line))
            }
            seePlanAndRestore(sale)
            links
        case (.subscribed, _):
            paragraph(Self.settledLine(purchase?.line))
            Button(Self.close) { dismiss() }
                .buttonStyle(.slateProminent)
            seePlanAndRestore(sale)
        case (.offline, _), (.notSelling, _), (.choice, nil):
            seePlanAndRestore(sale)
        }
    }

    /// The line above pinned actions: the outcome while the store sells, the settled line once
    /// subscribed, and otherwise a restore's outcome.
    nonisolated static func pinnedLine(_ sale: Sale, line: PurchaseModel.Line?) -> String? {
        switch sale {
        case .choice: line.map(PlanText.line)
        case .subscribed: settledLine(line)
        case .offline, .notSelling: offersRestore(sale) ? line.map(PlanText.line) : nil
        }
    }

    private func subscribeButton(_ purchase: PurchaseModel) -> some View {
        Button(PlanText.subscribe) {
            Task { await Self.subscribe(purchase, from: entry) }
        }
        .disabled(purchase.isWorking)
    }

    private var seePlanButton: some View {
        Button(PlanText.seePlan, action: onSeePlan)
    }

    @ViewBuilder
    private func restoreButton(_ sale: Sale) -> some View {
        if let purchase, Self.offersRestore(sale) {
            Button(PlanText.restorePurchases) {
                Task { await purchase.restore() }
            }
            .disabled(purchase.isWorking)
        }
    }

    private var links: some View {
        HStack(spacing: 16) {
            ForEach(Self.links, id: \.url) { link in
                Link(link.label, destination: link.url)
            }
        }
        .font(.footnote)
    }

    /// See your plan, prominent when nothing is for sale, then Restore purchases where the
    /// build offers purchases.
    @ViewBuilder
    private func seePlanAndRestore(_ sale: Sale) -> some View {
        let primary = Self.seePlanLeads(sale)
        if primary {
            seePlanButton
                .buttonStyle(.slateProminent)
        } else {
            seePlanButton
        }
        restoreButton(sale)
        // In the choice, a line sits under Subscribe instead.
        if let purchase, Self.offersRestore(sale), primary, let line = purchase.line {
            paragraph(PlanText.line(line))
        }
    }

    private func readScanTuneTitle() async {
        guard reason == .scans, let store, let tuneID = plan?.scanTune else { return }
        scanTuneTitle = try? await store.read { db in
            try Tune.fetchOne(db, key: tuneID).flatMap { $0.deletedAt == nil ? $0.title : nil }
        }
    }
}

/// Annual or Monthly, each row with its price: radio buttons on the Mac, checkmark rows
/// elsewhere, since a system segment holds a word but not a price beside it.
private struct PeriodChoice: View {
    let options: [PremiumSheet.PeriodOption]
    @Binding var period: PurchasePeriod

    var body: some View {
        #if os(macOS)
            Picker(PlanText.billingPeriod, selection: $period) {
                ForEach(options, id: \.period) { option in
                    optionLabel(option).tag(option.period)
                }
            }
            .pickerStyle(.radioGroup)
        #else
            VStack(alignment: .leading, spacing: 8) {
                Text(PlanText.billingPeriod)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                VStack(spacing: 0) {
                    ForEach(options, id: \.period) { option in
                        let selected = option.period == period
                        Button {
                            period = option.period
                        } label: {
                            HStack {
                                optionLabel(option)
                                Spacer()
                                if selected {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.tint)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        if option.period != options.last?.period {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(PlanText.billingPeriod)
        #endif
    }

    private func optionLabel(_ option: PremiumSheet.PeriodOption) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(option.label)
            Text(option.price)
                .foregroundStyle(.secondary)
        }
    }
}

/// Presents the Premium sheet whenever the presenter asks for it.
struct PremiumSheets: ViewModifier {
    let presenter: PremiumPresenter?
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    let onSeePlan: @MainActor () -> Void

    /// One showing of the sheet, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let reason: PremiumReason
        let entry: PremiumEntry
        var id: PremiumReason { reason }
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: shown) { showing in
                PremiumSheet(
                    reason: showing.reason, entry: showing.entry, purchase: purchase,
                    mayOfferPurchase: presenter?.mayOfferPurchase ?? false, onSeePlan: onSeePlan)
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
