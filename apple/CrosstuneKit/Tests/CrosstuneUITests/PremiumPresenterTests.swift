import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func entitlement(source: String?, expiresAt: Date? = nil) -> Entitlement {
    Entitlement(
        id: "entitlement-1", createdAt: noon, premiumSource: source, premiumExpiresAt: expiresAt.map(Timestamp.init),
        autoRenews: false, trialEndsAt: expiresAt.map(Timestamp.init), premiumQuotaBytes: 10_000)
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct PremiumPresenterTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    /// A plan model over a store holding `row`, once it has judged the row.
    private func plan(_ row: Entitlement?, kind: PlanKind, sourceLocation: SourceLocation = #_sourceLocation)
        async throws -> PlanModel
    {
        let store = try root.open()
        if let row { try await store.write { writer in try row.upsert(writer.db) } }
        let model = PlanModel(store: store, now: { noon.date })
        try await eventually(sourceLocation: sourceLocation) { model.isLoaded && model.plan.kind == kind }
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
                    properties: [
                        "reason": .string("recordings"), "from": .string("record"), "presentation": .string("sheet"),
                    ])
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

    @Test func everyShowingOpensOnAnnual() async throws {
        let purchase = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client, purchase: purchase)
        presenter.present(.plan, from: .planGroup)
        purchase.period = .monthly
        presenter.presentation = nil

        presenter.present(.recordings, from: .record)

        #expect(purchase.period == .annual)
    }

    @Test func aFreePlanGatesScans() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        #expect(presenter.gate(.scans, from: .addScan) == false)
        #expect(presenter.presented == .scans)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: [
                        "reason": .string("scans"), "from": .string("add_scan"), "presentation": .string("sheet"),
                    ])
            ])
    }

    @Test func aTrialActsAndSendsNothing() async throws {
        let ends = noon.date.addingTimeInterval(86_400)
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
        presenter.presentation = nil
        _ = presenter.gate(.recordings, from: .upload)
        #expect(sink.captures.count == 2)
    }

    @Test func anOverlayReportsItsShowing() async throws {
        let purchase = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        await purchase.restore()
        purchase.period = .monthly

        LapsedOverlay.reportShowing(from: RecordingPage.planEntry, analytics: sink.client, purchase: purchase)

        #expect(purchase.line == nil)
        #expect(purchase.period == .annual)
        #expect(
            sink.captures.last
                == .init(
                    name: "premium_sheet_shown",
                    properties: [
                        "reason": .string("recordings"), "from": .string("recording_page"),
                        "presentation": .string("overlay"),
                    ]))
    }

    @Test(arguments: [true, false]) func aShowingKeepsAPurchaseWaitingOnApproval(asOverlay: Bool) async throws {
        let client = FakePurchaseClient()
        client.purchaseResult = .pending
        let purchase = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        purchase.period = .monthly
        await purchase.buy(from: RecordingPage.planEntry)
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client, purchase: purchase)

        if asOverlay {
            LapsedOverlay.reportShowing(from: RecordingPage.planEntry, analytics: sink.client, purchase: purchase)
        } else {
            presenter.present(.recordings, from: .recordingRow)
        }

        #expect(purchase.line == .pending)
        #expect(purchase.period == .monthly)
    }

    @Test func theCopyMatchesTheWeb() throws {
        let web = try webCopy("web/src/features/plan/planCopy.ts")
        let shared: [(String, String)] = [
            ("PLAN_GROUP", PlanText.group),
            ("PLAN_FREE", PlanText.free),
            ("PLAN_PREMIUM", PlanText.premium),
            ("PLAN_TRIAL", PlanText.trial),
            ("FREE_HELP", PlanText.freeHelp),
            ("PREMIUM_RECORDINGS_TITLE", PlanText.premiumRecordingsTitle),
            ("PREMIUM_SCANS_TITLE", PlanText.premiumScansTitle),
            ("RECORDINGS_COST", PlanText.recordingsCost),
            ("SUBSCRIBE_OR_EXPORT", PlanText.subscribeOrExport),
            ("PREMIUM_SCANS_BODY", PlanText.premiumScansBody),
            ("LAPSED_PREMIUM_TITLE", PlanText.lapsedPremiumTitle),
            ("LAPSED_TRIAL_TITLE", PlanText.lapsedTrialTitle),
            ("EXPORT_THIS_RECORDING", PlanText.exportThisRecording),
            ("EXPORT_EVERYTHING", PlanText.exportEverything),
            ("SEE_PLAN", PlanText.seePlan),
            ("PREMIUM_PLAN_TITLE", PlanText.premiumPlanTitle),
            ("SUBSCRIBE", PlanText.subscribe),
            ("MANAGE_APP_STORE", PlanText.manageAppStore),
            ("PERIOD_ANNUAL", PlanText.periodAnnual),
            ("PERIOD_MONTHLY", PlanText.periodMonthly),
            ("BILLING_PERIOD", PlanText.billingPeriod),
            ("SUBSCRIBE_OFFLINE", PlanText.subscribeOffline),
            ("SUBSCRIBE_UNAVAILABLE_TITLE", PlanText.subscribeUnavailableTitle),
            ("SUBSCRIBE_UNAVAILABLE_MESSAGE", PlanText.subscribeUnavailableMessage),
            ("SUBSCRIBED", PlanText.subscribed),
            ("SUBSCRIBE_FAILED_TITLE", PlanText.subscribeFailedTitle),
            ("SUBSCRIBE_FAILED_MESSAGE", PlanText.subscribeFailedMessage),
            ("APP_STORE_SUBSCRIPTIONS_URL", RevenueCatPurchases.appleSubscriptionsURL.absoluteString),
            ("PREMIUM_PITCH", PlanText.premiumPitch),
            ("TRIAL_STORAGE", PlanText.trialStorage),
            ("TRIAL_KEEPS", PlanText.trialKeeps),
            ("TRIAL_ENDS_TODAY", PlanText.trialEndsToday),
            ("COMPARE_FREE", PlanText.compareFree),
            ("COMPARE_PREMIUM", PlanText.comparePremium),
            ("FEATURE_CATALOG", PlanText.featureCatalog),
            ("FEATURE_SYNC", PlanText.featureSync),
            ("FEATURE_RECORD", PlanText.featureRecord),
            ("FEATURE_PLAY", PlanText.featurePlay),
            ("FEATURE_PRACTICE", PlanText.featurePractice),
            ("FEATURE_SCANS", PlanText.featureScans),
            ("FEATURE_STORAGE", PlanText.featureStorage),
            ("STORAGE_PREMIUM", PlanText.storagePremium),
            ("ON_PREMIUM", PlanText.onPremium),
            ("THANKS", PlanText.thanks),
            ("RENEWS", PlanText.renews),
            ("ENDS", PlanText.ends),
            ("COMP_GRANT", PlanText.compGrant),
            ("INCLUDED", PlanText.included),
            ("INCLUDED_RECORD", PlanText.includedRecord),
            ("INCLUDED_RECORD_DETAIL", PlanText.includedRecordDetail),
            ("INCLUDED_EVERY_DEVICE", PlanText.includedEveryDevice),
            ("INCLUDED_EVERY_DEVICE_DETAIL", PlanText.includedEveryDeviceDetail),
            ("INCLUDED_PRACTICE", PlanText.includedPractice),
            ("INCLUDED_PRACTICE_DETAIL", PlanText.includedPracticeDetail),
            ("INCLUDED_SCANS", PlanText.includedScans),
            ("INCLUDED_SCANS_DETAIL", PlanText.includedScansDetail),
            ("COMPARE_PLANS", PlanText.comparePlans),
            ("TERMS_OF_USE", PlanText.termsOfUse),
            ("PRIVACY_POLICY", PlanText.privacyPolicy),
            ("TERMS_URL", PlanText.termsURL),
            ("PRIVACY_URL", PlanText.privacyURL),
        ]
        for (name, value) in shared {
            let expected = try #require(web[name], "planCopy.ts has no constant \(name)")
            #expect(value == expected, "\(name)")
        }
        let notices = try webCopy("web/src/features/plan/noticeCopy.ts")
        let sharedNotices: [(String, String)] = [
            ("LOSE_PLAYBACK", NoticeText.losePlayback),
            ("LOSE_RECORDING", NoticeText.loseRecording),
            ("LOSE_SCANS", NoticeText.loseScans),
            ("NOTICE_KEEPS", NoticeText.keeps),
        ]
        for (name, value) in sharedNotices {
            let expected = try #require(notices[name], "noticeCopy.ts has no constant \(name)")
            #expect(value == expected, "\(name)")
        }
        #expect(PlanText.save(17) == "Save 17%")
        #expect(NoticeText.subscribeAnnual("$49.99") == "Subscribe for $49.99 a year")
        // The web builds these and the next from functions, so they are compared by shape.
        #expect(PlanText.annualPrice("$10") == "$10 a year")
        #expect(PlanText.monthlyPrice("$1") == "$1 a month")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let now = Date(timeIntervalSince1970: 1_791_633_600)  // 2026-10-10 12:00 GMT
        let ends = now.addingTimeInterval(5 * 86_400)
        let locale = Locale(identifier: "en_US")
        #expect(PlanText.trialDaysLeft(endsAt: ends, now: now, calendar: calendar) == "5 days left")
        #expect(
            PlanText.trialDaysLeft(endsAt: now.addingTimeInterval(86_400), now: now, calendar: calendar) == "1 day left"
        )
        #expect(PlanText.trialDaysLeft(endsAt: now, now: now, calendar: calendar) == "Ends today")
        #expect(PlanText.trialEnds(ends, calendar: calendar, locale: locale) == "Ends Oct 15, 2026")
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
        #expect(presenter.presentation?.entry == .planGroup)
        // A second ask while the sheet is up shows nothing new.
        presenter.present(.plan, from: .trialEnded)
        #expect(presenter.presentation?.entry == .planGroup)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: [
                        "reason": .string("plan"), "from": .string("plan_group"), "presentation": .string("sheet"),
                    ])
            ])
    }

    @Test func aShowingKeepsTheRecordingItOpenedFromUntilItCloses() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let subject = PremiumSubject(recordingID: "r1")

        #expect(presenter.gate(.recordings, from: .recordingRow, subject: subject) == false)

        #expect(presenter.presentation?.subject == subject)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: [
                        "reason": .string("recordings"), "from": .string("recording_row"),
                        "presentation": .string("sheet"),
                    ])
            ])
        presenter.presentation = nil
        #expect(presenter.presentation?.subject == nil)
    }

    @Test func closingTheSheetForgetsWhereItCameFrom() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        _ = presenter.gate(.recordings, from: .upload)
        #expect(presenter.presentation?.entry == .upload)
        presenter.presentation = nil
        #expect(presenter.presentation?.entry == nil)
    }

    @Test func aDimmedRowUnderTheTunePagesRecordingsLineReportsTheLine() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let recording = Recording(id: "r1", tuneID: "t1", source: "microphone", addedAt: noon, state: "ready")
        let view = RecordingView(recording: recording, file: nil, tuneID: "t1", tuneTitle: "Kitchen Girl")

        TuneMediaRows.item(view, uploadLimits: nil) { _ in }.offerPremium(presenter)

        #expect(presenter.presented == .recordings)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: [
                        "reason": .string("recordings"), "from": .string("recordings_line"),
                        "presentation": .string("sheet"),
                    ])
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
                    properties: [
                        "reason": .string("recordings"), "from": .string("recording_row"),
                        "presentation": .string("sheet"),
                    ])
            ])
    }
}
