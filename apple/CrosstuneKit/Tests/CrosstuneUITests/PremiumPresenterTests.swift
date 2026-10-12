import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

private func entitlement(source: String?, expiresAt: Date? = nil) -> Entitlement {
    Entitlement(
        id: "entitlement-1", createdAt: noon, premiumSource: source, premiumExpiresAt: expiresAt.map(Timestamp.init),
        autoRenews: false, trialEndsAt: expiresAt.map(Timestamp.init), premiumQuotaBytes: 10_000,
        freeQuotaBytes: 1_000)
}

private let offers = [PurchaseOffer(period: .annual, price: "A$1"), PurchaseOffer(period: .monthly, price: "M$1")]

@MainActor
@Suite struct PremiumPresenterTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    /// A plan model over a store holding `row`, once it has judged the row.
    private func plan(_ row: Entitlement?, kind: PlanKind) async throws -> PlanModel {
        let store = try root.open()
        if let row { try await store.write { writer in try row.upsert(writer.db) } }
        let model = PlanModel(store: store)
        try await eventually { model.isLoaded && model.plan.kind == kind }
        return model
    }

    @Test func aFreePlanPresentsTheSheetInsteadOfActing() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .record) == false)
        #expect(presenter.presented == .recordings)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("record")])
            ])
    }

    @Test func presentingForgetsAnEarlierOutcomeBeforeTheSheetShows() async throws {
        let purchase = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        await purchase.restore()
        #expect(purchase.line == .restored)
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client, purchase: purchase)

        presenter.present(.plan, from: .planGroup)

        #expect(presenter.presented == .plan)
        #expect(purchase.line == nil)
    }

    @Test func aFreePlanGatesScansOffTheirTune() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        #expect(presenter.gate(.scans, from: .addScan) == false)
        #expect(presenter.presented == .scans)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown", properties: ["reason": .string("scans"), "from": .string("add_scan")])
            ])
    }

    @Test func aTrialActsAndSendsNothing() async throws {
        let ends = Date().addingTimeInterval(86_400)
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: "trial", expiresAt: ends), kind: .premium), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .upload) == true)
        #expect(presenter.gate(.scans, from: .scan) == true)
        #expect(presenter.presented == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func anUnknownPlanGatesNothing() async throws {
        let store = try root.open()
        let presenter = PremiumPresenter(plan: PlanModel(store: store), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .addToRecordings) == true)
        #expect(presenter.presented == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func sendsOncePerPresentation() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        _ = presenter.gate(.recordings, from: .record)
        // A second tap while the sheet is still up shows nothing new.
        _ = presenter.gate(.recordings, from: .record)
        #expect(sink.captures.count == 1)
        presenter.presented = nil
        _ = presenter.gate(.recordings, from: .upload)
        #expect(sink.captures.count == 2)
    }

    @Test func theCopyMatchesTheWeb() throws {
        let web = try webCopy("web/src/features/plan/planCopy.ts")
        let shared: [(String, String)] = [
            ("PLAN_GROUP", PlanText.group),
            ("PLAN_FREE", PlanText.free),
            ("PLAN_PREMIUM", PlanText.premium),
            ("PLAN_TRIAL", PlanText.trial),
            ("FREE_HELP", PlanText.freeHelp),
            ("FREE_STORAGE_HELP", PlanText.freeStorageHelp),
            ("PREMIUM_RECORDINGS_TITLE", PlanText.premiumRecordingsTitle),
            ("PREMIUM_SCANS_TITLE", PlanText.premiumScansTitle),
            ("PREMIUM_RECORDINGS_BODY", PlanText.premiumRecordingsBody),
            ("SEE_PLAN", PlanText.seePlan),
            ("PREMIUM_PLAN_TITLE", PlanText.premiumPlanTitle),
            ("PREMIUM_PLAN_BODY", PlanText.premiumPlanBody),
            ("SUBSCRIBE", PlanText.subscribe),
            ("MANAGE_APP_STORE", PlanText.manageAppStore),
            ("PERIOD_ANNUAL", PlanText.periodAnnual),
            ("PERIOD_MONTHLY", PlanText.periodMonthly),
            ("BILLING_PERIOD", PlanText.billingPeriod),
            ("BILLING_STARTS_TODAY", PlanText.billingStartsToday),
            ("RENEWS_UNTIL_CANCELLED", PlanText.renewsUntilCancelled),
            ("SUBSCRIBE_OFFLINE", PlanText.subscribeOffline),
            ("SUBSCRIBED", PlanText.subscribed),
            ("SUBSCRIBE_FAILED", PlanText.subscribeFailed),
            ("APP_STORE_SUBSCRIPTIONS_URL", RevenueCatPurchases.appleSubscriptionsURL.absoluteString),
        ]
        for (name, value) in shared {
            let expected = try #require(web[name], "planCopy.ts has no constant \(name)")
            #expect(value == expected, "\(name)")
        }
        // The web builds these and the next from functions, so they are compared by shape.
        #expect(
            PlanText.premiumScansBody(tuneTitle: "Soldier's Joy")
                == "On the free plan, scans open on one tune, \"Soldier's Joy\". Pages on other tunes stay: you can delete or export them."
        )
        #expect(PlanText.annualPrice("$10") == "$10 a year")
        #expect(PlanText.monthlyPrice("$1") == "$1 a month")
    }

    @Test func seePlanOpensTheAccountPageFromTheSettingsRoot() {
        let place = ShellPlace()
        place.tab = .recordings
        place.showSettingsPage(.stats)

        place.showSettingsPage(.account)

        #expect(place.tab == .settings)
        #expect(place.settingsPage == .account)
        #expect(place.settingsPath.count == 1)
    }

    #if os(macOS)
        @Test func seePlanPicksTheAccountTab() throws {
            let defaults = try #require(UserDefaults(suiteName: "PremiumPresenterTests"))
            defer { defaults.removePersistentDomain(forName: "PremiumPresenterTests") }

            MacSettingsTabs.select(.account, in: defaults)

            #expect(defaults.string(forKey: MacSettingsTabs.tabStorageKey) == "account")
        }
    #endif

    @Test func presentShowsTheSheetFromAnEntry() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        presenter.present(.plan, from: .planGroup)
        #expect(presenter.presented == .plan)
        #expect(presenter.presentedFrom == .planGroup)
        // A second ask while the sheet is up shows nothing new.
        presenter.present(.plan, from: .trialEnded)
        #expect(presenter.presentedFrom == .planGroup)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown", properties: ["reason": .string("plan"), "from": .string("plan_group")])
            ])
    }

    @Test func closingTheSheetForgetsWhereItCameFrom() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        _ = presenter.gate(.recordings, from: .upload)
        #expect(presenter.presentedFrom == .upload)
        presenter.presented = nil
        #expect(presenter.presentedFrom == nil)
    }

    @Test func theSheetSellsOnlyWithReadyOffers() {
        let free = Plan(kind: .free)
        #expect(PremiumSheet.sale(plan: free, offers: .ready(offers), line: nil) == .choice(offers))
        #expect(
            PremiumSheet.sale(plan: Plan(kind: .premium, source: .trial), offers: .ready(offers), line: nil)
                == .choice(offers))
        #expect(PremiumSheet.sale(plan: free, offers: .loading, line: nil) == .notSelling)
        #expect(PremiumSheet.sale(plan: free, offers: .ready([]), line: nil) == .notSelling)
        #expect(PremiumSheet.sale(plan: free, offers: nil, line: nil) == .notSelling)
        #expect(PremiumSheet.sale(plan: .unknown, offers: .ready(offers), line: nil) == .notSelling)
        let comp = Plan(kind: .premium, source: .comp)
        #expect(PremiumSheet.sale(plan: comp, offers: .ready(offers), line: nil) == .notSelling)
        #expect(PremiumSheet.sale(plan: comp, offers: .unavailable, line: nil) == .notSelling)
        #expect(PremiumSheet.sale(plan: free, offers: .unavailable, line: nil) == .offline)
        // A line from an earlier try keeps the choice up for another.
        #expect(PremiumSheet.sale(plan: free, offers: .ready(offers), line: .failed) == .choice(offers))
    }

    @Test func aPurchaseReplacesTheChoiceWithItsLine() {
        // The plan may turn Premium before the sheet closes; the line stays.
        let premium = Plan(kind: .premium, source: .apple)
        #expect(PremiumSheet.sale(plan: premium, offers: .ready(offers), line: .subscribed) == .subscribed)
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
        #expect(PremiumSheet.sale(plan: free, offers: .ready(offers), line: .restored) == .subscribed)
        #expect(PremiumSheet.sale(plan: free, offers: .unavailable, line: .restored) == .subscribed)
        let premium = Plan(kind: .premium, source: .apple)
        #expect(PremiumSheet.sale(plan: premium, offers: .ready(offers), line: .restored) == .subscribed)
        #expect(PremiumSheet.settledLine(.restored) == PlanText.restored)
        #expect(PremiumSheet.settledLine(.subscribed) == PlanText.subscribed)
        // A restore that found nothing leaves the choice up.
        #expect(PremiumSheet.sale(plan: free, offers: .ready(offers), line: .nothingToRestore) == .choice(offers))
    }

    @Test func aGatesSheetNamesTheProductItSells() throws {
        for reason in [PremiumReason.recordings, .scans] {
            let product = try #require(PremiumSheet.product(reason))
            #expect(product.title == PlanText.premiumPlanTitle)
            #expect(product.body == PlanText.premiumPlanBody)
        }
        // The plan's own title and body already are the product's.
        #expect(PremiumSheet.product(.plan) == nil)
        #expect(PremiumSheet.title(.plan) == PlanText.premiumPlanTitle)
    }

    @Test func aPurchaseLeavesNoRestore() {
        // A restore could replace the subscribed line and bring Subscribe back before the sync.
        #expect(PremiumSheet.offersRestore(.subscribed) == false)
        #expect(PremiumSheet.offersRestore(.choice(offers)))
        #expect(PremiumSheet.offersRestore(.offline))
        #expect(PremiumSheet.offersRestore(.notSelling))
    }

    @Test func seePlanLeadsOnlyWhenNothingIsForSale() {
        #expect(PremiumSheet.seePlanLeads(.notSelling))
        #expect(PremiumSheet.seePlanLeads(.offline))
        #expect(PremiumSheet.seePlanLeads(.choice(offers)) == false)
        #expect(PremiumSheet.seePlanLeads(.subscribed) == false)
    }

    @Test func eachPeriodShowsItsPrice() {
        #expect(
            PremiumSheet.options(offers.reversed()) == [
                .init(period: .annual, label: PlanText.periodAnnual, price: "A$1 a year"),
                .init(period: .monthly, label: PlanText.periodMonthly, price: "M$1 a month"),
            ])
    }

    @Test func annualIsTheDefault() {
        let model = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        #expect(model.period == .annual)
        #expect(PremiumSheet.options(offers.reversed()).map(\.period) == [.annual, .monthly])
        #expect(PremiumSheet.chosen(.annual, in: offers) == .annual)
        // A store that sells one period has it chosen.
        #expect(PremiumSheet.chosen(.annual, in: [offers[1]]) == .monthly)
    }

    @Test func subscribeBuysTheChosenPeriod() async {
        let client = FakePurchaseClient()
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        model.period = .monthly
        await PremiumSheet.subscribe(model, from: .record)

        #expect(client.purchased == [.monthly])
    }

    @Test func subscribeBuysTheOnePeriodTheStoreSells() async {
        let client = FakePurchaseClient()
        client.offersResult = .success([offers[1]])
        let model = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        await PremiumSheet.subscribe(model, from: .record)

        #expect(client.purchased == [.monthly])
    }

    @Test func aTrialSaysBillingStartsToday() {
        #expect(
            PremiumSheet.terms(Plan(kind: .premium, source: .trial))
                == [PlanText.renewsUntilCancelled, PlanText.billingStartsToday])
        #expect(PremiumSheet.terms(Plan(kind: .free)) == [PlanText.renewsUntilCancelled])
    }

    @Test func theDisclosuresAreThere() throws {
        #expect(PremiumSheet.title(.plan) == PlanText.premiumPlanTitle)
        #expect(PremiumSheet.message(.plan, scanTuneTitle: nil) == PlanText.premiumPlanBody)
        #expect(PremiumSheet.periodLabel(.annual) == PlanText.periodAnnual)
        #expect(PremiumSheet.periodLabel(.monthly) == PlanText.periodMonthly)
        #expect(PremiumSheet.priceLine(offers[0]) == "A$1 a year")
        #expect(PremiumSheet.priceLine(offers[1]) == "M$1 a month")
        #expect(PremiumSheet.terms(Plan(kind: .free)).contains(PlanText.renewsUntilCancelled))
        #expect(
            PremiumSheet.links == [
                .init(label: PlanText.termsOfUse, url: try #require(URL(string: "https://crosstune.app/terms"))),
                .init(label: PlanText.privacyPolicy, url: try #require(URL(string: "https://crosstune.app/privacy"))),
            ])
    }

    @Test func aPurchaseReportsWhereTheSheetCameFrom() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let model = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        await model.loadOffers()

        _ = presenter.gate(.recordings, from: .record)
        await PremiumSheet.subscribe(model, from: try #require(presenter.presentedFrom))

        #expect(
            sink.captures.contains(
                .init(name: "purchase_started", properties: ["period": .string("annual"), "from": .string("record")])))
    }

    @Test func theSheetSaysWhatWasTapped() {
        #expect(PremiumSheet.title(.recordings) == PlanText.premiumRecordingsTitle)
        #expect(PremiumSheet.title(.scans) == PlanText.premiumScansTitle)
        #expect(PremiumSheet.message(.recordings, scanTuneTitle: nil) == PlanText.premiumRecordingsBody)
        #expect(PremiumSheet.message(.scans, scanTuneTitle: nil) == nil)
        #expect(
            PremiumSheet.message(.scans, scanTuneTitle: "Kitchen Girl")
                == PlanText.premiumScansBody(tuneTitle: "Kitchen Girl"))
    }

    @Test func aDimmedRowUnderTheTunePagesRecordingsLineReportsTheLine() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let recording = Recording(id: "r1", tuneID: "t1", source: "microphone", addedAt: noon, state: "ready")
        let view = RecordingView(recording: recording, file: nil, tuneID: "t1", tuneTitle: "Kitchen Girl")

        TuneMediaRows.item(view) { _ in }.offerPremium(presenter)

        #expect(presenter.presented == .recordings)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("recordings_line")])
            ])
    }

    @Test func aDimmedRowOnTheRecordingsScreenReportsTheRow() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        let view = RecordingView(recording: recording, file: nil, tuneID: nil, tuneTitle: nil)

        RecordingItem(view: view, source: .recordingsList) { _ in }.offerPremium(presenter)

        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("recording_row")])
            ])
    }

    @Test func theSheetScrollsAndGrowsForLargeText() {
        #expect(PremiumSheet.detents == [.medium, .large])
    }

    @Test func theEntriesAndReasonsNameThePlansValues() {
        #expect(PremiumReason.allCases.map(\.rawValue) == ["recordings", "scans", "plan"])
        #expect(
            PremiumEntry.allCases.map(\.rawValue) == [
                "record", "upload", "add_to_recordings", "recording_row", "recordings_line", "scan", "add_scan",
                "plan_group", "trial_reminder", "trial_ended",
            ])
    }
}
