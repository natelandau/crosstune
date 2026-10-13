import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private let offers = [
    PurchaseOffer(period: .annual, price: "A$1", amount: 49.99),
    PurchaseOffer(period: .monthly, price: "M$1", amount: 4.99),
]

private let day: TimeInterval = 86_400
private let instant = noon.date
private let portal = URL(string: "https://billing.example.com/portal")!

@MainActor
@Suite struct PlanSheetTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    @Test func aFreeOrTrialPlanSellsAndAPremiumPlanIsAMember() {
        #expect(PlanSheet.mode(Plan(kind: .free)) == .selling)
        #expect(PlanSheet.mode(Plan(kind: .premium, source: .trial, trialEndsAt: instant)) == .selling)
        #expect(PlanSheet.mode(Plan(kind: .premium, source: .comp)) == .member)
        #expect(PlanSheet.mode(Plan(kind: .premium, source: .apple)) == .member)
        #expect(PlanSheet.mode(Plan(kind: .premium, source: .stripe)) == .member)
        // A plan not yet read sells nothing, but is not taken for a member either.
        #expect(PlanSheet.mode(.unknown) == .selling)
        #expect(PlanSheet.sale(plan: .unknown, offers: .ready(offers), line: nil) == .notSelling)
    }

    @Test func thePlanReasonLeadsWithThePitch() {
        let headline = PlanSheet.headline(.plan, scanTuneTitle: nil)
        #expect(headline.title == PlanText.premiumPlanTitle)
        #expect(headline.body == PlanText.premiumPitch)
    }

    @Test func aLockedTapLeadsWithWhatWasTapped() {
        let recordings = PlanSheet.headline(.recordings, scanTuneTitle: nil)
        #expect(recordings.title == PlanText.premiumRecordingsTitle)
        #expect(recordings.body == PlanText.premiumRecordingsBody)
        // The scans body waits for the scan tune's title.
        let unread = PlanSheet.headline(.scans, scanTuneTitle: nil)
        #expect(unread.title == PlanText.premiumScansTitle)
        #expect(unread.body == nil)
        let scans = PlanSheet.headline(.scans, scanTuneTitle: "Kitchen Girl")
        #expect(scans.body == PlanText.premiumScansBody(tuneTitle: "Kitchen Girl"))
    }

    @Test func theComparisonListsTheSpecsRowsInOrder() {
        #expect(
            PlanSheet.comparison == [
                .init(title: PlanText.featureCatalog, free: .included, premium: .included, symbol: "music.note.list"),
                .init(
                    title: PlanText.featureSync, free: .included, premium: .included,
                    symbol: "arrow.triangle.2.circlepath"),
                .init(title: PlanText.featureRecord, free: .excluded, premium: .included, symbol: "record.circle"),
                .init(title: PlanText.featurePlay, free: .excluded, premium: .included, symbol: "play"),
                .init(
                    title: PlanText.featurePractice, free: .excluded, premium: .included, symbol: "slider.horizontal.3"),
                .init(
                    title: PlanText.featureScans, free: .value(PlanText.scansFree),
                    premium: .value(PlanText.scansPremium), symbol: "doc.richtext"),
                .init(
                    title: PlanText.featureStorage, free: .value(PlanText.storageFree),
                    premium: .value(PlanText.storagePremium), symbol: "icloud"),
            ])
    }

    @Test func aRowInBothListsWearsTheSameSymbolInEach() {
        let comparison = Dictionary(uniqueKeysWithValues: PlanSheet.comparison.map { ($0.title, $0.symbol) })
        let included = Dictionary(uniqueKeysWithValues: PlanSheet.included.map { ($0.title, $0.symbol) })
        #expect(comparison[PlanText.featureRecord] == included[PlanText.includedRecord])
        #expect(comparison[PlanText.featurePractice] == included[PlanText.includedPractice])
        #expect(comparison[PlanText.featureScans] == included[PlanText.includedScans])
        #expect(comparison[PlanText.featureStorage] == included[PlanText.includedEveryDevice])
    }

    /// A trial's progress `started` days ago, ending `ends` days from now.
    private func progress(started: Double, ends: Double) -> Double {
        PlanSheet.trialProgress(
            startsAt: instant.addingTimeInterval(-started * day), endsAt: instant.addingTimeInterval(ends * day),
            now: instant)
    }

    @Test func aTrialsProgressMeasures14_30And60DayTrialsByTheirOwnLength() {
        #expect(progress(started: 0, ends: 14) == 0)
        #expect(progress(started: 7, ends: 7) == 0.5)
        #expect(progress(started: 15, ends: 15) == 0.5)
        #expect(progress(started: 30, ends: 0) == 1)
        #expect(progress(started: 15, ends: 45) == 0.25)
    }

    @Test func aTrialsProgressClampsToTheTrial() {
        #expect(progress(started: -1, ends: 31) == 0)
        #expect(progress(started: 31, ends: -1) == 1)
    }

    @Test func aTrialsProgressIsZeroWithoutBothDatesOrAnEndAfterTheStart() {
        #expect(PlanSheet.trialProgress(startsAt: nil, endsAt: instant.addingTimeInterval(14 * day), now: instant) == 0)
        #expect(PlanSheet.trialProgress(startsAt: instant.addingTimeInterval(-day), endsAt: nil, now: instant) == 0)
        #expect(PlanSheet.trialProgress(startsAt: nil, endsAt: nil, now: instant) == 0)
        #expect(progress(started: 1, ends: -1) == 0)
    }

    @Test func annualCarriesTheSavingAndMonthlyDoesNot() {
        #expect(
            PlanSheet.options(offers.reversed()) == [
                .init(period: .annual, label: PlanText.periodAnnual, amount: "A$1", badge: PlanText.save(17)),
                .init(period: .monthly, label: PlanText.periodMonthly, amount: "M$1", badge: nil),
            ])
    }

    @Test func aTileShowsTheStoresAmountAndItsPeriod() {
        let options = PlanSheet.options(offers)
        #expect(options.map(\.amount) == ["A$1", "M$1"])
        #expect(options.map(\.per) == ["a year", "a month"])
        #expect(options.map(\.price) == ["A$1 a year", "M$1 a month"])
        // The store's price is shown as it formats it, spaces and all.
        let euro = PlanSheet.options([PurchaseOffer(period: .monthly, price: "4,99 €", amount: 4.99)])
        #expect(euro.map(\.amount) == ["4,99 €"])
        #expect(euro.map(\.per) == ["a month"])
    }

    @Test func oneSoldPeriodShowsOneTileAndNoSaving() {
        #expect(
            PlanSheet.options([offers[1]]) == [
                .init(period: .monthly, label: PlanText.periodMonthly, amount: "M$1", badge: nil)
            ])
        #expect(
            PlanSheet.options([offers[0]]) == [
                .init(period: .annual, label: PlanText.periodAnnual, amount: "A$1", badge: nil)
            ])
    }

    @Test func aPurchaseHoldsTheSettledLineUntilThePlanTurnsPremium() {
        let trial = Plan(kind: .premium, source: .trial, trialEndsAt: instant.addingTimeInterval(day))
        let sale = PlanSheet.sale(plan: trial, offers: .ready(offers), line: .subscribed)
        #expect(sale == .subscribed)
        #expect(PlanSheet.outcomeLine(sale, line: .subscribed) == PlanText.subscribed)
        #expect(PlanSheet.mode(trial) == .selling)
        // Once the sync lands, the sheet confirms the plan instead.
        #expect(PlanSheet.mode(Plan(kind: .premium, source: .apple)) == .member)
    }

    @Test func theSheetSellsOnlyWithReadyOffers() {
        let free = Plan(kind: .free)
        #expect(PlanSheet.sale(plan: free, offers: .ready(offers), line: nil) == .choice(offers))
        #expect(
            PlanSheet.sale(plan: Plan(kind: .premium, source: .trial), offers: .ready(offers), line: nil)
                == .choice(offers))
        #expect(PlanSheet.sale(plan: free, offers: .loading, line: nil) == .loading)
        #expect(PlanSheet.sale(plan: free, offers: .ready([]), line: nil) == .notSelling)
        #expect(PlanSheet.sale(plan: free, offers: nil, line: nil) == .notSelling)
        let comp = Plan(kind: .premium, source: .comp)
        #expect(PlanSheet.sale(plan: comp, offers: .ready(offers), line: nil) == .notSelling)
        #expect(PlanSheet.sale(plan: comp, offers: .unavailable, line: nil) == .notSelling)
        #expect(PlanSheet.sale(plan: free, offers: .unavailable, line: nil) == .offline)
        // A line from an earlier try keeps the choice up for another.
        #expect(PlanSheet.sale(plan: free, offers: .ready(offers), line: .failed) == .choice(offers))
    }

    @Test func aPurchaseReplacesTheChoiceWithItsLine() {
        // The plan may turn Premium before the sheet closes; the line stays.
        let premium = Plan(kind: .premium, source: .apple)
        #expect(PlanSheet.sale(plan: premium, offers: .ready(offers), line: .subscribed) == .subscribed)
        #expect(PlanText.line(.subscribed) == PlanText.subscribed)
        #expect(PlanText.line(.pending) == PlanText.subscribePending)
        #expect(PlanText.line(.failed) == PlanText.subscribeFailed)
        #expect(PlanText.line(.restored) == PlanText.restored)
        #expect(PlanText.line(.nothingToRestore) == PlanText.nothingToRestore)
        #expect(PlanText.line(.otherAccount) == PlanText.otherAccount)
        #expect(PlanText.line(.restoreFailed) == PlanText.restoreFailed)
    }

    @Test func aRestoreSettlesTheSheetAsAPurchaseDoes() {
        // Until the sync turns the plan Premium, the sheet must not sell under the restored line.
        let free = Plan(kind: .free)
        #expect(PlanSheet.sale(plan: free, offers: .ready(offers), line: .restored) == .subscribed)
        #expect(PlanSheet.sale(plan: free, offers: .unavailable, line: .restored) == .subscribed)
        let premium = Plan(kind: .premium, source: .apple)
        #expect(PlanSheet.sale(plan: premium, offers: .ready(offers), line: .restored) == .subscribed)
        #expect(PlanSheet.settledLine(.restored) == PlanText.restored)
        #expect(PlanSheet.settledLine(.subscribed) == PlanText.subscribed)
        // A restore that found nothing leaves the choice up.
        #expect(PlanSheet.sale(plan: free, offers: .ready(offers), line: .nothingToRestore) == .choice(offers))
    }

    @Test func theOutcomeLineIsTheOutcomeOrTheSettledLine() {
        #expect(PlanSheet.outcomeLine(.choice(offers), line: nil) == nil)
        #expect(PlanSheet.outcomeLine(.choice(offers), line: .failed) == PlanText.line(.failed))
        #expect(PlanSheet.outcomeLine(.subscribed, line: .restored) == PlanText.restored)
        #expect(PlanSheet.outcomeLine(.subscribed, line: .subscribed) == PlanText.subscribed)
        #expect(PlanSheet.outcomeLine(.offline, line: nil) == PlanText.subscribeOffline)
        // A restore tried while offline says how it went in place of the offline line.
        #expect(PlanSheet.outcomeLine(.offline, line: .restoreFailed) == PlanText.line(.restoreFailed))
        #expect(PlanSheet.outcomeLine(.notSelling, line: nil) == nil)
        #expect(PlanSheet.outcomeLine(.notSelling, line: .restoreFailed) == PlanText.line(.restoreFailed))
    }

    @Test func whileTheStoreAnswersSubscribesPlaceIsHeld() {
        let free = Plan(kind: .free)
        let trial = Plan(kind: .premium, source: .trial, trialEndsAt: instant.addingTimeInterval(day))
        #expect(PlanSheet.sale(plan: free, offers: .loading, line: nil) == .loading)
        #expect(PlanSheet.sale(plan: trial, offers: .loading, line: nil) == .loading)
        // Only a plan that can subscribe waits for the store.
        #expect(PlanSheet.sale(plan: Plan(kind: .premium, source: .comp), offers: .loading, line: nil) == .notSelling)
        #expect(PlanSheet.sale(plan: .unknown, offers: .loading, line: nil) == .notSelling)
        #expect(PlanSheet.sale(plan: free, offers: .loading, line: .subscribed) == .subscribed)
        #expect(PlanSheet.outcomeLine(.loading, line: nil) == nil)
        #expect(PlanSheet.outcomeLine(.loading, line: .restoreFailed) == PlanText.line(.restoreFailed))
    }

    @Test func onlyASellingSheetForAPlanThatCanSubscribeAsksForOffers() {
        #expect(PlanSheet.asksForOffers(Plan(kind: .free)))
        #expect(PlanSheet.asksForOffers(Plan(kind: .premium, source: .trial, trialEndsAt: instant)))
        for plan in [Plan(kind: .premium, source: .apple), Plan(kind: .premium, source: .stripe), comp, .unknown] {
            #expect(PlanSheet.asksForOffers(plan) == false)
        }
    }

    @Test func restoreShowsUntilAPurchaseSettles() {
        // Restore leaves Settings, so the sheet offers it whether or not the store sells.
        #expect(PlanSheet.offersRestore(.choice(offers)))
        #expect(PlanSheet.offersRestore(.loading))
        #expect(PlanSheet.offersRestore(.offline))
        #expect(PlanSheet.offersRestore(.notSelling))
        // After a purchase, a restore could replace its line and bring Subscribe back.
        #expect(PlanSheet.offersRestore(.subscribed) == false)
    }

    /// Nothing pins on any platform, so the comparison is never covered; the choice and
    /// Subscribe close the scrolling page.
    @Test func thePlanSheetPinsNothing() throws {
        let source = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Plan/PlanSheet.swift")))
        #expect(!source.contains(".sheetActions("))
    }

    @Test func annualIsTheDefault() {
        let model = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        #expect(model.period == .annual)
        #expect(PlanSheet.options(offers.reversed()).map(\.period) == [.annual, .monthly])
        #expect(PlanSheet.chosen(.annual, in: offers) == .annual)
        // A store that sells one period has it chosen.
        #expect(PlanSheet.chosen(.annual, in: [offers[1]]) == .monthly)
    }

    @Test func subscribeBuysTheChosenPeriod() async {
        let client = FakePurchaseClient()
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        model.period = .monthly
        await PlanSheet.subscribe(model, from: .record)

        #expect(client.purchased == [.monthly])
    }

    @Test func subscribeBuysTheOnePeriodTheStoreSells() async {
        let client = FakePurchaseClient()
        client.offersResult = .success([offers[1]])
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        await PlanSheet.subscribe(model, from: .record)

        #expect(client.purchased == [.monthly])
    }

    @Test func theDisclosuresAreThere() throws {
        #expect(PlanSheet.periodLabel(.annual) == PlanText.periodAnnual)
        #expect(PlanSheet.periodLabel(.monthly) == PlanText.periodMonthly)
        #expect(PlanSheet.priceLine(offers[0].price, period: offers[0].period) == "A$1 a year")
        #expect(PlanSheet.priceLine(offers[1].price, period: offers[1].period) == "M$1 a month")
        #expect(
            PlanSheet.links == [
                .init(label: PlanText.termsOfUse, url: try #require(URL(string: "https://crosstune.app/terms"))),
                .init(label: PlanText.privacyPolicy, url: try #require(URL(string: "https://crosstune.app/privacy"))),
            ])
    }

    @Test func aPurchaseReportsWhereTheSheetCameFrom() async throws {
        let store = try root.open()
        try await store.write { writer in
            try Entitlement(id: "entitlement-1", createdAt: noon, premiumQuotaBytes: 10_000, freeQuotaBytes: 1_000)
                .upsert(writer.db)
        }
        let plan = PlanModel(store: store)
        #expect(try await poll { plan.isLoaded && plan.plan.kind == .free })
        let presenter = PremiumPresenter(plan: plan, analytics: sink.client)
        let model = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        _ = presenter.gate(.recordings, from: .record)
        await PlanSheet.subscribe(model, from: try #require(presenter.presentedFrom))

        #expect(
            sink.captures.contains(
                .init(name: "purchase_started", properties: ["period": .string("annual"), "from": .string("record")])))
    }

    @Test func theSheetOpensAtFullHeight() {
        #expect(PlanSheet.detents == [.large])
    }

    // MARK: Member

    private let apple = Plan(kind: .premium, source: .apple)
    private let stripe = Plan(kind: .premium, source: .stripe)
    private let comp = Plan(kind: .premium, source: .comp)

    /// The manage action for a web subscriber on the fake store's storefront.
    private func stripeManage(storefront: String?, portalURL: URL?) async -> [PlanSheet.Manage] {
        let client = FakePurchaseClient()
        client.storefront = storefront
        let read = await PlanSheet.storefront(for: stripe, client: client)
        return PlanSheet.manage(stripe, storefront: .read(read), portalURL: portalURL)
    }

    @Test func anAppStoreSubscriberManagesInAppStoreSettings() {
        #expect(PlanSheet.manage(apple, storefront: .read("USA"), portalURL: portal) == [.appStore])
        #expect(PlanSheet.manage(apple, storefront: .unread, portalURL: nil) == [.appStore])
    }

    @Test func aWebSubscriberInTheUSGetsTheLink() async {
        #expect(await stripeManage(storefront: "USA", portalURL: portal) == [.onTheWeb(portal)])
    }

    @Test func aWebSubscriberOutsideTheUSGetsNoLink() async {
        #expect(await stripeManage(storefront: "GBR", portalURL: portal) == [.atWebsite])
    }

    @Test func aWebSubscriberGetsNoLinkWithoutAPortalOrAStorefront() async {
        #expect(await stripeManage(storefront: "USA", portalURL: nil) == [.atWebsite])
        #expect(await stripeManage(storefront: nil, portalURL: portal) == [.atWebsite])
    }

    @Test func aWebSubscriberGetsNoManageActionUntilTheStorefrontIsRead() {
        #expect(PlanSheet.manage(stripe, storefront: .unread, portalURL: portal).isEmpty)
    }

    @Test func aCompATrialAndAFreePlanHaveNothingToManage() {
        for plan in [comp, Plan(kind: .premium, source: .trial), Plan(kind: .free), .unknown] {
            #expect(PlanSheet.manage(plan, storefront: .read("USA"), portalURL: portal).isEmpty)
        }
    }

    @Test func aCompStillBilledByBothStoresManagesEach() async {
        let both = Plan(kind: .premium, source: .comp, paidSources: [.stripe, .apple])
        #expect(await PlanSheet.storefront(for: both, client: FakePurchaseClient()) == "USA")
        #expect(
            PlanSheet.manage(both, storefront: .read("USA"), portalURL: portal) == [.appStore, .onTheWeb(portal)])
    }

    @Test func onlyAWebSubscriberReadsTheStorefront() async {
        let client = FakePurchaseClient()
        #expect(await PlanSheet.storefront(for: stripe, client: client) == "USA")
        for plan in [Plan(kind: .free), Plan(kind: .premium, source: .trial), apple, comp] {
            #expect(await PlanSheet.storefront(for: plan, client: client) == nil)
        }
        #expect(await PlanSheet.storefront(for: stripe, client: nil) == nil)
    }

    @Test func manageOpensAppleSubscriptionSettings() async {
        let client = FakePurchaseClient()

        await PlanSheet.showManage(client)

        #expect(client.manageShown == 1)
    }

    @Test func aCompShowsPremiumFromCrosstune() throws {
        let row = try #require(PlanSheet.membership(comp, now: instant))
        #expect(row.label == PlanText.compGrant)
        #expect(row.value == "")
    }

    @Test func aCompWithAnEndShowsItsEnd() throws {
        let ends = instant.addingTimeInterval(90 * day)
        let row = try #require(
            PlanSheet.membership(Plan(kind: .premium, source: .comp, premiumEndsAt: ends), now: instant))
        #expect(row.label == PlanText.ends)
        #expect(row.value == PlanText.day(ends))
    }

    @Test func aRenewingSubscriptionSaysRenewsAndALapsingOneSaysEnds() throws {
        let ends = instant.addingTimeInterval(30 * day)
        for source in [PlanSource.apple, .stripe] {
            let renewing = try #require(
                PlanSheet.membership(
                    Plan(kind: .premium, source: source, premiumEndsAt: ends, autoRenews: true), now: instant))
            #expect(renewing.label == PlanText.renews)
            #expect(renewing.value == PlanText.day(ends))
            let lapsing = try #require(
                PlanSheet.membership(
                    Plan(kind: .premium, source: source, premiumEndsAt: ends, autoRenews: false), now: instant))
            #expect(lapsing.label == PlanText.ends)
            #expect(lapsing.value == PlanText.day(ends))
        }
        // The next renewal is unknown during the offline leeway.
        let lapsed = instant.addingTimeInterval(-2 * day)
        #expect(
            PlanSheet.membership(
                Plan(kind: .premium, source: .stripe, premiumEndsAt: lapsed, autoRenews: true), now: instant) == nil)
        // Nothing to show for a plan the sheet sells to.
        #expect(PlanSheet.membership(Plan(kind: .free), now: instant) == nil)
        #expect(PlanSheet.membership(Plan(kind: .premium, source: .trial, premiumEndsAt: ends), now: instant) == nil)
    }

    @Test func theIncludedListNamesTheFourPremiumFeatures() {
        #expect(
            PlanSheet.included.map(\.title) == [
                PlanText.includedRecord, PlanText.includedEveryDevice, PlanText.includedPractice,
                PlanText.includedScans,
            ])
        #expect(
            PlanSheet.included.map(\.detail) == [
                PlanText.includedRecordDetail, PlanText.includedEveryDeviceDetail, PlanText.includedPracticeDetail,
                PlanText.includedScansDetail,
            ])
        #expect(PlanSheet.included.allSatisfy { !$0.symbol.isEmpty })
    }

    @Test func restoreShowsItsLineUnderIt() async {
        let client = FakePurchaseClient()
        client.restoreResult = .nothing
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)

        await model.restore()

        #expect(client.restores == 1)
        #expect(PlanSheet.restoreLine(model) == PlanText.nothingToRestore)
    }

    @Test func aLaterPurchaseLineIsNotShownUnderRestore() async {
        let client = FakePurchaseClient()
        client.restoreResult = .nothing
        client.purchaseResult = .failed
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.restore()

        await model.buy(from: .record)

        #expect(model.line == .failed)
        #expect(PlanSheet.restoreLine(model) == nil)
    }

    @Test func theSheetFollowsThePlanWhileOpen() async throws {
        let store = try root.open()
        let ends = Timestamp(instant.addingTimeInterval(10 * day))
        func write(_ source: String?) async throws {
            let row = Entitlement(
                id: "entitlement-1", createdAt: noon, premiumSource: source,
                premiumExpiresAt: source == nil ? nil : ends, autoRenews: source == "apple",
                trialStartsAt: Timestamp(instant.addingTimeInterval(-20 * day)), trialEndsAt: ends,
                premiumQuotaBytes: 10_000, freeQuotaBytes: 1_000)
            try await store.write { writer in try row.upsert(writer.db) }
        }
        try await write("trial")
        let plan = PlanModel(store: store, now: { instant })
        #expect(try await poll { plan.plan.isTrial })
        let presenter = PremiumPresenter(plan: plan, analytics: sink.client)
        presenter.present(.plan, from: .planGroup)
        #expect(PlanSheet.mode(plan.plan) == .selling)

        try await write("apple")
        #expect(try await poll { PlanSheet.mode(plan.plan) == .member })
        #expect(presenter.presented == .plan)

        // A refund lapses the grant: the row loses its source.
        try await write(nil)
        #expect(try await poll { plan.plan.kind == .free })
        #expect(PlanSheet.mode(plan.plan) == .selling)
        #expect(presenter.presented == .plan)
    }
}
